const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAppConfigStore } = require('../src/main/app-config-store');

function tempConfigPath(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'socialdeck-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'config.json');
}

const silent = { warn() {} };

test('returns defaults when no config file exists yet', t => {
  const store = createAppConfigStore({ filePath: tempConfigPath(t), logger: silent });
  assert.deepEqual(store.load(), {});
});

test('merges updates without dropping unrelated settings', t => {
  const filePath = tempConfigPath(t);
  const store = createAppConfigStore({ filePath, logger: silent });
  assert.equal(store.update({ windowBounds: { width: 1200, height: 800 } }), true);
  assert.equal(store.update({ widgetOpacity: 0.7 }), true);
  assert.deepEqual(store.load(), { windowBounds: { width: 1200, height: 800 }, widgetOpacity: 0.7 });
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['config.json']);
});

test('keeps a corrupt config for inspection and starts from defaults', t => {
  const filePath = tempConfigPath(t);
  fs.writeFileSync(filePath, '{"windowBounds": {');
  const store = createAppConfigStore({ filePath, logger: silent });
  assert.deepEqual(store.load(), {});
  assert.equal(fs.readFileSync(`${filePath}.corrupt`, 'utf8'), '{"windowBounds": {');
  assert.equal(store.update({ maximized: true }), true);
  assert.deepEqual(store.load(), { maximized: true });
});

test('treats non-object JSON as corrupt', t => {
  const filePath = tempConfigPath(t);
  fs.writeFileSync(filePath, '[1,2,3]');
  const store = createAppConfigStore({ filePath, logger: silent });
  assert.deepEqual(store.load(), {});
  assert.ok(fs.existsSync(`${filePath}.corrupt`));
});

test('leaves the previous config intact when the replacement cannot be written', t => {
  const filePath = tempConfigPath(t);
  fs.writeFileSync(filePath, JSON.stringify({ widgetOpacity: 0.5 }));
  const fileSystem = {
    ...fs,
    renameSync: () => { throw new Error('disk full'); },
  };
  const store = createAppConfigStore({ filePath, fileSystem, logger: silent });
  assert.equal(store.update({ widgetOpacity: 0.9 }), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { widgetOpacity: 0.5 });
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['config.json']);
});
