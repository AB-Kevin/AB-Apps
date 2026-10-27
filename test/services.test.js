'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readServices, publicServices, DEFAULT_SERVICES } = require('../src/main/services');
const { Store } = require('../src/main/store');

const mail = { host: ' relay.example.org ', port: '25', secure: 'false', fromName: 'Anabaptist Brotherhood', fromEmail: 'info@example.org' };
const website = { siteUrl: 'https://example.org/', consumerKey: 'ck_1', consumerSecret: 'cs_1' };

test('the mail server and website are saved tidied', () => {
  const { errors, services } = readServices({ mail, website });
  assert.deepEqual(errors, []);
  assert.deepEqual(services, {
    version: 1,
    mail: { host: 'relay.example.org', port: 25, secure: false, fromName: 'Anabaptist Brotherhood', fromEmail: 'info@example.org' },
    website: { siteUrl: 'https://example.org', consumerKey: 'ck_1', consumerSecret: 'cs_1' },
  });
});

test('a section left blank is turned off', () => {
  const blank = { host: '', port: '25', secure: 'false', fromName: '', fromEmail: '' };
  const { errors, services } = readServices({ mail: blank, website: { siteUrl: '', consumerKey: '', consumerSecret: '' } });
  assert.deepEqual(errors, []);
  assert.equal(services.mail, null);
  assert.equal(services.website, null);
});

test('a half-filled section is refused', () => {
  assert.match(readServices({ mail: { ...mail, host: '' } }).errors.join(), /mail server/);
  assert.match(readServices({ mail: { ...mail, port: '70000' } }).errors.join(), /1 to 65535/);
  assert.match(readServices({ mail: { ...mail, fromEmail: 'info' } }).errors.join(), /address emails come from/);
  assert.match(readServices({ website: { ...website, siteUrl: 'http://example.org' } }).errors.join(), /https:\/\//);
  assert.match(readServices({ website: { ...website, consumerSecret: '' } }).errors.join(), /consumer key and secret/);
});

test('a blank secret keeps the saved one, and the manager\'s page never gets it', () => {
  const saved = readServices({ website }).services;
  const { errors, services } = readServices({ website: { ...website, consumerKey: 'ck_2', consumerSecret: '' } }, saved);
  assert.deepEqual(errors, []);
  assert.deepEqual(services.website, { siteUrl: 'https://example.org', consumerKey: 'ck_2', consumerSecret: 'cs_1' });
  assert.deepEqual(publicServices(services).website, { siteUrl: 'https://example.org', consumerKey: 'ck_2', hasSecret: true });
});

test('the services file is read with defaults and written to the shared folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-apps-services-'));
  const store = new Store(dir);
  assert.deepEqual(store.services(), DEFAULT_SERVICES);
  const { services } = readServices({ mail });
  store.saveServices(services);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'services.json'), 'utf8')), services);
  assert.deepEqual(store.services(), services);
});
