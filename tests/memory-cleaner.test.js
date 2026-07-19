const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadMemoryCleaner(windowOverrides = {}) {
  const context = { window: { ...windowOverrides } };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'memory-cleaner.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckMemoryCleaner;
}

function createStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (_key, nextValue) => { value = String(nextValue); },
  };
}

test('combines Electron process metrics with renderer runtime metrics', async () => {
  const cleaner = loadMemoryCleaner().createMemoryCleaner({
    key: 'memory-interval',
    storage: createStorage(),
    getMemoryMetrics: async () => ({ totalKb: 256_000, groups: { browser: 64_000 } }),
    getRuntimeMetrics: () => ({ blueskyItems: 120, xWebViews: 3, xNotificationReaders: 1 }),
  });

  const snapshot = await cleaner.measure();

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    host: { totalKb: 256_000, groups: { browser: 64_000 } },
    runtime: { blueskyItems: 120, xWebViews: 3, xNotificationReaders: 1 },
  });
});

test('automatic cleanup trims runtime state without clearing HTTP caches', async () => {
  const calls = [];
  const cleaner = loadMemoryCleaner().createMemoryCleaner({
    key: 'memory-interval',
    storage: createStorage(),
    clearMemory: async () => calls.push('cache'),
    trimRuntime: async () => { calls.push('runtime'); return { blueskyItemsRemoved: 8 }; },
    getMemoryMetrics: async () => ({ totalKb: 100 }),
    getRuntimeMetrics: () => ({ blueskyItems: 10 }),
  });

  const result = await cleaner.clear();

  assert.deepEqual(calls, ['runtime']);
  assert.equal(result.cacheCleared, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.runtimeCleanup)), {
    blueskyItemsRemoved: 8,
  });
});

test('manual cleanup can include HTTP cache clearing', async () => {
  const calls = [];
  const cleaner = loadMemoryCleaner().createMemoryCleaner({
    key: 'memory-interval',
    storage: createStorage(),
    clearMemory: async () => { calls.push('cache'); return true; },
    trimRuntime: async () => { calls.push('runtime'); return {}; },
  });

  const result = await cleaner.clear({ includeCache: true });

  assert.deepEqual(calls, ['runtime', 'cache']);
  assert.equal(result.cacheCleared, true);
});

test('scheduled cleanup uses the runtime-only cleanup mode', async () => {
  let scheduled;
  let cacheClears = 0;
  let runtimeTrims = 0;
  const cleaner = loadMemoryCleaner().createMemoryCleaner({
    key: 'memory-interval',
    storage: createStorage('1000'),
    clearMemory: async () => { cacheClears += 1; },
    trimRuntime: async () => { runtimeTrims += 1; },
    setIntervalImpl: callback => { scheduled = callback; return 1; },
    clearIntervalImpl() {},
  });

  cleaner.start();
  await scheduled();

  assert.equal(runtimeTrims, 1);
  assert.equal(cacheClears, 0);
});
