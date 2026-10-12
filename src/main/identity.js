'use strict';

// Who is signed in to AB Apps on this computer, for the other apps to read,
// so people sign in once. It is kept in AB Apps' folder in this Windows
// account's AppData, so other Windows accounts on the same computer (a shared
// remote desktop server, say) each have their own:
//
//   %APPDATA%\AB Apps\identity.json
//   { "version": 1, "personId": "…", "name": "Jane Doe",
//     "class": "manager" | "employee" | "contractor",
//     "signedInAt": "2026-10-12T20:00:00.000Z", "dataDir": "C:\\…\\AB Apps" }
//
// The file exists only while someone is signed in. An app that finds no file,
// or one with a version it doesn't know, should fall back to its own sign-in
// or settings. Like the PIN, this is a convenience and not a security
// boundary: anyone using this Windows account can change the file.

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

const VERSION = 1;
const identityPath = (userDataDir) => path.join(userDataDir, 'identity.json');

function writeIdentity(userDataDir, person, { signedInAt, dataDir }) {
  writeJson(identityPath(userDataDir), {
    version: VERSION,
    personId: person.id,
    name: person.name,
    class: person.class,
    signedInAt,
    dataDir,
  });
}

function readIdentity(userDataDir) {
  try {
    const identity = readJson(identityPath(userDataDir), null);
    return identity?.version === VERSION ? identity : null;
  } catch {
    return null;
  }
}

function clearIdentity(userDataDir) {
  fs.rmSync(identityPath(userDataDir), { force: true });
}

module.exports = { VERSION, identityPath, writeIdentity, readIdentity, clearIdentity };
