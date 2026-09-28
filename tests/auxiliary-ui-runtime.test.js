const assert = require('node:assert/strict');
const test = require('node:test');

async function load(file) {
  return import('../src/renderer/' + file.replace('.js', '.mjs'));
}
function documentStub() {
  const elements = new Map();
  const listeners = new Set();
  const make = id => {
    const classes = new Set();
    const el = { id, style: {}, value: '', classList: { add: value => classes.add(value), contains: value => classes.has(value) },
      remove() { elements.delete(this.id); }, focus() {}, querySelector: () => null };
    elements.set(id, el);
    return el;
  };
  return { elements, listeners, make, getElementById: id => elements.get(id), createElement: () => make(''),
    body: { appendChild(el) { elements.set(el.id, el); } },
    addEventListener(type, listener) { listeners.add(listener); }, removeEventListener(type, listener) { listeners.delete(listener); } };
}

test('about and update status reflect the app version, download and failure', async () => {
  const documentRef = documentStub();
  for (const id of ['aboutMod', 'about-version', 'check-update-btn', 'install-update-btn', 'update-status']) documentRef.make(id);
  let checks = 0;
  const runtime = (await load('app-info-runtime.js')).createAppInfoRuntime({ documentRef,
    api: { getAppVersion: async () => '1.2.3', checkForUpdates: () => checks++ } });
  await runtime.openAbout();
  assert.equal(documentRef.getElementById('about-version').textContent, 'Version 1.2.3');
  assert.equal(documentRef.getElementById('aboutMod').classList.contains('on'), true);
  runtime.checkForUpdates();
  assert.equal(checks, 1);
  assert.equal(documentRef.getElementById('check-update-btn').disabled, true);
  runtime.renderUpdateStatus({ status: 'downloaded', version: '1.2.4' });
  assert.equal(documentRef.getElementById('install-update-btn').style.display, '');
  runtime.renderUpdateStatus({ status: 'error', message: 'offline' });
  assert.equal(documentRef.getElementById('update-status').textContent, 'offline');
  assert.equal(documentRef.getElementById('check-update-btn').disabled, false);
});

test('reopening and disposing the post menu release its pending listener', async () => {
  const documentRef = documentStub();
  const timers = new Map();
  let id = 0;
  const messages = [];
  const runtime = (await load('post-menu-runtime.js')).createPostMenuRuntime({ documentRef,
    esc: value => value, toast: message => messages.push(message), muteRules: {}, refilterBskyCols() {},
    clipboard: { writeText: async () => { throw new Error('denied'); } },
    schedule: callback => { timers.set(++id, callback); return id; }, cancel: id => timers.delete(id) });
  runtime.showPostMenu({ handle: 'alice', x: 10, y: 20 });
  runtime.showPostMenu({ handle: 'bob', x: 30, y: 40 });
  assert.equal(timers.size, 1);
  const callback = [...timers.values()][0];
  timers.clear(); callback();
  assert.equal(documentRef.listeners.size, 1);
  runtime.dispose(); runtime.dispose();
  assert.equal(documentRef.listeners.size, 0);
  assert.equal(documentRef.getElementById('post-ctx-menu'), undefined);
  await runtime.copyHandle('alice');
  assert.deepEqual(messages, ['コピーできませんでした']);
});

test('list dialog validates input, uses the selected account and stays open after creation failure', async () => {
  const documentRef = documentStub();
  for (const id of ['x-list-input', 'x-list-name', 'x-list-dialog-ov', 'cols']) documentRef.make(id);
  const requests = [];
  let result = { status: 'failed' };
  const runtime = (await load('x-list-dialog-runtime.js')).createXListDialogRuntime({ documentRef,
    getAccounts: () => [{ username: 'Alice', partition: 'persist:x-9' }], esc: value => value,
    icon: '', toast() {}, nextColumnId: id => id, createColumn: request => { requests.push(request); return result; } });
  documentRef.getElementById('x-list-input').value = 'invalid';
  runtime.confirmXList(0);
  assert.equal(requests.length, 0);
  documentRef.getElementById('x-list-input').value = 'https://x.com/i/lists/123';
  documentRef.getElementById('x-list-name').value = 'Friends';
  runtime.confirmXList(0);
  assert.equal(requests[0].account.partition, 'persist:x-9');
  assert.equal(requests[0].params.title, 'Friends');
  assert.ok(documentRef.getElementById('x-list-dialog-ov'));
  result = { status: 'created' };
  runtime.confirmXList(0);
  assert.equal(documentRef.getElementById('x-list-dialog-ov'), undefined);
});
