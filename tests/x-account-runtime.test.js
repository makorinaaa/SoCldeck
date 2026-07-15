const test = require('node:test');
const assert = require('node:assert/strict');
const { createXAccountRuntime } = require('../src/main/x-account-runtime');

function setup({ adBlockError = false } = {}) {
  const sessions = new Map();
  const adBlocked = [];
  const errors = [];

  function getSession(partition) {
    if (!sessions.has(partition)) {
      sessions.set(partition, {
        partition,
        storageClears: 0,
        cacheClears: 0,
        authClears: 0,
        async clearStorageData() { this.storageClears += 1; },
        async clearCache() { this.cacheClears += 1; },
        async clearAuthCache() { this.authClears += 1; },
      });
    }
    return sessions.get(partition);
  }

  const runtime = createXAccountRuntime({
    getSession,
    applyAdBlock(targetSession) {
      if (adBlockError) throw new Error('filter unavailable');
      adBlocked.push(targetSession.partition);
    },
    logger: { error: (...args) => errors.push(args) },
  });

  return { runtime, sessions, adBlocked, errors };
}

test('syncs only valid Network Account partitions plus the legacy partition', () => {
  const { runtime } = setup();
  assert.deepEqual(runtime.sync([
    'persist:x-0',
    'persist:x-3',
    'persist:x-3',
    'persist:bsky',
    'temporary:x-4',
  ]), ['persist:x', 'persist:x-0', 'persist:x-3']);
});

test('applies AdBlock after it is ready and only once per partition', () => {
  const { runtime, adBlocked } = setup();
  runtime.sync(['persist:x-0']);
  assert.deepEqual(adBlocked, []);

  runtime.enableAdBlock();
  runtime.register('persist:x-1');
  runtime.register('persist:x-1');

  assert.deepEqual(adBlocked, ['persist:x', 'persist:x-0', 'persist:x-1']);
});

test('clears only registered Network Account data', async () => {
  const { runtime, sessions } = setup();
  runtime.sync(['persist:x-0', 'persist:x-7']);

  assert.equal(await runtime.clearAll(), true);
  assert.deepEqual([...sessions.keys()], ['persist:x', 'persist:x-0', 'persist:x-7']);
  for (const targetSession of sessions.values()) {
    assert.equal(targetSession.storageClears, 1);
    assert.equal(targetSession.cacheClears, 1);
    assert.equal(targetSession.authClears, 1);
  }
  assert.deepEqual(runtime.getPartitions(), ['persist:x']);
});

test('clears caches without creating unregistered partitions', async () => {
  const { runtime, sessions } = setup();
  runtime.sync(['persist:x-2']);

  assert.equal(await runtime.clearCaches(), true);
  assert.deepEqual([...sessions.keys()], ['persist:x', 'persist:x-2']);
  assert.equal(sessions.get('persist:x').cacheClears, 1);
  assert.equal(sessions.get('persist:x-2').cacheClears, 1);
});

test('keeps AdBlock failures non-fatal', () => {
  const { runtime, errors } = setup({ adBlockError: true });
  runtime.sync(['persist:x-0']);

  assert.doesNotThrow(() => runtime.enableAdBlock());
  assert.equal(errors.length, 2);
});
