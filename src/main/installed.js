'use strict';

// Finding and running the apps on this computer. Finding an install from its
// appId and opening an app are ab-common's (installs.js), shared with the apps
// that open AB Apps; checking whether an app is running and running its
// installer are AB Apps' own.

const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { appGuid, parseRegQuery, findInstall, launch } = require('ab-common/installs');

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

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
