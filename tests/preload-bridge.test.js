const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const preloadPath = path.join(projectRoot, 'src/preload.js');

function loadPreloadBridge() {
  const invoked = [];
  let exposed = null;
  const fakeElectron = {
    contextBridge: { exposeInMainWorld: (_, api) => { exposed = api; } },
    ipcRenderer: {
      invoke: channel => { invoked.push(channel); return Promise.resolve(null); },
      on() {},
      removeListener() {},
    },
    webUtils: { getPathForFile: () => '' },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    return originalLoad.call(this, request, ...rest);
  };
  try {
    delete require.cache[preloadPath];
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[preloadPath];
  }
  return { api: exposed, invoked };
}

function invokedChannels() {
  const { api, invoked } = loadPreloadBridge();
  for (const value of Object.values(api)) {
    if (typeof value !== 'function') continue;
    try { value('persist:x', 0, 1, 1)?.catch?.(() => {}); } catch {}
  }
  api.invokeBluesky('getTimeline').catch(() => {});
  return new Set(invoked);
}

function mainHandlers() {
  const source = fs.readFileSync(path.join(projectRoot, 'src/main.js'), 'utf8');
  return new Set([...source.matchAll(/handleTrustedIpc\('([a-z0-9-]+)'/g)].map(match => match[1]));
}

test('the renderer bridge cannot read or replace the main process config', () => {
  const { api } = loadPreloadBridge();
  const channels = invokedChannels();
  for (const channel of ['get-config', 'set-config']) {
    assert.equal(channels.has(channel), false, `${channel} must not be reachable from the renderer`);
  }
  assert.equal('setConfig' in api, false);
  assert.equal('getConfig' in api, false);
});

test('every channel the bridge invokes has a trusted main handler', () => {
  const handlers = mainHandlers();
  const missing = [...invokedChannels()].filter(channel => !handlers.has(channel));
  assert.deepEqual(missing, []);
});

test('the main process registers no handler the bridge cannot reach', () => {
  const channels = invokedChannels();
  const unreachable = [...mainHandlers()].filter(channel => !channels.has(channel));
  assert.deepEqual(unreachable, []);
});
