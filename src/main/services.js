'use strict';

// The mail server and website the office's apps share, set once by a manager
// on the Mail and website page, so nobody types them into each app on each
// computer. Kept in the AB Apps folder, for the other apps to read:
//
//   shared/services.json
//   { "version": 1,
//     "mail": { "host", "port", "secure", "fromName", "fromEmail" },
//     "website": { "siteUrl", "consumerKey", "consumerSecret" } }
//
// `mail` is null until a manager sets it, and so is `website`; an app that
// finds either null, or a `version` it doesn't know, uses its own settings.
// The mail server is one that takes mail without signing in (a relay that
// trusts the office's address), so there's no password here; an app that
// needs one keeps it on each computer. The Gravity Forms key is meant to be a
// read-only one, since everyone with the AB Apps folder can read this file.

const VERSION = 1;
const EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;
const DEFAULT_SERVICES = { version: VERSION, mail: null, website: null };

const text = (value) => String(value ?? '').trim();

/**
 * Checks the Mail and website form as typed. Returns { errors, services }.
 * A section left entirely blank is turned off; a blank consumer secret keeps
 * the saved one, as password fields do.
 */
function readServices(input, saved = DEFAULT_SERVICES) {
  const errors = [];
  const m = input.mail ?? {};
  const w = input.website ?? {};

  let mail = null;
  const host = text(m.host);
  const fromName = text(m.fromName);
  const fromEmail = text(m.fromEmail);
  if (host || fromEmail || fromName) {
    const port = Number(text(m.port) || 25);
    if (!host) errors.push('Enter the mail server.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('The port is a number from 1 to 65535.');
    if (!EMAIL.test(fromEmail)) errors.push('Enter the address emails come from.');
    if (host.length > 200 || fromName.length > 100) errors.push('Keep the server under 200 characters and the name under 100.');
    mail = { host, port, secure: m.secure === true || m.secure === 'true', fromName, fromEmail };
  }

  let website = null;
  const siteUrl = text(w.siteUrl).replace(/\/+$/, '');
  const consumerKey = text(w.consumerKey);
  const consumerSecret = text(w.consumerSecret) || (siteUrl && saved.website?.consumerSecret) || '';
  if (siteUrl || consumerKey || text(w.consumerSecret)) {
    if (!/^https:\/\/[^\s/]+/i.test(siteUrl)) errors.push('The website address has to start with https://.');
    if (!consumerKey || !consumerSecret) errors.push('Enter the Gravity Forms consumer key and secret.');
    website = { siteUrl, consumerKey, consumerSecret };
  }

  return { errors, services: { version: VERSION, mail, website } };
}

/** The saved settings for the manager's page: the secret is only said to be there. */
function publicServices(services) {
  const { mail, website } = { ...DEFAULT_SERVICES, ...services };
  return {
    mail,
    website: website && { siteUrl: website.siteUrl, consumerKey: website.consumerKey, hasSecret: Boolean(website.consumerSecret) },
  };
}

module.exports = { VERSION, DEFAULT_SERVICES, readServices, publicServices };
