const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('update status events hide Electron event objects and can be unsubscribed', () => {
  const ipcRenderer = new EventEmitter();
  let api;
  const electron = { ipcRenderer, webUtils: {},
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src/preload.js'), 'utf8'), {
    require: module => { assert.equal(module, 'electron'); return electron; },
    process: { env: {}, argv: [] },
  });
  const received = [];
  const unsubscribe = api.onUpdateStatus(status => received.push(status));
  ipcRenderer.emit('update-status', { sender: 'private-event' }, { status: 'ready' });
  assert.deepEqual(received, [{ status: 'ready' }]);
  unsubscribe();
  ipcRenderer.emit('update-status', {}, { status: 'later' });
  assert.equal(received.length, 1);
  assert.equal(api.on, undefined, 'no generic main-process event receiver is exposed');
});

test('window visibility events pass only the hidden flag and can be unsubscribed', () => {
  const ipcRenderer = new EventEmitter();
  let api;
  const electron = { ipcRenderer, webUtils: {},
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src/preload.js'), 'utf8'), {
    require: () => electron,
    process: { env: {}, argv: [] },
  });
  const received = [];
  const unsubscribe = api.onWindowVisibility(state => received.push(state));
  ipcRenderer.emit('window-visibility', { sender: 'private-event' }, { hidden: true, extra: 'x' });
  ipcRenderer.emit('window-visibility', {}, { hidden: 'yes' });
  unsubscribe();
  ipcRenderer.emit('window-visibility', {}, { hidden: false });
  // Objects created inside the preload context have that realm's prototype.
  assert.deepEqual(JSON.parse(JSON.stringify(received)), [{ hidden: true }, { hidden: false }]);
});
