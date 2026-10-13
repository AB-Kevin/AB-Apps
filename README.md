# AB Apps

A Windows desktop app that installs, updates and opens Anabaptist Brotherhood's in-house apps, and signs people in once for all of them. A new contractor or employee installs AB Apps, signs in, and AB Apps installs the apps meant for them.

- **My apps** shows each app with its installed version, and offers **Open**, **Install** or **Update**. **Install and update all** does every app that needs it.
- Each app still updates itself from its own GitHub releases. AB Apps doesn't need a new release when an app does: it reads each app's latest release when it opens.
- **Managers** add people on the **People** page, as managers, employees or contractors, and choose which apps each class gets on the **App access** page.

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

- **Contractor Time** has no sign-in of its own. It uses whoever is signed in here, reads names, classes and who is turned off from this folder's `shared/people.json`, and follows along when someone signs in or out. It keeps only rates, templates and invoice numbers itself.
- **BillManager** and **ApplicationManager** sign comments with `name`. Without AB Apps, they use the comment name set on that computer.

### Moving people from Contractor Time

Contractor Time kept its own people and PINs before it used AB Apps. A manager moves them here with **Import from Contractor Time** on the People page, choosing Contractor Time's data folder:

- Everyone keeps their id, so their time and invoices stay theirs, and the PIN they used in Contractor Time. Managers stay managers; everyone else becomes a contractor, which a manager can change to employee.
- Someone already here under the same name, such as the manager who set up AB Apps, is linked: they keep their class and PIN here and take their Contractor Time id. Anyone linked who is signed in on another computer signs in again there.
- Importing again only adds people who weren't imported before.

Like the PIN, this is a convenience, not a security boundary. Anyone using the same Windows account can change the file, and anyone with access to the shared folder can edit the people list. What each app's data folder is shared with still decides who can use its data.

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
- Releases tagged `vX.Y.Z` with the installer and the `latest.yml` electron-builder writes beside it. electron-builder writes `latest.yml` when package.json's `build.publish` names the GitHub repository; publishing with electron-updater, or uploading it with the installer as Duplicate Checker and Contractor Time do, both work.

An entry with a problem is left out, and the reason is logged when AB Apps starts from a terminal.

## How installs work

- AB Apps reads each app's `latest.yml` from its latest release's download link (`src/main/releases.js`), not the GitHub API, so a whole office can check without reaching GitHub's limit of 60 API requests an hour per network.
- It finds installed apps in the registry key electron-builder makes from the `appId` (`src/main/installed.js`).
- Installers are checked against the SHA-512 digest in `latest.yml`, then run silently for the current Windows account only (`/S /currentuser`), one at a time, so no administrator prompt appears. Updates also pass `--updated`, which keeps the app's shortcuts as they are.
- An app that's open isn't updated; AB Apps asks the person to close it first.
- An app someone installed **for all users** isn't updated by AB Apps, since that needs an administrator; it updates itself.
- The first time someone signs in on a computer, AB Apps installs their apps automatically. It does that only once per app, so an app someone uninstalls on purpose isn't put back. They can still install it from **My apps**.
- Taking an app away on **App access** doesn't uninstall it; AB Apps just stops showing it.

## How the data is stored

OneDrive can't merge two computers' changes to one file, so every file has one kind of writer:

| File | Written by |
| --- | --- |
| `shared/people.json` | managers: names, classes, PINs they set |
| `shared/settings.json` | managers: which classes get which apps, where it differs from the catalog |
| `people/<id>/profile.json` | that person: a PIN they chose |

Each computer keeps its own settings in `%APPDATA%\AB Apps\config.json`: the folder, who is signed in, the theme, and which apps were installed automatically.

## Development

```
npm install
npm start      # run the app
npm test       # unit tests for the catalog, releases, registry lookup, people rules and identity file
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
| `src/main/releases.js` | reading `latest.yml` and downloading installers |
| `src/main/installed.js` | finding installed apps, running installers, opening apps |
| `src/main/people.js`, `auth.js`, `store.js` | people and access rules; PINs and lockout; the shared folder |
| `src/main/identity.js` | `identity.json`, for the other apps |
| `src/renderer/` | the window: `app.js` and `styles.css` (Anabaptist Brotherhood brand tokens, light and dark) |
