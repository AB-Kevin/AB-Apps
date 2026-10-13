'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { savePerson, saveAccess, importContractorTime } = require('../src/main/people');
const { verifyPin } = require('../src/main/auth');
const identity = require('../src/main/identity');

const now = new Date('2026-10-12T20:00:00Z');

function setUp() {
  const list = [];
  const { person: manager } = savePerson(list, { name: 'Mary Manager', class: 'manager', pin: '1234' }, null, now);
  return { list, manager };
}

test('a person is added with a class and a PIN', () => {
  const { list, manager } = setUp();
  const { errors, person } = savePerson(list, { name: '  Carl   Contractor ', class: 'contractor', pin: '5678' }, manager.id, now);
  assert.deepEqual(errors, []);
  assert.equal(person.name, 'Carl Contractor');
  assert.equal(person.class, 'contractor');
  assert.equal(person.active, true);
  assert.ok(verifyPin('5678', person.pin));
  assert.equal(list.length, 2);
});

test('a class, a PIN for new people, and a distinct name are required', () => {
  const { list, manager } = setUp();
  assert.match(savePerson(list, { name: 'X', class: 'admin', pin: '1234' }, manager.id, now).errors.join(), /manager, employee or contractor/);
  assert.match(savePerson(list, { name: 'X', class: 'employee' }, manager.id, now).errors.join(), /Set a PIN/);
  assert.match(savePerson(list, { name: 'X', class: 'employee', pin: '12' }, manager.id, now).errors.join(), /4 to 8 digits/);
  assert.match(savePerson(list, { name: 'mary manager', class: 'employee', pin: '1234' }, manager.id, now).errors.join(), /Someone else/);
});

test('editing keeps the PIN unless a new one is given', () => {
  const { list, manager } = setUp();
  const { person } = savePerson(list, { name: 'Erin', class: 'employee', pin: '1111' }, manager.id, now);
  savePerson(list, { id: person.id, name: 'Erin E.', class: 'contractor', active: true }, manager.id, now);
  assert.equal(person.name, 'Erin E.');
  assert.equal(person.class, 'contractor');
  assert.ok(verifyPin('1111', person.pin));
});

test('managers can\'t demote or turn off themselves, and one active manager always remains', () => {
  const { list, manager } = setUp();
  assert.match(savePerson(list, { id: manager.id, name: manager.name, class: 'employee', active: true }, manager.id, now).errors.join(), /your own class/);
  assert.match(savePerson(list, { id: manager.id, name: manager.name, class: 'manager', active: false }, manager.id, now).errors.join(), /turn off your own/);

  const { person: other } = savePerson(list, { name: 'Max', class: 'manager', pin: '2222' }, manager.id, now);
  assert.deepEqual(savePerson(list, { id: other.id, name: 'Max', class: 'employee', active: true }, manager.id, now).errors, []);
  // Mary is now the only manager; Max (an employee) can't be the one to remove her, and neither can she.
  assert.match(savePerson(list, { id: manager.id, name: manager.name, class: 'employee', active: true }, other.id, now).errors.join(), /one active manager/);
});

test('app access keeps only choices that differ from the catalog', () => {
  const apps = [{ id: 'a', classes: ['manager', 'employee'] }, { id: 'b', classes: ['manager'] }];
  const settings = { access: { gone: ['manager'] } };
  saveAccess(settings, { a: ['employee', 'manager'], b: ['manager', 'contractor', 'nonsense'] }, apps);
  assert.deepEqual(settings.access, { b: ['manager', 'contractor'], gone: ['manager'] });
});

test('Contractor Time\'s people are imported with their ids and PINs, and the same person is linked, not doubled', () => {
  const { list, manager } = setUp(); // Mary Manager, made in AB Apps first
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
  const ctPeople = [
    { id: ids[0], name: 'Mary  Manager', manager: true, contractor: true, active: true, pin: { hash: 'ct' } },
    { id: ids[1], name: 'Carl Contractor', manager: false, contractor: true, active: true },
    { id: ids[2], name: 'Old Hand', manager: false, contractor: true, active: false },
    { id: 'not-an-id', name: 'Odd' },
  ];
  const pins = new Map([[ids[1], { hash: 'carl', salt: 's', setAt: now.toISOString() }]]);
  const oldId = manager.id;
  const result = importContractorTime(list, ctPeople, pins, now);

  assert.deepEqual(result.relinked, [{ from: oldId, to: ids[0], name: 'Mary Manager' }]);
  assert.equal(manager.id, ids[0], 'Mary takes her Contractor Time id');
  assert.equal(manager.pin.hash !== 'ct', true, 'and keeps her AB Apps PIN');
  assert.deepEqual(result.added.map((p) => [p.name, p.class, p.active, Boolean(p.pin)]), [
    ['Carl Contractor', 'contractor', true, true],
    ['Old Hand', 'contractor', false, false],
  ]);
  assert.deepEqual(result.notes, ['Old Hand was added without a PIN; set one before they sign in']);
  assert.equal(list.find((p) => p.id === ids[1]).pin.hash, 'carl');

  // Importing again changes nothing.
  const again = importContractorTime(list, ctPeople, pins, now);
  assert.deepEqual([again.added.length, again.relinked.length], [0, 0]);
  assert.equal(list.length, 3);
});

test('identity.json is written for the apps, and removed on sign-out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-apps-identity-'));
  const person = { id: '3f1c2b9a-0000-4000-8000-000000000001', name: 'Carl', class: 'contractor', pin: { hash: 'secret' } };
  identity.writeIdentity(dir, person, { signedInAt: now.toISOString(), dataDir: 'D:\\AB Apps' });
  const saved = JSON.parse(fs.readFileSync(identity.identityPath(dir), 'utf8'));
  assert.deepEqual(saved, {
    version: 1,
    personId: person.id,
    name: 'Carl',
    class: 'contractor',
    signedInAt: '2026-10-12T20:00:00.000Z',
    dataDir: 'D:\\AB Apps',
  });
  assert.deepEqual(identity.readIdentity(dir), saved);
  identity.clearIdentity(dir);
  assert.equal(identity.readIdentity(dir), null);
});
