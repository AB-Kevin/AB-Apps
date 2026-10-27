'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Calls the main process and unwraps { ok, value, error }. */
async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

contextBridge.exposeInMainWorld('api', {
  getState: () => call('state:get'),
  chooseFolder: () => call('folder:choose'),
  openFolder: () => call('folder:open'),
  setTheme: (theme) => call('theme:set', theme),
  setup: (input) => call('setup:create', input),
  login: (personId, pin) => call('auth:login', { personId, pin }),
  logout: () => call('auth:logout'),
  changePin: (current, next) => call('pin:change', { current, next }),

  refreshApps: () => call('apps:refresh'),
  installApp: (id) => call('apps:install', id),
  installAll: () => call('apps:install-all'),
  openApp: (id) => call('apps:open', id),
  onAppsChanged: (callback) => ipcRenderer.on('apps-changed', (_event, apps) => callback(apps)),

  checkForUpdate: () => call('update:check'),
  installUpdate: () => call('update:install'),
  openReleasePage: () => call('update:page'),
  onUpdateFound: (callback) => ipcRenderer.on('update-found', (_event, release) => callback(release)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (_event, progress) => callback(progress)),

  people: () => call('mgr:people'),
  savePerson: (input) => call('mgr:person:save', input),
  access: () => call('mgr:access'),
  saveAccess: (input) => call('mgr:access:save', input),
  services: () => call('mgr:services'),
  saveServices: (input) => call('mgr:services:save', input),
  testMail: (input) => call('mgr:services:test-mail', input),
  testWebsite: (input) => call('mgr:services:test-website', input),
});
