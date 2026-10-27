'use strict';

// The list of apps AB Apps offers. The copy on GitHub is the one that counts,
// so adding an app is one entry in catalog.json on the main branch: every
// computer picks it up the next time AB Apps opens, without a new release of
// AB Apps. The last list read is kept on this computer, and the one built
// into AB Apps is used if neither GitHub nor that copy can be read.
//
// AB Apps downloads and runs whatever installer a listed repository's latest
// release names, so only repositories owned by ALLOWED_OWNERS are accepted.

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('ab-common/jsonfile');

const CATALOG_URL = 'https://raw.githubusercontent.com/AB-Kevin/ab-apps/HEAD/catalog.json';
const ALLOWED_OWNERS = ['AB-Kevin'];
const CLASSES = ['manager', 'employee', 'contractor'];

const isText = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;

/** Problems with one catalog entry; an empty list means it can be offered. */
function entryProblems(entry) {
  const problems = [];
  if (!/^[a-z0-9-]{1,40}$/.test(entry?.id ?? '')) problems.push('id must be 1 to 40 lowercase letters, digits or hyphens');
  if (!isText(entry?.name, 60)) problems.push('name is missing or too long');
  if (entry?.description != null && !isText(entry.description, 200)) problems.push('description is too long');
  const [owner, repo, extra] = String(entry?.repo ?? '').split('/');
  if (!ALLOWED_OWNERS.includes(owner) || !/^[A-Za-z0-9._-]+$/.test(repo ?? '') || extra !== undefined) {
    problems.push(`repo must be a repository owned by ${ALLOWED_OWNERS.join(' or ')}`);
  }
  // Together these find the installed copy: the registry key comes from appId,
  // and electron-builder names the program <productName>.exe.
  if (!/^[A-Za-z0-9.-]{1,100}$/.test(entry?.appId ?? '')) problems.push('appId must be the app\'s build.appId');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/.test(entry?.productName ?? '') || entry.productName.includes('..')) {
    problems.push('productName must be the app\'s productName');
  }
  // A PNG in the repository, shown before the app is installed too.
  if (entry?.icon != null && (!/^[A-Za-z0-9._/-]{1,200}\.png$/.test(entry.icon) || entry.icon.split('/').some((part) => !part || part.startsWith('.')))) {
    problems.push('icon must be the path of a PNG in the repository, such as build/icon.png');
  }
  if (!Array.isArray(entry?.classes) || entry.classes.some((c) => !CLASSES.includes(c))) {
    problems.push(`classes must list any of ${CLASSES.join(', ')}`);
  }
  return problems;
}

/**
 * The entries of a catalog that can be offered, in order, plus a note for
 * each one left out. A repeated id keeps its first entry.
 */
function validateCatalog(catalog) {
  const apps = [];
  const skipped = [];
  for (const entry of Array.isArray(catalog?.apps) ? catalog.apps : []) {
    const problems = entryProblems(entry);
    if (!problems.length && apps.some((a) => a.id === entry.id)) problems.push('id is used by an earlier entry');
    if (problems.length) {
      skipped.push(`${entry?.name ?? entry?.id ?? 'An entry'}: ${problems.join('; ')}`);
      continue;
    }
    const { id, name, description = '', repo, appId, productName, icon = null, classes } = entry;
    apps.push({ id, name: name.trim(), description: description.trim(), repo, appId, productName, icon, classes: [...new Set(classes)] });
  }
  return { apps, skipped };
}

/**
 * Reads the catalog from GitHub, falling back to the copy saved at
 * `cachePath` and then to the one at `bundledPath`. Returns { apps, skipped,
 * source }, where source is 'github', 'saved' or 'built-in'. `fetch` is
 * Electron's net.fetch, which uses Windows' proxy settings.
 */
async function loadCatalog({ fetch, cachePath, bundledPath }) {
  try {
    const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      const catalog = await response.json();
      const result = validateCatalog(catalog);
      if (result.apps.length) {
        writeJson(cachePath, catalog);
        return { ...result, source: 'github' };
      }
    }
  } catch {
    // offline, or GitHub is unreachable; use a saved copy
  }
  try {
    const result = validateCatalog(readJson(cachePath, null));
    if (result.apps.length) return { ...result, source: 'saved' };
  } catch {
    // a damaged saved copy is replaced the next time GitHub is reachable
  }
  return { ...validateCatalog(JSON.parse(fs.readFileSync(bundledPath, 'utf8'))), source: 'built-in' };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_ICON_BYTES = 512 * 1024;

/**
 * An app's icon as a data URL for the window, from its repository, saved in
 * `iconDir` for when GitHub can't be reached. Null if it has none or none
 * could be fetched; the window shows the app's initial instead.
 */
async function loadIcon(app, { fetch, iconDir }) {
  if (!app.icon) return null;
  const saved = path.join(iconDir, `${app.id}.png`);
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${app.repo}/HEAD/${app.icon}`, { signal: AbortSignal.timeout(10000) });
    const bytes = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    if (bytes && bytes.length <= MAX_ICON_BYTES && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      fs.mkdirSync(iconDir, { recursive: true });
      fs.writeFileSync(saved, bytes);
    }
  } catch {
    // offline; use the saved copy
  }
  try {
    return `data:image/png;base64,${fs.readFileSync(saved).toString('base64')}`;
  } catch {
    return null;
  }
}

/** The apps a class of person gets: managers can change the catalog's defaults in the shared settings. */
function appsFor(personClass, apps, access = {}) {
  return apps.filter((app) => (Array.isArray(access[app.id]) ? access[app.id] : app.classes).includes(personClass));
}

module.exports = { CATALOG_URL, ALLOWED_OWNERS, CLASSES, validateCatalog, loadCatalog, loadIcon, appsFor };
