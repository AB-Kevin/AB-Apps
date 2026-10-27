'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, net } = require('electron');
const { readJson, writeJson } = require('ab-common/jsonfile');
const { Store } = require('./store');
const { pinProblem, hashPin, verifyPin, currentPin, Lockout } = require('./auth');
const { loadCatalog, loadIcon, appsFor, CLASSES } = require('./catalog');
const { releasesPage, isNewer, latestRelease, downloadInstaller } = require('ab-common/releases');
const { verifyConnection } = require('ab-common/mailer');
const { listForms } = require('ab-common/gravityforms');
const installed = require('./installed');
const { CLASS_NAMES, savePerson, saveAccess } = require('./people');
const identity = require('./identity');
const { readServices, publicServices } = require('./services');

const APP_ID = 'org.anabaptistbrotherhood.abapps';
const SELF_REPO = 'AB-Kevin/ab-apps';
const APP_ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const BUNDLED_CATALOG = path.join(__dirname, '..', '..', 'catalog.json');
// The window's color before the page paints: --surface-page in styles.css.
const WINDOW_BACKGROUND = { light: '#FFFFFF', dark: '#1E1C1D' };
const THEMES = ['system', 'light', 'dark'];

// Lets a test run keep its settings apart from this computer's real ones.
if (process.env.AB_APPS_PROFILE) app.setPath('userData', process.env.AB_APPS_PROFILE);

// One copy per Windows account; on a shared remote desktop server each person has their own.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();

let win = null;
let store = null;
let session = null; // { personId, signedInAt }
let catalog = { apps: [], skipped: [], source: null };
let catalogReady = Promise.resolve(); // the first read of the catalog, which sign-in waits for
const lockout = new Lockout();

// What the launcher shows about each app, by app id.
const installs = new Map(); // where it's installed, or null
const releases = new Map(); // { release } or { error } from its latest release
const jobs = new Map(); // { op: 'install' | 'update', phase: 'waiting' | 'downloading' | 'installing', percent }
const problems = new Map(); // the last install or update's error, until the next try
const icons = new Map(); // app id -> data URL, from its repository
let jobQueue = Promise.resolve();
let lastRefresh = 0;

let selfRelease = null; // AB Apps' own latest release, from the last check
let selfInstalling = null;

/** A problem to show the person as-is, rather than as a failure. */
class UserError extends Error {}
const fail = (errors) => {
  if (errors.length) throw new UserError(errors.join(' '));
};

// This computer's settings: where the AB Apps folder is, who is signed in, the
// theme, and which apps were installed automatically once already.
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const loadConfig = () => readJson(configPath(), {});
const saveConfig = (changes) => writeJson(configPath(), { ...loadConfig(), ...changes });

const downloadsDir = () => path.join(app.getPath('temp'), 'AB Apps downloads');

function openStore() {
  const { dataDir } = loadConfig();
  store = dataDir && fs.existsSync(dataDir) ? new Store(dataDir) : null;
}

const windowBackground = () => WINDOW_BACKGROUND[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];

function applyTheme() {
  const { theme } = loadConfig();
  nativeTheme.themeSource = THEMES.includes(theme) ? theme : 'system';
}

function suggestedFolder() {
  const oneDrive = process.env.OneDriveCommercial || process.env.OneDrive;
  return oneDrive ? path.join(oneDrive, 'AB Apps') : null;
}

// Session -------------------------------------------------------------------
// Signing in lasts on this computer until the person signs out, so the apps
// can rely on identity.json. Each start re-checks the person is still listed
// and active.

function me() {
  if (!store || !session) throw new UserError('Sign in first.');
  const person = store.people().find((p) => p.id === session.personId);
  if (!person?.active) {
    signOut();
    throw new UserError('Your account has been turned off. Ask a manager if that is a mistake.');
  }
  return person;
}

function asManager() {
  const person = me();
  if (person.class !== 'manager') throw new UserError('Only managers can do that.');
  return person;
}

function signIn(person, signedInAt = new Date().toISOString()) {
  session = { personId: person.id, signedInAt };
  saveConfig({ personId: person.id, signedInAt, lastPersonId: person.id });
  identity.writeIdentity(app.getPath('userData'), person, { signedInAt, dataDir: store.dataDir });
}

function signOut() {
  session = null;
  saveConfig({ personId: null, signedInAt: null });
  identity.clearIdentity(app.getPath('userData'));
}

/** Picks up the sign-in kept from last time, if that person is still active, and refreshes identity.json. */
function resumeSession() {
  const { personId, signedInAt } = loadConfig();
  session = null;
  if (!store || !personId) return;
  try {
    const person = store.isDataFolder() && store.people().find((p) => p.id === personId && p.active);
    if (person) signIn(person, signedInAt ?? undefined);
    else signOut();
  } catch {
    // the folder can't be read yet; the window says so
  }
}

const publicPerson = (p) => ({ id: p.id, name: p.name, class: p.class, className: CLASS_NAMES[p.class] ?? p.class, active: p.active });

// Apps ----------------------------------------------------------------------

/** The catalog apps the signed-in person gets. */
function myApps() {
  if (!store || !session) return [];
  const person = store.people().find((p) => p.id === session.personId);
  return person ? appsFor(person.class, catalog.apps, store.settings().access) : [];
}

function appsState() {
  let apps;
  try {
    apps = myApps();
  } catch {
    apps = [];
  }
  return apps.map((a) => {
    const install = installs.get(a.id);
    const latest = releases.get(a.id);
    const release = latest?.release;
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      icon: icons.get(a.id) ?? null,
      installed: install ? { version: install.version, scope: install.scope } : null,
      latest: release ? { version: release.version, publishedAt: release.publishedAt, hasInstaller: Boolean(release.installer) } : null,
      latestError: latest?.error ?? null,
      updateAvailable: Boolean(install && release && isNewer(release.version, install.version)),
      job: jobs.get(a.id) ?? null,
      problem: problems.get(a.id) ?? null,
      checked: releases.has(a.id),
    };
  });
}

const sendApps = () => win?.webContents.send('apps-changed', appsState());

async function findInstall(a) {
  const install = await installed.findInstall(a);
  installs.set(a.id, install);
  return install;
}

/** Re-reads where each app is installed, and with `releases` also their latest releases. */
async function refreshApps({ withReleases = false } = {}) {
  lastRefresh = Date.now();
  const apps = myApps();
  await Promise.all(apps.map(async (a) => {
    await findInstall(a);
    if (!withReleases) return;
    try {
      releases.set(a.id, { release: await latestRelease(a.repo, net.fetch) });
    } catch (err) {
      releases.set(a.id, { error: err.message });
    }
  }));
  sendApps();
}

/**
 * Queues an install or update. Installers run one at a time: two at once can
 * fight over Windows Installer's locks and the shortcuts folder.
 */
function queueJob(id) {
  if (jobs.has(id)) return;
  jobs.set(id, { op: installs.get(id) ? 'update' : 'install', phase: 'waiting', percent: null });
  problems.delete(id);
  sendApps();
  jobQueue = jobQueue.then(() => runJob(id));
}

async function runJob(id) {
  const job = jobs.get(id);
  const a = catalog.apps.find((x) => x.id === id);
  let lastPercent = -1;
  try {
    if (!a) throw new Error('That app is no longer listed.');
    const release = releases.get(id)?.release;
    if (!release?.installer) throw new Error(releases.get(id)?.error ?? "Its latest release doesn't have an installer yet.");
    const before = await findInstall(a);
    job.op = before ? 'update' : 'install';
    if (before?.scope === 'machine') {
      // Its installer is per-user now, so updating it in place would add a second copy.
      throw new Error(`${a.name} is installed for everyone on this computer. Uninstall it in Windows Settings, Apps, then install it here. Its settings are kept.`);
    }
    if (before && (await installed.isRunning(before.exe))) throw new Error(`Close ${a.name} first, then try again.`);

    job.phase = 'downloading';
    sendApps();
    const file = await downloadInstaller(release.installer, downloadsDir(), net.fetch, (received, total) => {
      const percent = Math.floor((received / total) * 100);
      if (percent === lastPercent) return;
      job.percent = lastPercent = percent;
      sendApps();
    });

    job.phase = 'installing';
    job.percent = null;
    sendApps();
    await installed.runInstaller(file, { update: Boolean(before) });
    fs.rm(file, { force: true }, () => {});
    if (!(await findInstall(a))) throw new Error(`${a.name} didn't appear in the installed programs after its installer finished.`);
  } catch (err) {
    problems.set(id, err.message);
  } finally {
    jobs.delete(id);
    sendApps();
  }
}

/**
 * Installs the person's apps the first time they sign in on this computer.
 * Each app is installed automatically only once, so one that's uninstalled
 * on purpose isn't put back.
 */
function installMissing() {
  const done = new Set(loadConfig().autoInstalled ?? []);
  for (const a of myApps()) {
    if (done.has(a.id)) continue;
    if (installs.get(a.id)) done.add(a.id);
    else if (releases.get(a.id)?.release?.installer) {
      queueJob(a.id);
      done.add(a.id);
    }
  }
  saveConfig({ autoInstalled: [...done] });
}

/** After sign-in: checks every app, then installs any this computer hasn't had yet. */
async function prepareApps() {
  await catalogReady;
  await refreshApps({ withReleases: true });
  installMissing();
}

async function reloadCatalog() {
  catalog = await loadCatalog({
    fetch: net.fetch,
    cachePath: path.join(app.getPath('userData'), 'catalog.json'),
    bundledPath: BUNDLED_CATALOG,
  });
  for (const note of catalog.skipped) console.warn('catalog:', note);
  // Electron's app.getFileIcon gives Windows' generic program icon for these
  // apps, so icons come from each repository instead.
  const iconDir = path.join(app.getPath('userData'), 'icons');
  await Promise.all(catalog.apps.map(async (a) => {
    const icon = await loadIcon(a, { fetch: net.fetch, iconDir });
    if (icon) icons.set(a.id, icon);
  }));
}

// AB Apps' own updates ------------------------------------------------------

function selfReleaseInfo() {
  if (!selfRelease) return null;
  const { version, publishedAt, installer } = selfRelease;
  return { version, newer: isNewer(version, app.getVersion()), publishedAt, hasInstaller: Boolean(installer) };
}

/** Looks for a new AB Apps when it opens. Problems are left for a manual check to report. */
function checkSelfQuietly() {
  if (!app.isPackaged) return;
  latestRelease(SELF_REPO, net.fetch)
    .then((release) => {
      selfRelease = release;
      if (selfReleaseInfo().newer) win?.webContents.send('update-found', selfReleaseInfo());
    })
    .catch(() => {});
}

async function installSelfUpdate() {
  const release = selfRelease;
  if (!selfReleaseInfo()?.newer || !release.installer) throw new UserError('Check for updates first.');
  if (!app.isPackaged) throw new UserError('Updates are installed from the installed app, not from a development copy.');

  let lastPercent = -1;
  const file = await downloadInstaller(release.installer, downloadsDir(), net.fetch, (received, total) => {
    const percent = Math.floor((received / total) * 100);
    if (percent !== lastPercent) win?.webContents.send('update-progress', { percent: (lastPercent = percent) });
  }).catch((err) => {
    throw new UserError(err.message);
  });
  if (jobs.size) throw new UserError('Wait for the apps being installed to finish, then try again.');

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Install update?',
    message: `Install AB Apps ${release.version} now?`,
    detail: 'AB Apps closes while the update installs and opens again afterward. Your apps stay open, and you stay signed in.',
    buttons: ['Install now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { installing: false };

  // --updated: the installer waits for this app to close, keeps the shortcuts
  // as they are, and opens AB Apps again when it finishes.
  await new Promise((resolve, reject) => {
    const child = spawn(file, ['--updated', '--force-run'], { detached: true, stdio: 'ignore' });
    child.once('spawn', resolve);
    child.once('error', (err) => reject(new UserError(`The installer couldn't be started: ${err.message}`)));
    child.unref();
  });
  app.quit();
  return { installing: true };
}

// Window ----------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: 'AB Apps',
    icon: APP_ICON,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Apps are often updated or removed outside AB Apps; look again on return.
  win.on('focus', () => {
    if (session && Date.now() - lastRefresh > 5000) refreshApps().catch(() => {});
  });
  win.on('close', confirmClose);
  win.on('closed', () => {
    win = null;
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

let closeConfirmed = false;

/** Asks before closing while an installer is running, since closing would leave that app half updated. */
function confirmClose(event) {
  if (closeConfirmed || !jobs.size) return;
  event.preventDefault();
  dialog
    .showMessageBox(win, {
      type: 'question',
      title: 'AB Apps',
      message: 'Apps are still being installed.',
      detail: 'If you close AB Apps now, the app being installed may not work until it is installed again.',
      buttons: ['Close anyway', 'Keep open'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    .then(({ response }) => {
      if (response !== 0) return;
      closeConfirmed = true;
      win.close();
    });
}

// Data the window shows ---------------------------------------------------------

function appState() {
  return { ...screenState(), theme: nativeTheme.themeSource, version: app.getVersion(), release: selfReleaseInfo() };
}

function screenState() {
  const config = loadConfig();
  if (!store) return { screen: 'folder', dataDir: config.dataDir ?? null, suggested: suggestedFolder() };
  if (!store.isDataFolder()) return { screen: 'setup', dataDir: store.dataDir };
  if (!session) {
    const people = store
      .people()
      .filter((p) => p.active)
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { screen: 'login', dataDir: store.dataDir, people, lastPersonId: config.lastPersonId ?? null };
  }
  return {
    screen: 'app',
    dataDir: store.dataDir,
    me: publicPerson(me()),
    apps: appsState(),
    catalogSource: catalog.source,
    identityPath: identity.identityPath(app.getPath('userData')),
  };
}

// IPC -----------------------------------------------------------------------------

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      if (!(err instanceof UserError)) console.error(channel, err);
      return { ok: false, error: err instanceof UserError ? err.message : `Something went wrong: ${err.message}` };
    }
  });
}

function registerHandlers() {
  handle('state:get', () => appState());

  handle('folder:choose', async () => {
    const suggested = suggestedFolder();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose the AB Apps folder',
      defaultPath: store?.dataDir ?? (suggested && fs.existsSync(path.dirname(suggested)) ? path.dirname(suggested) : undefined),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return appState();
    if (session) signOut();
    saveConfig({ dataDir: filePaths[0] });
    openStore();
    return appState();
  });

  handle('folder:open', () => {
    if (!store) throw new UserError('Choose the AB Apps folder first.');
    shell.openPath(store.dataDir);
  });

  handle('theme:set', (theme) => {
    if (!THEMES.includes(theme)) throw new UserError('Choose a theme.');
    saveConfig({ theme });
    applyTheme();
    return theme;
  });

  handle('setup:create', ({ name, pin }) => {
    if (!store || store.isDataFolder()) throw new UserError('This folder is already set up.');
    const people = [];
    const { errors, person } = savePerson(people, { name, pin, class: 'manager' }, null, new Date());
    fail(errors);
    store.saveSettings(store.settings());
    store.savePeople(people); // last, since its presence marks the folder as set up
    signIn(person);
    prepareApps().catch((err) => console.error('apps', err));
    return appState();
  });

  handle('auth:login', ({ personId, pin }) => {
    if (!store) throw new UserError('Choose the AB Apps folder first.');
    const wait = lockout.wait(personId);
    if (wait) throw new UserError(`Too many wrong PINs. Try again in ${wait} seconds.`);
    const person = store.people().find((p) => p.id === personId && p.active);
    if (!person) throw new UserError('Choose your name.');
    if (!verifyPin(pin, currentPin(person, store.profile(person.id)))) {
      lockout.fail(personId);
      throw new UserError("That PIN isn't right.");
    }
    lockout.clear(personId);
    signIn(person);
    prepareApps().catch((err) => console.error('apps', err));
    return appState();
  });

  handle('auth:logout', () => {
    signOut();
    return appState();
  });

  handle('pin:change', ({ current, next }) => {
    const person = me();
    const profile = store.profile(person.id);
    if (!verifyPin(current, currentPin(person, profile))) throw new UserError("Your current PIN isn't right.");
    fail([pinProblem(next)].filter(Boolean));
    profile.pin = hashPin(next);
    store.saveProfile(person.id, profile);
  });

  // Apps ----------------------------------------------------------------------------

  handle('apps:refresh', async () => {
    me();
    await reloadCatalog();
    await refreshApps({ withReleases: true });
    return appsState();
  });

  handle('apps:install', (id) => {
    if (!myApps().some((a) => a.id === id)) throw new UserError("That app isn't one of yours.");
    queueJob(id);
    return appsState();
  });

  handle('apps:install-all', () => {
    for (const a of appsState()) {
      const missing = !a.installed && a.latest?.hasInstaller;
      const behind = a.updateAvailable && a.installed.scope === 'user' && a.latest.hasInstaller;
      if (missing || behind) queueJob(a.id);
    }
    return appsState();
  });

  handle('apps:open', async (id) => {
    const a = myApps().find((x) => x.id === id);
    if (!a) throw new UserError("That app isn't one of yours.");
    const install = await findInstall(a);
    if (!install) {
      sendApps();
      throw new UserError(`${a.name} isn't installed on this computer.`);
    }
    try {
      await installed.launch(install.exe);
    } catch (err) {
      throw new UserError(`${a.name} couldn't be opened: ${err.message}`);
    }
  });

  // AB Apps' own updates --------------------------------------------------------------

  handle('update:check', async () => {
    try {
      selfRelease = await latestRelease(SELF_REPO, net.fetch);
    } catch (err) {
      throw new UserError(err.message);
    }
    return selfReleaseInfo();
  });

  handle('update:install', () => {
    selfInstalling ??= installSelfUpdate().finally(() => {
      selfInstalling = null;
    });
    return selfInstalling;
  });

  handle('update:page', () => shell.openExternal(selfRelease ? `${releasesPage(SELF_REPO)}/tag/v${selfRelease.version}` : releasesPage(SELF_REPO)));

  // Manager ---------------------------------------------------------------------------

  handle('mgr:people', () => {
    asManager();
    return store
      .people()
      .map(publicPerson)
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  });

  handle('mgr:person:save', (input) => {
    const actor = asManager();
    const people = store.people();
    const { errors } = savePerson(people, input, actor.id, new Date());
    fail(errors);
    store.savePeople(people);
    if (input.id === actor.id) signIn(people.find((p) => p.id === actor.id), session.signedInAt); // a new name reaches identity.json
  });

  handle('mgr:access', () => {
    asManager();
    const { access } = store.settings();
    return {
      classes: CLASSES.map((c) => ({ id: c, name: CLASS_NAMES[c] })),
      apps: catalog.apps.map((a) => ({
        id: a.id,
        name: a.name,
        classes: Array.isArray(access[a.id]) ? access[a.id] : a.classes,
        defaults: a.classes,
      })),
    };
  });

  handle('mgr:access:save', async (input) => {
    asManager();
    const settings = store.settings();
    fail(saveAccess(settings, input, catalog.apps));
    store.saveSettings(settings);
    await refreshApps({ withReleases: true });
  });

  handle('mgr:services', () => {
    asManager();
    return publicServices(store.services());
  });

  handle('mgr:services:save', (input) => {
    asManager();
    const { errors, services } = readServices(input, store.services());
    fail(errors);
    store.saveServices(services);
    return publicServices(services);
  });

  // Tests what's on the form, before it's saved. Connecting is the test: a
  // relay that trusts the office's address turns away other networks.
  handle('mgr:services:test-mail', async (input) => {
    asManager();
    const { errors, services } = readServices({ mail: input });
    fail(errors);
    try {
      await verifyConnection(services.mail);
    } catch (err) {
      throw new UserError(`The mail server didn't accept a connection from this computer: ${err.message}`);
    }
  });

  handle('mgr:services:test-website', async (input) => {
    asManager();
    const { errors, services } = readServices({ website: input }, store.services());
    fail(errors);
    try {
      return (await listForms(services.website, { fetch: net.fetch })).length;
    } catch (err) {
      throw new UserError(err.message);
    }
  });
}

app.setAppUserModelId(APP_ID);

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  if (!isPrimaryInstance) return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]),
  );
  applyTheme();
  nativeTheme.on('updated', () => win?.setBackgroundColor(windowBackground()));
  try {
    fs.rmSync(downloadsDir(), { recursive: true, force: true });
  } catch {
    // An installer that just ran may still be closing; it is removed next time.
  }
  openStore();
  resumeSession();
  registerHandlers();
  createWindow();
  checkSelfQuietly();
  catalogReady = reloadCatalog();
  if (session) prepareApps().catch((err) => console.error('apps', err));
});

app.on('window-all-closed', () => app.quit());
