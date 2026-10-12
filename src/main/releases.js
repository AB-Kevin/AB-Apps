'use strict';

// Each app's latest release on GitHub, read from the latest.yml that
// electron-builder writes beside the installer. Reading it from the release's
// download link, rather than asking the GitHub API, avoids the API's limit of
// 60 requests an hour per network, which an office checking six apps from
// several computers would reach.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');

const releasesPage = (repo) => `https://github.com/${repo}/releases`;

/** Splits "1.2.3" or "v1.2.3" into [1, 2, 3], or returns null. */
function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? '').trim());
  return match ? match.slice(1).map(Number) : null;
}

/** Whether version `a` is later than version `b`. */
function isNewer(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (!x || !y) return false;
  const i = x.findIndex((part, n) => part !== y[n]);
  return i >= 0 && x[i] > y[i];
}

/** Removes the quotes YAML may put around a value. */
const unquote = (value) => value.trim().replace(/^'(.*)'$|^"(.*)"$/, '$1$2');

/**
 * Reads the parts of an electron-builder latest.yml used here:
 * { version, path, releaseDate, files: [{ url, sha512, size }] }. The file is
 * always this flat shape, so a full YAML parser isn't needed.
 */
function parseLatestYml(text) {
  const info = { files: [] };
  for (const line of String(text).split(/\r?\n/)) {
    const top = /^(\w+):(.*)$/.exec(line);
    if (top) {
      if (top[1] !== 'files') info[top[1]] = unquote(top[2]);
      continue;
    }
    const item = /^\s*(-\s+)?(url|sha512|size):(.*)$/.exec(line);
    if (!item) continue;
    if (item[1]) info.files.push({});
    const file = info.files.at(-1);
    if (file) file[item[2]] = item[2] === 'size' ? Number(unquote(item[3])) : unquote(item[3]);
  }
  return info;
}

/**
 * Reads latest.yml from a repository's latest release, so drafts and
 * pre-releases are never offered. Returns { version, publishedAt, pageUrl,
 * installer }, where installer is { name, size, url, sha512 } or null if the
 * release lists no usable installer. `fetch` is Electron's net.fetch.
 */
async function latestRelease(repo, fetch) {
  const page = releasesPage(repo);
  let response;
  try {
    response = await fetch(`${page}/latest/download/latest.yml`, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error("Couldn't reach GitHub. Check the internet connection and try again.");
  }
  if (response.status === 404) throw new Error('No release is ready yet.');
  if (response.status === 403 || response.status === 429) throw new Error('GitHub is limiting requests from this network. Try again in an hour.');
  if (!response.ok) throw new Error(`GitHub couldn't be checked (error ${response.status}). Try again later.`);

  const latest = parseLatestYml(await response.text());
  const version = String(latest.version ?? '').replace(/^v/, '');
  if (!parseVersion(version)) throw new Error("The latest release doesn't have a version number AB Apps recognizes.");
  // The installer latest.yml names: a plain file name in this release, with its digest and size.
  const file = latest.files.find((f) => f.url === latest.path
    && /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.exe$/.test(f.url ?? '')
    && /^[A-Za-z0-9+/]{86}==$/.test(f.sha512 ?? '') && Number.isSafeInteger(f.size) && f.size > 0);
  return {
    version,
    publishedAt: latest.releaseDate || null,
    pageUrl: `${page}/tag/v${version}`,
    installer: file
      ? { name: file.url, size: file.size, url: `${page}/download/v${version}/${encodeURIComponent(file.url)}`, sha512: file.sha512 }
      : null,
  };
}

/** Whether `filePath` is the installer described, judged by its size and SHA-512 digest. */
async function isInstaller(filePath, { size, sha512 }) {
  try {
    if (!sha512 || fs.statSync(filePath).size !== size) return false;
    const hash = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('base64') === sha512;
  } catch {
    return false;
  }
}

/**
 * Downloads the installer into `dir`, checking it against the size and
 * SHA-512 digest latest.yml gave for it. One already downloaded is reused.
 * Calls onProgress(received, total) as it goes. Returns the file's path.
 */
async function downloadInstaller(installer, dir, fetch, onProgress = () => {}) {
  const target = path.join(dir, installer.name);
  if (await isInstaller(target, installer)) return target;

  fs.mkdirSync(dir, { recursive: true });
  const partPath = `${target}.part`;
  const hash = crypto.createHash('sha512');
  let received = 0;
  const out = fs.createWriteStream(partPath);
  try {
    const response = await fetch(installer.url);
    if (!response.ok) throw new Error(`error ${response.status}`);
    for await (const chunk of response.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await once(out, 'drain');
      onProgress(received, installer.size);
    }
    out.end();
    await once(out, 'close'); // Windows won't run a file that is still open for writing
  } catch {
    out.destroy();
    fs.rmSync(partPath, { force: true });
    throw new Error("The installer couldn't be downloaded. Check the internet connection and try again.");
  }

  if (received !== installer.size || hash.digest('base64') !== installer.sha512) {
    fs.rmSync(partPath, { force: true });
    throw new Error("The downloaded installer didn't match the release on GitHub, so it wasn't used. Try again.");
  }
  fs.renameSync(partPath, target);
  return target;
}

module.exports = { releasesPage, parseVersion, isNewer, parseLatestYml, latestRelease, downloadInstaller };
