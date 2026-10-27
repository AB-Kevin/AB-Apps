# AB Apps

A Windows desktop app that installs, updates and opens Anabaptist Brotherhood's in-house apps, and signs people in once for all of them. A new contractor or employee installs AB Apps, signs in, and AB Apps installs the apps meant for them.

- **My apps** shows each app with its installed version, and offers **Open**, **Install** or **Update**. **Install and update all** does every app that needs it.
- Each app still updates itself from its own GitHub releases. AB Apps doesn't need a new release when an app does: it reads each app's latest release when it opens.
- **Managers** add people on the **People** page, as managers, employees or contractors, and choose which apps each class gets on the **App access** page.
- **Managers** set the mail server and website the apps share on the **Mail and website** page, once for everyone.

## Setting it up

1. Make a folder in OneDrive or SharePoint, for example `AB Apps`, and share it with everyone who will use AB Apps, with edit access. It holds the list of people who can sign in.
2. Everyone syncs it to their computer. For a OneDrive folder shared with you, use **Add shortcut to My files**; for a SharePoint library, use **Sync**. Then right-click the folder and choose **Always keep on this device**.
3. Install AB Apps from the [latest release](https://github.com/AB-Kevin/ab-apps/releases/latest) and choose the synced folder.
4. The first person to open an empty folder sets it up and becomes the first manager. Then they add people on the **People** page.

Each computer chooses the folder only once. People added on one computer can sign in elsewhere after OneDrive has synced, usually within a minute.

### Onboarding someone

1. A manager adds them on the **People** page with a class and a PIN.
2. Share the AB Apps folder with them, and any app data folders their work needs.
3. They install AB Apps, choose the folder, and sign in. AB Apps installs their apps one after another; they can open each one as soon as it's ready.

## Signing in once for every app

Signing in lasts on that computer until the person signs out. While someone is signed in, AB Apps keeps this file in the Windows account's AppData:

`%APPDATA%\AB Apps\identity.json`

```json
{
  "version": 1,
  "personId": "0dbc309a-4814-4490-a9ca-0691c9092199",
  "name": "Mary Manager",
  "class": "manager",
  "signedInAt": "2026-10-12T23:53:51.250Z",
  "dataDir": "C:\\Users\\mary\\OneDrive\\AB Apps"
}
```

An app that supports AB Apps reads it to know who is using it, for example to sign comments with `name`. If the file is missing, or its `version` isn't one the app knows, the app falls back to its own sign-in or settings, so every app still works without AB Apps. `class` is `manager`, `employee` or `contractor`. A manager's rename reaches the file the next time that person's AB Apps opens.

How the apps use it:

- **KeepTime** has no sign-in of its own. It uses whoever is signed in here, reads names, classes and who is turned off from this folder's `shared/people.json`, and follows along when someone signs in or out. It keeps only rates, templates and invoice numbers itself.
- **BillManager** and **ApplicationManager** sign comments with `name`. Without AB Apps, they use the comment name set on that computer.
- **Duplicate Checker** and **SendNewsletters** show `name` to the others using the same data folder, and record `personId` in each computer's file there. Without AB Apps, they use the name set in their Settings.
- **FormTracker** shows `name` on its editing lock, so the read-only view says who is editing. Without AB Apps, it uses the Windows user name.
- Duplicate Checker, SendNewsletters and FormTracker notice a sign-in or sign-out within a few seconds while they are open.

Like the PIN, this is a convenience, not a security boundary. Anyone using the same Windows account can change the file, and anyone with access to the shared folder can edit the people list. What each app's data folder is shared with still decides who can use its data.

## Mail and website for the apps

FormTracker, SendNewsletters and KeepTime send email, and ApplicationManager, FormTracker and SendNewsletters read the website's Gravity Forms API. A manager sets both once on the **Mail and website** page. AB Apps keeps them in the AB Apps folder, where the apps find them through `dataDir` in `identity.json`:

`shared/services.json`

```json
{
  "version": 1,
  "mail": {
    "host": "yourdomain-org.mail.protection.outlook.com",
    "port": 25,
    "secure": false,
    "fromName": "Anabaptist Brotherhood",
    "fromEmail": "info@example.org"
  },
  "website": {
    "siteUrl": "https://example.org",
    "consumerKey": "ck_…",
    "consumerSecret": "cs_…"
  }
}
```

- **The mail server** is one that takes mail without signing in, such as the office's Microsoft 365 relay, so there's no password to share. A relay like that usually only accepts mail from the office's network, so **Test connection** fails from home. While one is set, the apps send through it and their own SMTP settings wait unused, folded away on their Settings pages.
- **The website** is the address and a Gravity Forms consumer key and secret. Everyone with the AB Apps folder can read this file, so give the key **Read** permission only. Each app still keeps which form it uses, and its field IDs or mapping.
- `mail` or `website` is `null` until a manager sets it. Leaving every field in a section blank turns it off again. An app that finds no file, a section that's `null`, or a `version` it doesn't know uses its own settings, as it does when nobody is signed in to AB Apps.

## Adding an app

Add an entry to [`catalog.json`](catalog.json) and push it to the main branch. Every computer picks it up the next time AB Apps opens or someone chooses **Check for updates**; no AB Apps release is needed. The copy built into AB Apps is only used when GitHub can't be reached and no copy has been saved yet, so update it in the next release too.

```json
{
  "id": "formtracker",
  "name": "FormTracker",
  "description": "Send form requests to a mailing list and track who has responded.",
  "repo": "AB-Kevin/FormTracker",
  "appId": "com.formtracker.app",
  "productName": "FormTracker",
  "icon": "build/icon.png",
  "classes": ["manager", "employee", "contractor"]
}
```

| Field | What it is |
| --- | --- |
| `id` | A short name AB Apps keeps for the app: lowercase letters, digits and hyphens. Don't change it later, or managers' access choices for the app are lost. |
| `name`, `description` | What the tile shows. |
| `repo` | The GitHub repository whose releases hold the installer. Only repositories owned by `AB-Kevin` are accepted, since AB Apps runs whatever installer the latest release names (`ALLOWED_OWNERS` in `src/main/catalog.js`). |
| `appId` | The app's `build.appId` in its package.json. AB Apps finds the installed copy from it. |
| `productName` | The app's `productName` (or `build.productName`). The program is `<productName>.exe`. |
| `icon` | Optional. A PNG in the repository, shown on the tile. |
| `classes` | Who gets the app unless a manager changes it on **App access**. |

The app itself needs:

- An electron-builder NSIS installer, per-user (`perMachine` false, the default).
- Releases tagged `vX.Y.Z` with the installer and the `latest.yml` electron-builder writes beside it. electron-builder writes `latest.yml` when package.json's `build.publish` names the GitHub repository; publishing with electron-updater, or uploading it with the installer as Duplicate Checker and KeepTime do, both work.

An entry with a problem is left out, and the reason is logged when AB Apps starts from a terminal.

## How installs work

- AB Apps reads each app's `latest.yml` from its latest release's download link (`releases` in [ab-common](https://github.com/AB-Kevin/ab-common)), not the GitHub API, so a whole office can check without reaching GitHub's limit of 60 API requests an hour per network.
- It finds installed apps in the registry key electron-builder makes from the `appId` (`installs` in ab-common).
- Installers are checked against the SHA-512 digest in `latest.yml`, then run silently for the current Windows account only (`/S /currentuser`), one at a time, so no administrator prompt appears. Updates also pass `--updated`, which keeps the app's shortcuts as they are.
- An app that's open isn't updated; AB Apps asks the person to close it first.
- Every app's installer is per-user and asks no questions (`oneClick` true, `perMachine` false), like AB Apps' own. A copy someone installed **for all users** with an older installer isn't updated by AB Apps, since that needs an administrator, and its own updater would now add a second, per-user copy beside it. AB Apps asks the person to uninstall it in Windows Settings, then install it here; its settings are kept.
- The first time someone signs in on a computer, AB Apps installs their apps automatically. It does that only once per app, so an app someone uninstalls on purpose isn't put back. They can still install it from **My apps**.
- Taking an app away on **App access** doesn't uninstall it; AB Apps just stops showing it.

## How the data is stored

OneDrive can't merge two computers' changes to one file, so every file has one kind of writer:

| File | Written by |
| --- | --- |
| `shared/people.json` | managers: names, classes, PINs they set |
| `shared/settings.json` | managers: which classes get which apps, where it differs from the catalog |
| `shared/services.json` | managers: the mail server and website the apps share |
| `people/<id>/profile.json` | that person: a PIN they chose |

Each computer keeps its own settings in `%APPDATA%\AB Apps\config.json`: the folder, who is signed in, the theme, and which apps were installed automatically.

## Development

```
npm install
npm start      # run the app
npm test       # unit tests for the catalog, people rules, identity file and shared services
npm run dist   # build the Windows installer into dist/
```

Set `AB_APPS_PROFILE` to a folder to run with settings kept apart from this computer's real ones. `npm start` checks for app updates and can install apps for real; to try it without installing anything, put `"autoInstalled"` with every app's `id` in that profile's `config.json` and don't choose **Install** or **Update**.

### Releasing

Pushing a version tag builds the Windows installer on GitHub and publishes it as a release (`.github/workflows/release.yml`). Once your changes are committed:

```
npm version patch       # or minor / major: runs the tests, bumps the version, commits, and tags vX.Y.Z
git push --follow-tags  # or run `git config push.followTags true` once, then plain `git push`
```

The release appears on the repository's **Releases** page a few minutes later as `ABApps-Setup-X.Y.Z.exe` with a `latest.yml` beside it. AB Apps checks for a new version of itself when it opens and shows **AB Apps update available** in the header; **Settings** has **Check for updates**.

- The installer installs for the current Windows account without asking any questions, then opens AB Apps.
- The installer isn't code-signed, so Windows SmartScreen shows "Windows protected your PC" the first time it runs. Choose **More info**, then **Run anyway**.

| Path | What's there |
| --- | --- |
| `catalog.json` | the apps AB Apps offers |
| `src/main/main.js` | the window, sign-in, the install queue, and the handlers the window calls |
| `src/main/catalog.js` | reading and checking the catalog, and app icons |
| `src/main/installed.js` | checking whether an app is running, and running installers |
| [ab-common](https://github.com/AB-Kevin/ab-common) | shared with the apps: safe JSON files, reading `latest.yml` and downloading installers, finding and opening installed apps, the mail and Gravity Forms connection tests |
| `src/main/people.js`, `auth.js`, `store.js` | people and access rules; PINs and lockout; the shared folder |
| `src/main/identity.js` | `identity.json`, for the other apps |
| `src/main/services.js` | `shared/services.json`: the mail server and website the apps share |
| `src/renderer/` | the window: `app.js` and `styles.css` (Anabaptist Brotherhood brand tokens, light and dark) |
