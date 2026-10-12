'use strict';

// Finding and running the apps on this computer. electron-builder's installers
// register each app under Uninstall\<GUID>, where the GUID is a version 5
// UUID made from the app's appId. That finds the app whatever its display
// name, in HKCU for a per-user install or HKLM for an install for all users.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

// electron-builder's namespace for the GUIDs it makes from appIds.
const BUILDER_NAMESPACE = '50e065bc-3134-11e6-9bab-38c9862bdaf3';
const UNINSTALL_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** The GUID electron-builder registers an app under. */
function appGuid(appId) {
  const namespace = Buffer.from(BUILDER_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(Buffer.concat([namespace, Buffer.from(appId, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

/** The string values in `reg query` output, as { name: value }. */
function parseRegQuery(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s+(\S.*?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

/** Runs `reg query` on a key. Resolves to its output, or null if the key doesn't exist. */
function regQuery(key) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key], { windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/**
 * Where an app is installed: { version, scope, dir, exe }, with scope 'user'
 * or 'machine', or null if it isn't installed. `query` and `exists` are
 * regQuery and fs.existsSync, replaceable in tests.
 */
async function findInstall({ appId, productName }, { query = regQuery, exists = fs.existsSync } = {}) {
  const guid = appGuid(appId);
  const places = [
    ['user', `HKCU\\${UNINSTALL_KEY}\\${guid}`],
    ['machine', `HKLM\\${UNINSTALL_KEY}\\${guid}`],
    ['machine', `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`],
  ];
  for (const [scope, key] of places) {
    const output = await query(key);
    if (!output) continue;
    const values = parseRegQuery(output);
    // "C:\...\Programs\BillManager\Uninstall BillManager.exe" /currentuser
    const uninstaller = /^"([^"]+)"/.exec(values.UninstallString ?? '')?.[1];
    if (!uninstaller) continue;
    const dir = path.dirname(uninstaller);
    const exe = path.join(dir, `${productName}.exe`);
    if (!exists(exe)) continue; // removed by hand, leaving the registry behind
    return { version: values.DisplayVersion ?? null, scope, dir, exe };
  }
  return null;
}

/** Whether `exe` is running for this Windows account. */
function isRunning(exe) {
  const image = path.basename(exe);
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', `IMAGENAME eq ${image}`, '/FI', `USERNAME eq ${os.userInfo().username}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true },
      (err, stdout) => resolve(!err && stdout.toLowerCase().includes(`"${image.toLowerCase()}"`)),
    );
  });
}

/** Opens an installed app on its own, so it stays open if AB Apps closes. */
function launch(exe) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}

/**
 * Runs an electron-builder installer silently for this Windows account only,
 * so no administrator prompt appears. An app already installed is updated in
 * its own folder; `--updated` keeps its shortcuts as they are. Resolves when
 * the installer finishes.
 */
function runInstaller(installer, { update }) {
  const args = ['/S', '/currentuser', ...(update ? ['--updated'] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(installer, args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The installer took more than ten minutes and was stopped.'));
    }, INSTALL_TIMEOUT_MS);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`The installer couldn't be started: ${err.message}`));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`The installer stopped with error ${code}.`));
    });
  });
}

module.exports = { appGuid, parseRegQuery, findInstall, isRunning, launch, runInstaller };
