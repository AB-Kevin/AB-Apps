'use strict';
/* global api */
// `api` is the main process's interface, from preload.js.

// HTML built with html`...` escapes everything interpolated, except other html`...` results.
class Html {
  constructor(s) {
    this.s = s;
  }
}
const escape = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function show(value) {
  if (value instanceof Html) return value.s;
  if (Array.isArray(value)) return value.map(show).join('');
  if (value == null || value === false) return '';
  return escape(value);
}
function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += show(value) + strings[i + 1];
  });
  return new Html(out);
}
/** ` name` when `on`, for boolean attributes such as selected and checked. */
const flag = (on, name) => (on ? new Html(` ${name}`) : '');

const $ = (selector, root = document) => root.querySelector(selector);
const root = $('#app');
const dialogEl = $('#dialog');
const formatDate = (iso) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));

let state = null; // from the main process: which screen, who's signed in, their apps
let view = null;
let toastTimer = null;
// What each page remembers between visits.
const ui = {};

// Feedback ----------------------------------------------------------------------

function toast(message, { error = false } = {}) {
  const el = $('#toast');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}

function openDialog(content) {
  dialogEl.innerHTML = content.s;
  dialogEl.showModal();
  dialogEl.querySelector('input:not([type=hidden]), select, textarea')?.focus();
}

const closeDialog = () => dialogEl.close();

// Screens before sign-in ---------------------------------------------------------

const logo = html`<img class="logo" src="assets/logo-primary-lockup.jpg" alt="Anabaptist Brotherhood">`;

function folderScreen() {
  const missing = state.dataDir
    ? html`<div class="notice warn">The AB Apps folder <span class="path">${state.dataDir}</span> can't be found. If OneDrive is still
        setting up on this computer, wait for it to finish and try again.</div>`
    : '';
  return html`<div class="center"><div class="panel">
    ${logo}
    <h1>AB Apps</h1>
    <p class="lead">Choose the shared OneDrive folder for AB Apps. It holds the list of people who can sign in, so it has to be
      synced to this computer first. Whoever set up AB Apps can share it with you.</p>
    ${missing}
    ${state.suggested ? html`<p class="caption">On this computer, OneDrive is at <span class="path">${state.suggested.replace(/[\\/][^\\/]+$/, '')}</span>.</p>` : ''}
    <div class="actions">
      <button class="btn btn-primary" data-action="choose-folder">Choose folder</button>
      ${state.dataDir ? html`<button class="btn btn-secondary" data-action="reload">Try again</button>` : ''}
    </div>
  </div></div>`;
}

function setupScreen() {
  return html`<div class="center"><div class="panel">
    ${logo}
    <h1>Set up AB Apps</h1>
    <p class="lead">Nothing is in this folder yet. Add yourself as the first manager; you can add everyone else afterward.</p>
    <p class="path">${state.dataDir}</p>
    <div class="notice">If AB Apps is already in use, don't set it up again. Choose the folder that's been shared with you instead.</div>
    <form data-form="setup">
      <div class="form-error"></div>
      <div class="field"><label for="s-name">Your name</label><input type="text" id="s-name" name="name" maxlength="80" required></div>
      <div class="field-row">
        <div class="field"><label for="s-pin">PIN</label><input type="password" id="s-pin" name="pin" inputmode="numeric" maxlength="8" required>
          <span class="hint">4 to 8 digits.</span></div>
        <div class="field"><label for="s-pin2">PIN again</label><input type="password" id="s-pin2" name="pin2" inputmode="numeric" maxlength="8" required></div>
      </div>
      <button class="btn btn-primary" type="submit">Set up</button>
    </form>
    <div class="panel-foot"><button class="link small" data-action="choose-folder">Choose a different folder</button></div>
  </div></div>`;
}

function loginScreen() {
  return html`<div class="center"><div class="panel">
    ${logo}
    <h1>Sign in</h1>
    <p class="lead">Sign in once here, and the AB apps know who you are.</p>
    <form data-form="login">
      <div class="form-error"></div>
      <div class="field"><label for="l-person">Name</label>
        <select id="l-person" name="personId" required>
          <option value="">Choose your name</option>
          ${state.people.map((p) => html`<option value="${p.id}"${flag(p.id === state.lastPersonId, 'selected')}>${p.name}</option>`)}
        </select></div>
      <div class="field"><label for="l-pin">PIN</label>
        <input class="pin" type="password" id="l-pin" name="pin" inputmode="numeric" maxlength="8" autocomplete="off" required></div>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>
    <div class="panel-foot">
      <p class="caption">AB Apps folder</p>
      <p class="path">${state.dataDir}</p>
      <button class="link small" data-action="choose-folder">Change folder</button>
    </div>
  </div></div>`;
}

// The signed-in app ----------------------------------------------------------------

const NAV = [
  { label: 'Apps', manager: false, items: [['apps', 'My apps']] },
  { label: 'Manage', manager: true, items: [['people', 'People'], ['access', 'App access'], ['services', 'Mail and website']] },
  { label: 'Account', manager: false, items: [['profile', 'Profile'], ['settings', 'Settings']] },
];

const isManager = () => state.me.class === 'manager';
const allowedGroups = () => NAV.filter((g) => !g.manager || isManager());
const allowed = (name) => allowedGroups().some((g) => g.items.some(([key]) => key === name));

function drawShell() {
  root.innerHTML = html`
    <header class="app-header">
      <div class="brand">${logo}<span class="app-name">AB Apps</span></div>
      <div class="who"><span id="update-badge"></span><span>Signed in as <strong>${state.me.name}</strong></span>
        <button class="btn btn-secondary btn-sm" data-action="logout">Sign out</button></div>
    </header>
    <div class="app-body">
      <nav class="nav">
        ${allowedGroups().map(
          (g) => html`<div class="nav-label">${g.label}</div>${g.items.map(
            ([key, label]) => html`<button class="nav-item${key === view ? ' active' : ''}" data-action="nav" data-view="${key}">${label}</button>`,
          )}`,
        )}
      </nav>
      <main class="content" id="content"><p class="loading">Loading…</p></main>
    </div>`.s;
  drawUpdates();
}

function render() {
  if (state.screen !== 'app') $('#toast').hidden = true; // messages belong to whoever was signed in
  if (state.screen === 'folder') root.innerHTML = folderScreen().s;
  else if (state.screen === 'setup') root.innerHTML = setupScreen().s;
  else if (state.screen === 'login') root.innerHTML = loginScreen().s;
  else return go(view && allowed(view) ? view : 'apps');
  $('#l-pin')?.focus();
  if (state.screen === 'login' && !$('#l-person').value) $('#l-person').focus();
}

async function go(name) {
  state = await api.getState();
  if (state.screen !== 'app') return render();
  if (!allowed(name)) name = 'apps';
  view = name;
  drawShell();
  await drawView();
}

/** Redraws the current page's content, keeping the header and menu. */
async function drawView() {
  const name = view;
  const content = $('#content');
  try {
    const body = await VIEWS[name]();
    if (view !== name) return;
    const scroll = content.scrollTop;
    content.innerHTML = body.s;
    content.scrollTop = scroll;
  } catch (err) {
    if (/Sign in first|turned off/.test(err.message)) {
      state = await api.getState();
      render();
      toast(err.message, { error: true });
      return;
    }
    content.innerHTML = html`<div class="page"><div class="notice warn">${err.message}</div>
      <button class="btn btn-secondary" data-action="reload">Try again</button></div>`.s;
  }
}

// My apps ------------------------------------------------------------------------

function appStatus(a) {
  if (a.job) {
    const verb = a.job.op === 'update' ? 'Updating' : 'Installing';
    if (a.job.phase === 'waiting') return { text: `Waiting to ${a.job.op}…` };
    if (a.job.phase === 'downloading') return { text: `${verb}: downloading${a.job.percent === null ? '' : ` ${a.job.percent}%`}…`, percent: a.job.percent ?? 0 };
    return { text: `${verb}…`, percent: null };
  }
  if (a.problem) return { text: a.problem, problem: true };
  if (a.installed) {
    if (a.updateAvailable) {
      return a.installed.scope === 'machine'
        ? { text: `Version ${a.installed.version}, installed for everyone. To get version ${a.latest.version}, uninstall it in Windows Settings, then install it here.` }
        : { text: `Version ${a.installed.version}. Version ${a.latest.version} is available.` };
    }
    return { text: `Version ${a.installed.version}${a.latest ? ', the latest' : ''}.` };
  }
  if (!a.checked) return { text: 'Checking…' };
  if (a.latestError) return { text: `Not installed. ${a.latestError}`, problem: true };
  if (!a.latest?.hasInstaller) return { text: "Not installed. Its latest release doesn't have an installer yet." };
  return { text: `Not installed. Version ${a.latest.version} is available.` };
}

function appTile(a) {
  const status = appStatus(a);
  const busy = Boolean(a.job);
  const canInstall = !a.installed && a.latest?.hasInstaller;
  const canUpdate = a.updateAvailable && a.installed.scope === 'user' && a.latest.hasInstaller;
  const icon = a.icon
    ? html`<img class="app-icon" src="${a.icon}" alt="">`
    : html`<span class="app-icon" aria-hidden="true">${a.name.slice(0, 1)}</span>`;
  return html`<div class="card app-tile" data-app="${a.id}">
    <div class="app-tile-head">${icon}<div><h3>${a.name}</h3><p class="desc">${a.description}</p></div></div>
    <p class="app-status${status.problem ? ' problem' : ''}">${status.text}</p>
    ${busy ? html`<div class="progress${status.percent == null ? ' indeterminate' : ''}"><span style="width: ${status.percent ?? 30}%"></span></div>` : ''}
    <div class="actions">
      ${a.installed ? html`<button class="btn btn-secondary" data-action="open-app" data-id="${a.id}"${flag(busy, 'disabled')}>Open</button>` : ''}
      ${canInstall || canUpdate
        ? html`<button class="btn btn-ghost" data-action="install-app" data-id="${a.id}"${flag(busy, 'disabled')}>${canUpdate ? 'Update' : 'Install'}</button>`
        : ''}
    </div>
  </div>`;
}

function appsBody() {
  const apps = state.apps;
  const pending = apps.filter((a) => !a.job && ((!a.installed && a.latest?.hasInstaller) || (a.updateAvailable && a.installed.scope === 'user' && a.latest.hasInstaller)));
  const working = apps.filter((a) => a.job).length;
  const note = working
    ? `Installing ${working === 1 ? 'one app' : `${working} apps`}. You can open other apps meanwhile.`
    : pending.length
      ? `${pending.length === 1 ? 'One app needs' : `${pending.length} apps need`} installing or updating.`
      : apps.length && apps.every((a) => a.checked) ? 'Everything is installed and up to date.' : '';
  return html`<div class="page">
    <div class="page-head"><div><h1>My apps</h1><p class="sub">${note}</p></div>
      <div class="actions">
        ${pending.length ? html`<button class="btn btn-primary" data-action="install-all">${pending.some((a) => a.installed) ? 'Install and update all' : 'Install all'}</button>` : ''}
        <button class="btn btn-secondary" data-action="refresh-apps"${flag(working > 0, 'disabled')}>Check for updates</button>
      </div></div>
    ${apps.length
      ? html`<div class="app-grid">${apps.map(appTile)}</div>`
      : html`<div class="empty">No apps are set up for ${state.me.className.toLowerCase()}s yet. A manager can change that under App access.</div>`}
  </div>`;
}

async function appsView() {
  return appsBody();
}

/** Redraws My apps in place as installs move along, without a trip to the main process. */
function drawApps() {
  if (view !== 'apps' || !$('#content')) return;
  const content = $('#content');
  const scroll = content.scrollTop;
  content.innerHTML = appsBody().s;
  content.scrollTop = scroll;
}

api.onAppsChanged((apps) => {
  if (state?.screen !== 'app') return;
  state.apps = apps;
  drawApps();
});

// Manager: people -----------------------------------------------------------------

const CLASS_OPTIONS = [['manager', 'Manager'], ['employee', 'Employee'], ['contractor', 'Contractor']];

async function peopleView() {
  const people = await api.people();
  ui.people = people;
  return html`<div class="page">
    <div class="page-head"><div><h1>People</h1><p class="sub">Everyone who signs in to AB Apps. Managers manage people and app access;
      employees and contractors get the apps set for them.</p></div>
      <div class="actions"><button class="btn btn-primary" data-action="edit-person">Add person</button></div></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th>Class</th><th>Status</th><th></th></tr></thead>
      <tbody>${people.map((p) => html`<tr class="${p.active ? '' : 'is-off'}"><td>${p.name}</td><td>${p.className}</td>
        <td>${p.active ? 'Active' : 'Turned off'}</td>
        <td class="row-actions"><button class="btn btn-ghost btn-sm" data-action="edit-person" data-id="${p.id}">Edit</button></td></tr>`)}
      </tbody></table></div>
  </div>`;
}

function personDialog(person) {
  const isMe = person?.id === state.me.id;
  openDialog(html`<form data-form="person">
    <h2>${person ? `Edit ${person.name}` : 'Add a person'}</h2>
    <div class="form-error"></div>
    <input type="hidden" name="id" value="${person?.id ?? ''}">
    <div class="field"><label for="p-name">Name</label><input type="text" id="p-name" name="name" maxlength="80" value="${person?.name ?? ''}" required>
      <span class="hint">As it should appear at sign-in and on comments.</span></div>
    <div class="field"><span class="field-label">Class</span>
      <div class="choices" role="radiogroup" aria-label="Class">
        ${CLASS_OPTIONS.map(([value, label]) => html`<label class="check"><input type="radio" name="class" value="${value}"${flag((person?.class ?? 'contractor') === value, 'checked')}${flag(isMe && value !== 'manager', 'disabled')}> ${label}</label>`)}
      </div></div>
    <div class="field"><label for="p-pin">${person ? 'New PIN' : 'PIN'}</label>
      <input type="password" id="p-pin" name="pin" inputmode="numeric" maxlength="8"${flag(!person, 'required')}>
      <span class="hint">${person ? 'Leave blank to keep their PIN. ' : ''}4 to 8 digits. They can change it on their Profile.</span></div>
    ${person ? html`<label class="check"><input type="checkbox" name="active"${flag(person.active, 'checked')}${flag(isMe, 'disabled')}> Can sign in</label>` : ''}
    <div class="dialog-actions">
      <button class="btn btn-primary" type="submit">${person ? 'Save' : 'Add person'}</button>
      <button class="btn btn-ghost" type="button" data-action="close-dialog">Cancel</button>
    </div></form>`);
}

// Manager: app access -------------------------------------------------------------

async function accessView() {
  const { classes, apps } = await api.access();
  return html`<div class="page narrow">
    <div class="page-head"><div><h1>App access</h1><p class="sub">Which apps each class of person gets in AB Apps. This decides what
      AB Apps installs and shows; what each app's data folder is shared with still decides who can use its data.</p></div></div>
    <form data-form="access">
      <div class="form-error"></div>
      <div class="table-wrap"><table class="data access">
        <thead><tr><th>App</th>${classes.map((c) => html`<th class="check-cell">${c.name}s</th>`)}</tr></thead>
        <tbody>${apps.map((a) => html`<tr><td>${a.name}</td>${classes.map((c) => html`<td class="check-cell">
          <input type="checkbox" name="${a.id}:${c.id}" aria-label="${a.name} for ${c.name}s"${flag(a.classes.includes(c.id), 'checked')}></td>`)}</tr>`)}
        </tbody></table></div>
      <div class="actions" style="margin-top: 16px"><button class="btn btn-primary" type="submit">Save access</button></div>
    </form>
    <p class="small muted" style="margin-top: 16px">Taking an app away doesn't uninstall it from anyone's computer; AB Apps just stops showing it.</p>
  </div>`;
}

// Manager: mail and website ---------------------------------------------------------

async function servicesView() {
  const { mail, website } = await api.services();
  const m = mail ?? { host: '', port: 25, secure: false, fromName: '', fromEmail: '' };
  const w = website ?? { siteUrl: '', consumerKey: '', hasSecret: false };
  return html`<div class="page narrow">
    <div class="page-head"><div><h1>Mail and website</h1><p class="sub">Set once here for everyone. FormTracker, SendNewsletters, KeepTime
      and ApplicationManager use these instead of their own settings while someone is signed in to AB Apps.</p></div></div>
    <form data-form="services">
      <div class="form-error"></div>
      <div class="section" style="margin-top: 0"><h2>Mail server</h2>
        <p class="small muted" style="margin: 4px 0 12px">A server that takes mail without signing in, such as the office's Microsoft 365
          relay. It usually only accepts mail from the office's network. Leave every field blank to have each app use its own.</p>
        <div class="field"><label for="m-host">Server</label><input type="text" id="m-host" name="mail.host" value="${m.host}"
          placeholder="yourdomain-org.mail.protection.outlook.com"></div>
        <div class="field-row">
          <div class="field"><label for="m-port">Port</label><input type="number" id="m-port" name="mail.port" min="1" max="65535" value="${m.port}"></div>
          <div class="field"><label for="m-secure">Encryption</label><select id="m-secure" name="mail.secure">
            <option value="false"${flag(!m.secure, 'selected')}>STARTTLS when offered (25 or 587)</option>
            <option value="true"${flag(m.secure, 'selected')}>TLS from the start (465)</option></select></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="m-from-name">From name</label><input type="text" id="m-from-name" name="mail.fromName" maxlength="100"
            value="${m.fromName}" placeholder="Anabaptist Brotherhood"></div>
          <div class="field"><label for="m-from-email">From address</label><input type="email" id="m-from-email" name="mail.fromEmail"
            value="${m.fromEmail}"></div>
        </div>
        <button class="btn btn-secondary" type="button" data-action="test-mail">Test connection</button>
      </div>
      <div class="section"><h2>Website</h2>
        <p class="small muted" style="margin: 4px 0 12px">The WordPress site's Gravity Forms API, which the apps read signups, responses and
          applications from. Use a <strong>read-only</strong> key: everyone with the AB Apps folder can read it.</p>
        <div class="field"><label for="w-url">Website address</label><input type="url" id="w-url" name="website.siteUrl" value="${w.siteUrl}"
          placeholder="https://anabaptistbrotherhood.org"></div>
        <div class="field-row">
          <div class="field"><label for="w-key">Consumer key</label><input type="text" id="w-key" name="website.consumerKey" value="${w.consumerKey}"
            autocomplete="off"></div>
          <div class="field"><label for="w-secret">Consumer secret</label><input type="password" id="w-secret" name="website.consumerSecret"
            autocomplete="off" placeholder="${w.hasSecret ? 'Saved; leave blank to keep' : ''}"></div>
        </div>
        <button class="btn btn-secondary" type="button" data-action="test-website">Test connection</button>
      </div>
      <div class="actions" style="margin-top: 24px"><button class="btn btn-primary" type="submit">Save</button></div>
    </form>
    <p class="small muted" style="margin-top: 16px">Each app still keeps which forms it uses, and anything else particular to it.</p>
  </div>`;
}

/** The Mail and website form's values, as { mail, website }. */
function servicesInput() {
  const form = $('form[data-form="services"]');
  const input = { mail: {}, website: {} };
  for (const [name, value] of new FormData(form)) {
    const [section, key] = name.split('.');
    input[section][key] = value;
  }
  return input;
}

// Profile --------------------------------------------------------------------------

async function profileView() {
  const me = state.me;
  return html`<div class="page narrow">
    <div class="page-head"><div><h1>Profile</h1><p class="sub">${me.name}, ${me.className}</p></div></div>
    <p class="small muted">The AB apps sign you in, and sign your comments, with this name. A manager can change it on the People page.</p>
    <div class="section"><h2>Change your PIN</h2>
      <form data-form="pin" style="margin-top: 12px">
        <div class="form-error"></div>
        <div class="field-row">
          <div class="field"><label for="c-pin">Current PIN</label><input type="password" id="c-pin" name="current" inputmode="numeric" maxlength="8" required></div>
          <div class="field"><label for="n-pin">New PIN</label><input type="password" id="n-pin" name="next" inputmode="numeric" maxlength="8" required></div>
          <div class="field"><label for="n-pin2">New PIN again</label><input type="password" id="n-pin2" name="next2" inputmode="numeric" maxlength="8" required></div>
        </div>
        <button class="btn btn-secondary" type="submit">Change PIN</button>
      </form>
    </div>
    <div class="section"><h2>Signing out</h2>
      <p class="small muted" style="margin-top: 4px">You stay signed in on this computer until you sign out. Sign out before someone else uses
        this Windows account.</p>
      <button class="btn btn-secondary" data-action="logout">Sign out</button>
    </div>
  </div>`;
}

// Settings ------------------------------------------------------------------------

const update = { checking: false, checked: false, installing: false, percent: null };

function updatesSection() {
  const { checking, checked, installing, percent } = update;
  const release = state.release;
  const status = checking ? 'Checking for updates…' : checked && release && !release.newer ? 'You have the latest version.' : '';
  return html`<div class="section" id="updates"><h2>AB Apps updates</h2>
    <p class="small muted" style="margin: 4px 0 12px">This is AB Apps ${state.version}. ${status}</p>
    ${release?.newer
      ? html`<div class="notice" style="margin-bottom: 12px"><strong>Version ${release.version} is available.</strong>
          ${release.publishedAt ? `Released ${formatDate(release.publishedAt)}. ` : ''}${release.hasInstaller
            ? 'AB Apps closes while the update installs and opens again afterward.'
            : "Its installer isn't ready yet. Try again in a few minutes."}</div>`
      : ''}
    <div class="actions">
      ${release?.newer && release.hasInstaller
        ? html`<button class="btn btn-primary" data-action="install-update"${flag(installing, 'disabled')}>${!installing
            ? 'Download and install'
            : percent === 100 ? 'Downloaded' : `Downloading…${percent === null ? '' : ` ${percent}%`}`}</button>`
        : ''}
      <button class="btn btn-secondary" data-action="check-update"${flag(checking || installing, 'disabled')}>Check for updates</button>
      <button class="btn btn-ghost" data-action="release-page">What's new</button>
    </div></div>`;
}

/** Redraws the updates section, if it's showing, and the header's note that an update is waiting. */
function drawUpdates() {
  const section = $('#updates');
  if (section) section.outerHTML = updatesSection().s;
  const badge = $('#update-badge');
  if (badge) {
    badge.innerHTML = state.release?.newer
      ? html`<button class="btn btn-secondary btn-sm" data-action="nav" data-view="settings">AB Apps update available</button>`.s
      : '';
  }
}

api.onUpdateFound((release) => {
  if (!state) return;
  state.release = release;
  drawUpdates();
});

api.onUpdateProgress(({ percent }) => {
  update.percent = percent;
  drawUpdates();
});

async function settingsView() {
  const options = [['system', 'Match Windows'], ['light', 'Light'], ['dark', 'Dark']];
  const source = { github: 'GitHub', saved: 'the copy saved on this computer, because GitHub couldn\'t be reached', 'built-in': 'the copy built into AB Apps' }[state.catalogSource];
  return html`<div class="page narrow">
    <div class="page-head"><div><h1>Settings</h1><p class="sub">For this computer only.</p></div></div>
    <div class="section" style="margin-top: 0"><h2>AB Apps folder</h2>
      <p class="small muted" style="margin-top: 4px">The shared folder that lists who can sign in. Each computer chooses it once.</p>
      <p class="path">${state.dataDir}</p>
      <div class="actions"><button class="btn btn-secondary" data-action="open-folder">Open folder</button>
        <button class="btn btn-ghost" data-action="change-folder">Use a different folder on this computer</button></div>
    </div>
    <div class="section"><h2>Appearance</h2>
      <div class="choices" role="radiogroup" aria-label="Theme">
        ${options.map(([value, label]) => html`<label class="check"><input type="radio" name="theme" value="${value}"${flag(state.theme === value, 'checked')}> ${label}</label>`)}
      </div></div>
    ${updatesSection()}
    <div class="section"><h2>For the apps</h2>
      <p class="small muted" style="margin-top: 4px">${source ? `The list of apps came from ${source}. ` : ''}Apps that support AB Apps read who is
        signed in from this file:</p>
      <p class="path">${state.identityPath}</p>
      <p class="small muted" style="margin-top: 12px">Each app keeps its data in its own subfolder of the AB Apps folder, and finds it there by itself.
        Data that was somewhere else before stays there until a manager moves it, once, from that app.</p>
      <table class="data" style="margin-top: 8px"><tbody>${(state.appFolders ?? []).map((f) => html`<tr><td>${f.name}</td>
        <td class="path" style="margin: 0">${f.path}</td><td class="small muted">${f.exists ? '' : 'Not there yet'}</td></tr>`)}</tbody></table>
    </div>
  </div>`;
}

document.addEventListener('change', async (event) => {
  if (event.target.name !== 'theme' || event.target.type !== 'radio') return;
  try {
    state.theme = await api.setTheme(event.target.value);
  } catch (err) {
    toast(err.message, { error: true });
  }
});

const VIEWS = {
  apps: appsView,
  people: peopleView,
  access: accessView,
  services: servicesView,
  profile: profileView,
  settings: settingsView,
};

// Forms ----------------------------------------------------------------------------------------------

const FORMS = {
  async setup(v) {
    if (v.pin !== v.pin2) throw new Error("The two PINs don't match.");
    state = await api.setup({ name: v.name, pin: v.pin });
    view = null;
    render();
    toast('AB Apps is set up. Next, add people on the People page.');
  },

  async login(v) {
    if (!v.personId) throw new Error('Choose your name.');
    state = await api.login(v.personId, v.pin);
    view = null;
    render();
  },

  async person(v) {
    await api.savePerson({ id: v.id || null, name: v.name, class: v.class, pin: v.pin, active: v.active });
    closeDialog();
    await go('people');
    toast(v.id ? 'Saved.' : `${v.name.trim()} can now sign in.`);
  },

  async access(v, form) {
    const input = {};
    for (const box of form.querySelectorAll('input[type=checkbox]')) {
      const [appId, cls] = box.name.split(':');
      input[appId] ??= [];
      if (box.checked) input[appId].push(cls);
    }
    await api.saveAccess(input);
    toast('App access saved. Each person sees the change the next time AB Apps opens or checks for updates.');
  },

  async services() {
    await api.saveServices(servicesInput());
    await drawView();
    toast('Saved. The apps use these the next time they send or connect.');
  },

  async pin(v, form) {
    if (v.next !== v.next2) throw new Error("The two new PINs don't match.");
    await api.changePin(v.current, v.next);
    form.reset();
    toast('Your PIN is changed.');
  },
};

document.addEventListener('submit', async (event) => {
  const form = event.target;
  const handler = FORMS[form.dataset.form];
  if (!handler) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  for (const box of form.querySelectorAll('input[type=checkbox][name]')) {
    if (!box.disabled) values[box.name] = box.checked;
  }
  // A disabled control isn't submitted; keep what it shows.
  for (const input of form.querySelectorAll('input:disabled[name]')) {
    if (input.type === 'checkbox') values[input.name] = input.checked;
    else if (input.type === 'radio' && input.checked) values[input.name] = input.value;
  }
  const errorBox = form.querySelector('.form-error');
  if (errorBox) errorBox.textContent = '';
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await handler(values, form);
  } catch (err) {
    if (errorBox && form.isConnected) errorBox.textContent = err.message;
    else toast(err.message, { error: true });
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
});

// Clicks ---------------------------------------------------------------------------------------------

const ACTIONS = {
  nav: (d) => go(d.view),
  reload: () => (state.screen === 'app' ? drawView() : api.getState().then((s) => ((state = s), render()))),
  'close-dialog': () => closeDialog(),

  async 'choose-folder'() {
    state = await api.chooseFolder();
    view = null;
    render();
  },

  async 'change-folder'() {
    openDialog(html`<form data-form="change-folder">
      <h2>Use a different folder?</h2>
      <p>This signs you out and points this computer at another AB Apps folder. Nothing in the current folder is changed or moved.</p>
      <div class="dialog-actions">
        <button class="btn btn-primary" type="submit">Choose folder</button>
        <button class="btn btn-ghost" type="button" data-action="close-dialog">Cancel</button>
      </div></form>`);
  },

  'open-folder': () => api.openFolder(),

  async logout() {
    state = await api.logout();
    view = null;
    Object.keys(ui).forEach((k) => delete ui[k]);
    render();
  },

  async 'open-app'(d) {
    await api.openApp(d.id);
    toast(`Opening ${state.apps.find((a) => a.id === d.id)?.name ?? 'the app'}…`);
  },

  async 'install-app'(d) {
    state.apps = await api.installApp(d.id);
    drawApps();
  },

  async 'install-all'() {
    state.apps = await api.installAll();
    drawApps();
  },

  async 'refresh-apps'(_d, el) {
    el.disabled = true;
    el.textContent = 'Checking…';
    state.apps = await api.refreshApps();
    drawApps();
  },

  'edit-person': (d) => personDialog(ui.people.find((p) => p.id === d.id) ?? null),

  async 'check-update'() {
    update.checking = true;
    drawUpdates();
    try {
      state.release = await api.checkForUpdate();
      update.checked = true;
    } finally {
      update.checking = false;
      drawUpdates();
    }
  },

  // Asks first, and closes AB Apps if the update is installed.
  async 'install-update'() {
    update.installing = true;
    drawUpdates();
    try {
      await api.installUpdate();
    } finally {
      update.installing = false;
      update.percent = null;
      drawUpdates();
    }
  },

  'release-page': () => api.openReleasePage(),

  async 'test-mail'(_d, el) {
    el.disabled = true;
    el.textContent = 'Connecting…';
    try {
      await api.testMail(servicesInput().mail);
      toast('The mail server accepted a connection from this computer.');
    } finally {
      el.disabled = false;
      el.textContent = 'Test connection';
    }
  },

  async 'test-website'(_d, el) {
    el.disabled = true;
    el.textContent = 'Connecting…';
    try {
      const count = await api.testWebsite(servicesInput().website);
      toast(`Connected. Gravity Forms lists ${count} form${count === 1 ? '' : 's'}.`);
    } finally {
      el.disabled = false;
      el.textContent = 'Test connection';
    }
  },
};

FORMS['change-folder'] = async () => {
  closeDialog();
  await ACTIONS['choose-folder']();
};

document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = ACTIONS[el.dataset.action];
  if (!action) return;
  event.preventDefault();
  try {
    await action(el.dataset, el);
  } catch (err) {
    if (dialogEl.open && dialogEl.querySelector('.form-error')) dialogEl.querySelector('.form-error').textContent = err.message;
    else toast(err.message, { error: true });
    if (el.dataset.action === 'refresh-apps') drawApps();
  }
});

api.getState().then((s) => {
  state = s;
  render();
});
