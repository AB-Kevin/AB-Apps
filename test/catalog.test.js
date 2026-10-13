'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateCatalog, loadCatalog, loadIcon, appsFor, CATALOG_URL } = require('../src/main/catalog');

const BUNDLED = path.join(__dirname, '..', 'catalog.json');
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ab-apps-catalog-'));

const entry = (changes = {}) => ({
  id: 'billmanager',
  name: 'BillManager',
  description: 'Bills.',
  repo: 'AB-Kevin/BillManager',
  appId: 'com.billmanager.filemanager',
  productName: 'BillManager',
  classes: ['manager', 'employee'],
  ...changes,
});

test('the built-in catalog lists the six apps, all valid', () => {
  const { apps, skipped } = validateCatalog(JSON.parse(fs.readFileSync(BUNDLED, 'utf8')));
  assert.deepEqual(skipped, []);
  assert.deepEqual(apps.map((a) => a.name), ['BillManager', 'Duplicate Checker', 'ApplicationManager', 'FormTracker', 'KeepTime', 'SendNewsletters']);
});

test('entries that could run something unexpected are left out', () => {
  const { apps, skipped } = validateCatalog({
    apps: [
      entry(),
      entry({ id: 'other', repo: 'someone-else/BillManager' }),
      entry({ id: 'nested', repo: 'AB-Kevin/BillManager/extra' }),
      entry({ id: 'escape', productName: '..\\..\\Windows\\notepad' }),
      entry({ id: 'slash', productName: 'Bill/Manager' }),
      entry({ id: 'Upper' }),
      entry({ id: 'cls', classes: ['admin'] }),
      entry(), // the same id again
    ],
  });
  assert.deepEqual(apps.map((a) => a.id), ['billmanager']);
  assert.equal(skipped.length, 7);
  assert.match(skipped[0], /owned by AB-Kevin/);
  assert.match(skipped.at(-1), /earlier entry/);
});

test('a catalog without an apps list offers nothing', () => {
  assert.deepEqual(validateCatalog(null).apps, []);
  assert.deepEqual(validateCatalog({ apps: 'nope' }).apps, []);
});

test('the catalog comes from GitHub and is saved for when GitHub is unreachable', async () => {
  const dir = tempDir();
  const cachePath = path.join(dir, 'catalog.json');
  const remote = { apps: [entry({ id: 'from-github' })] };
  let asked = null;
  const online = async (url) => {
    asked = url;
    return new Response(JSON.stringify(remote));
  };
  const first = await loadCatalog({ fetch: online, cachePath, bundledPath: BUNDLED });
  assert.equal(asked, CATALOG_URL);
  assert.equal(first.source, 'github');
  assert.deepEqual(first.apps.map((a) => a.id), ['from-github']);

  const offline = async () => {
    throw new TypeError('fetch failed');
  };
  const second = await loadCatalog({ fetch: offline, cachePath, bundledPath: BUNDLED });
  assert.equal(second.source, 'saved');
  assert.deepEqual(second.apps.map((a) => a.id), ['from-github']);

  fs.rmSync(cachePath);
  const third = await loadCatalog({ fetch: offline, cachePath, bundledPath: BUNDLED });
  assert.equal(third.source, 'built-in');
  assert.equal(third.apps.length, 6);
});

test('a broken catalog on GitHub doesn\'t replace a good saved one', async () => {
  const dir = tempDir();
  const cachePath = path.join(dir, 'catalog.json');
  fs.writeFileSync(cachePath, JSON.stringify({ apps: [entry({ id: 'saved' })] }));
  const broken = async () => new Response(JSON.stringify({ apps: [entry({ repo: 'elsewhere/x' })] }));
  const result = await loadCatalog({ fetch: broken, cachePath, bundledPath: BUNDLED });
  assert.equal(result.source, 'saved');
  assert.deepEqual(JSON.parse(fs.readFileSync(cachePath, 'utf8')).apps[0].id, 'saved');
});

test('icons must be PNGs inside the repository', () => {
  const { apps, skipped } = validateCatalog({
    apps: [
      entry({ id: 'ok', icon: 'build/icon.png' }),
      entry({ id: 'none' }),
      entry({ id: 'up', icon: '../other/icon.png' }),
      entry({ id: 'hidden', icon: 'build/.secret.png' }),
      entry({ id: 'svg', icon: 'build/icon.svg' }),
      entry({ id: 'abs', icon: '/etc/icon.png' }),
    ],
  });
  assert.deepEqual(apps.map((a) => [a.id, a.icon]), [['ok', 'build/icon.png'], ['none', null]]);
  assert.equal(skipped.length, 4);
});

test('an icon is fetched from the repository, checked, and saved for offline use', async () => {
  const iconDir = tempDir();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of the image')]);
  const app = { id: 'billmanager', repo: 'AB-Kevin/BillManager', icon: 'build/icon.png' };
  let asked = null;
  const online = async (url) => {
    asked = url;
    return new Response(png);
  };
  const url = await loadIcon(app, { fetch: online, iconDir });
  assert.equal(asked, 'https://raw.githubusercontent.com/AB-Kevin/BillManager/HEAD/build/icon.png');
  assert.equal(url, `data:image/png;base64,${png.toString('base64')}`);

  // Offline, or answered with something that isn't a PNG: the saved copy is used.
  assert.equal(await loadIcon(app, { fetch: async () => { throw new TypeError('fetch failed'); }, iconDir }), url);
  assert.equal(await loadIcon(app, { fetch: async () => new Response('<html>'), iconDir }), url);
  assert.equal(await loadIcon({ ...app, id: 'other' }, { fetch: async () => new Response('<html>'), iconDir }), null);
  assert.equal(await loadIcon({ ...app, icon: null }, { fetch: online, iconDir }), null);
});

test('managers\' access choices replace the catalog\'s classes', () => {
  const apps = validateCatalog({ apps: [entry({ id: 'a', classes: ['manager'] }), entry({ id: 'b', classes: ['manager', 'contractor'] })] }).apps;
  assert.deepEqual(appsFor('contractor', apps).map((a) => a.id), ['b']);
  assert.deepEqual(appsFor('contractor', apps, { a: ['contractor'], b: [] }).map((a) => a.id), ['a']);
  assert.deepEqual(appsFor('employee', apps).map((a) => a.id), []);
});
