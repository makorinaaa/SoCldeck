const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(projectRoot, relative), 'utf8');

function preloadAllowlist() {
  const source = read('src/preload.js');
  const block = source.match(/const BLUESKY_OPERATIONS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  return new Set([...block.matchAll(/'([A-Za-z]+)'/g)].map(match => match[1]));
}

function gatewayOperations() {
  const source = read('src/main/bluesky-gateway.js');
  const execute = source.slice(source.indexOf('switch (operation)'));
  return new Set([...execute.matchAll(/case '([A-Za-z]+)'/g)].map(match => match[1]));
}

function adapterOperations() {
  const source = read('src/renderer/bluesky-gateway-adapter.js');
  const block = source.slice(0, source.indexOf(']'));
  return new Set([...block.matchAll(/'([A-Za-z]+)'/g)].map(match => match[1]));
}

test('the preload bridge allows every Bluesky operation the gateway implements', () => {
  const allowed = preloadAllowlist();
  const implemented = gatewayOperations();

  assert.ok(implemented.size > 0, 'gateway operations must be discoverable');
  const blocked = [...implemented].filter(operation => !allowed.has(operation));
  assert.deepEqual(
    blocked,
    [],
    `preload rejects operations the gateway implements: ${blocked.join(', ')}`,
  );
});

test('the preload bridge exposes no operation the gateway cannot execute', () => {
  const allowed = preloadAllowlist();
  const implemented = gatewayOperations();

  const orphaned = [...allowed].filter(operation => !implemented.has(operation));
  assert.deepEqual(
    orphaned,
    [],
    `preload allows operations with no gateway handler: ${orphaned.join(', ')}`,
  );
});

test('the renderer adapter, preload bridge, and gateway agree on video upload', () => {
  const allowed = preloadAllowlist();
  const implemented = gatewayOperations();
  const adapter = adapterOperations();

  for (const operation of ['uploadBlob', 'uploadVideo', 'createPostRecord']) {
    assert.equal(adapter.has(operation), true, `adapter must expose ${operation}`);
    assert.equal(allowed.has(operation), true, `preload must allow ${operation}`);
    assert.equal(implemented.has(operation), true, `gateway must implement ${operation}`);
  }
});
