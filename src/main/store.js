'use strict';

// The AB Apps folder, usually a folder in OneDrive that everyone has synced.
// OneDrive can't merge two computers' changes to the same file, so every file
// has exactly one kind of writer:
//
//   shared/people.json         managers: names, classes, PINs they set
//   shared/settings.json       managers: which classes get which apps
//   shared/services.json       managers: the mail server and website the apps share
//   people/<id>/profile.json   only that person: a PIN they chose
//
// Managers' saves re-read the file and change only the record being saved, so
// two managers editing different people a minute apart don't undo each other.

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('ab-common/jsonfile');
const { DEFAULT_SERVICES } = require('./services');

const DEFAULT_SETTINGS = {
  access: {}, // { [app id]: [classes] }; apps not listed use the catalog's classes
};

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  shared(name) {
    return path.join(this.dataDir, 'shared', name);
  }

  personal(personId, name) {
    if (!/^[0-9a-f-]{36}$/i.test(personId)) throw new Error('Unknown person.');
    return path.join(this.dataDir, 'people', personId, name);
  }

  isDataFolder() {
    return fs.existsSync(this.shared('people.json'));
  }

  people() {
    return readJson(this.shared('people.json'), { people: [] }).people;
  }

  savePeople(people) {
    writeJson(this.shared('people.json'), { people });
  }

  settings() {
    return { ...DEFAULT_SETTINGS, ...readJson(this.shared('settings.json'), {}) };
  }

  saveSettings(settings) {
    writeJson(this.shared('settings.json'), settings);
  }

  services() {
    return { ...DEFAULT_SERVICES, ...readJson(this.shared('services.json'), {}) };
  }

  saveServices(services) {
    writeJson(this.shared('services.json'), services);
  }

  profile(personId) {
    return readJson(this.personal(personId, 'profile.json'), {});
  }

  saveProfile(personId, profile) {
    writeJson(this.personal(personId, 'profile.json'), profile);
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
