'use strict';

// Rules for what managers keep in the shared folder: people and which apps
// each class of person gets. Each function changes what it's given and
// returns problems to show; an empty list means the caller should save.
//
// Everyone is one of three classes. Managers manage people and app access.
// Employees and contractors are treated alike for now; they're separate so
// either can be given different apps, or different rules in an app, later.

const crypto = require('crypto');
const { pinProblem, hashPin } = require('./auth');
const { CLASSES } = require('./catalog');

const CLASS_NAMES = { manager: 'Manager', employee: 'Employee', contractor: 'Contractor' };

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Adds or updates a person. `actorId` is the manager making the change, or null when setting up. */
function savePerson(list, input, actorId, now) {
  const isNew = !input.id;
  const existing = isNew ? null : list.find((p) => p.id === input.id);
  if (!isNew && !existing) return { errors: ['That person no longer exists.'] };

  const errors = [];
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  const active = isNew ? true : Boolean(input.active);
  const personClass = input.class;

  if (!name) errors.push('Enter a name.');
  else if (name.length > 80) errors.push('Keep the name under 80 characters.');
  else if (active && list.some((p) => p.id !== input.id && p.active && sameName(p.name, name))) {
    errors.push('Someone else is listed with that name. Add a last name or initial so people can tell them apart at sign-in.');
  }
  if (!CLASSES.includes(personClass)) errors.push('Choose manager, employee or contractor.');

  const pin = String(input.pin ?? '').trim();
  if (isNew && !pin) errors.push('Set a PIN for the new person.');
  if (pin && pinProblem(pin)) errors.push(pinProblem(pin));

  const staysManager = personClass === 'manager' && active;
  if (existing && existing.id === actorId) {
    if (personClass !== 'manager') errors.push("You can't change your own class from manager.");
    if (!active) errors.push("You can't turn off your own account.");
  } else if (existing && existing.class === 'manager' && existing.active && !staysManager) {
    const others = list.some((p) => p.id !== existing.id && p.class === 'manager' && p.active);
    if (!others) errors.push('At least one active manager is needed.');
  }
  if (errors.length) return { errors };

  const person = existing ?? { id: crypto.randomUUID(), created: now.toISOString() };
  Object.assign(person, { name, class: personClass, active, updated: now.toISOString() });
  if (pin) person.pin = hashPin(pin, now);
  if (isNew) list.push(person);
  return { errors: [], person };
}

/**
 * Sets which classes get each app. `input` is { [app id]: [classes] }; apps
 * whose classes match the catalog's are left out, so a later change to the
 * catalog's defaults still reaches them.
 */
function saveAccess(settings, input, apps) {
  const access = {};
  for (const app of apps) {
    const chosen = CLASSES.filter((c) => (input[app.id] ?? []).includes(c));
    const defaults = CLASSES.filter((c) => app.classes.includes(c));
    if (chosen.join() !== defaults.join()) access[app.id] = chosen;
  }
  // Keep choices for apps the catalog no longer lists, in case they come back.
  for (const [id, classes] of Object.entries(settings.access ?? {})) {
    if (!apps.some((a) => a.id === id)) access[id] = classes;
  }
  settings.access = access;
  return [];
}

module.exports = { CLASS_NAMES, savePerson, saveAccess };
