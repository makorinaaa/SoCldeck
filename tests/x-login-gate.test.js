const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { URL, window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'x-login-gate.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckXLoginGate;
}

test('parks additional X WebViews while a new account is logging in', () => {
  const gate = loadModule().createXLoginGate();

  assert.equal(gate.register('persist:x-0', 'home', true), false);
  assert.equal(gate.register('persist:x-0', 'notifications', true), true);
  assert.equal(gate.register('persist:x-0', 'search', true), true);
});

test('releases parked WebViews after the owner completes X login', () => {
  const gate = loadModule().createXLoginGate();
  gate.register('persist:x-0', 'home', true);
  gate.register('persist:x-0', 'notifications', true);
  gate.register('persist:x-0', 'search', true);

  assert.deepEqual(
    Array.from(gate.observe('persist:x-0', 'home', 'https://x.com/i/flow/login')),
    [],
  );
  assert.deepEqual(
    Array.from(gate.observe('persist:x-0', 'home', 'https://x.com/home')),
    ['notifications', 'search'],
  );
});

test('does not gate an existing authenticated X account', () => {
  const gate = loadModule().createXLoginGate();

  assert.equal(gate.register('persist:x-0', 'home', false), false);
  assert.equal(gate.register('persist:x-0', 'notifications', false), false);
});
