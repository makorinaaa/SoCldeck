const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('host events hide Electron event objects and can be unsubscribed', () => {
  const ipcRenderer = new EventEmitter();
  let api;
  const electron = { ipcRenderer, webUtils: {},
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src/preload.js'), 'utf8'), {
    require: module => { assert.equal(module, 'electron'); return electron; },
    process: { env: {}, argv: [] },
  });
  const received = [];
  const unsubscribe = api.on('show-about', (...args) => received.push(args));
  ipcRenderer.emit('show-about', { sender: 'private-event' }, 'public-value');
  assert.deepEqual(received, [['public-value']]);
  unsubscribe();
  ipcRenderer.emit('show-about', {}, 'later');
  assert.equal(received.length, 1);
  api.on('unapproved-channel', () => assert.fail('unapproved channel'));
  assert.equal(ipcRenderer.listenerCount('unapproved-channel'), 0);
});
