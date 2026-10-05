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
