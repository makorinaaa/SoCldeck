const test = require('node:test');
const assert = require('node:assert/strict');
const { ADBLOCK_CACHE_MAX_AGE_MS, loadAdBlocker } = require('../src/main/adblock-filter-cache');

const quietLogger = { warn() {} };

function createHarness({ file = null, mtimeMs = 0, failDownload = false } = {}) {
  const writes = [];
  const fsImpl = {
    async readFile() {
      if (!file) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return file;
    },
    async stat() { return { mtimeMs }; },
    async writeFile(path, bytes) { writes.push({ path, bytes: Buffer.from(bytes).toString() }); },
  };
  let downloads = 0;
  const download = async () => {
    downloads += 1;
    if (failDownload) throw new Error('offline');
    return { name: 'fresh', serialize: () => new TextEncoder().encode('fresh-rules') };
  };
  const deserialize = bytes => {
    const text = Buffer.from(bytes).toString();
    if (text === 'corrupt') throw new Error('bad cache');
    return { name: text };
  };
  return { fsImpl, download, deserialize, writes, downloads: () => downloads };
}

test('a fresh cache is used without downloading', async () => {
  const harness = createHarness({ file: Buffer.from('cached'), mtimeMs: 1000 });
  const result = await loadAdBlocker({ cachePath: 'cache.bin', now: () => 2000, logger: quietLogger, ...harness });
  assert.equal(result.blocker.name, 'cached');
  assert.equal(result.source, 'cache');
  assert.equal(harness.downloads(), 0);
});

test('an old cache is used now and replaced in the background', async () => {
  const harness = createHarness({ file: Buffer.from('cached'), mtimeMs: 0 });
  let refreshed = null;
  const result = await loadAdBlocker({
    cachePath: 'cache.bin',
    now: () => ADBLOCK_CACHE_MAX_AGE_MS + 1,
    onRefresh: blocker => { refreshed = blocker; },
    logger: quietLogger,
    ...harness,
  });
  assert.equal(result.blocker.name, 'cached');
  assert.equal(result.source, 'stale-cache');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshed.name, 'fresh');
  assert.deepEqual(harness.writes, [{ path: 'cache.bin', bytes: 'fresh-rules' }]);
});

test('a failed background refresh keeps the cached lists', async () => {
  const harness = createHarness({ file: Buffer.from('cached'), mtimeMs: 0, failDownload: true });
  let refreshed = false;
  const result = await loadAdBlocker({
    cachePath: 'cache.bin',
    now: () => ADBLOCK_CACHE_MAX_AGE_MS + 1,
    onRefresh: () => { refreshed = true; },
    logger: quietLogger,
    ...harness,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.blocker.name, 'cached');
  assert.equal(refreshed, false);
});

test('a missing or unreadable cache is downloaded before use', async () => {
  for (const file of [null, Buffer.from('corrupt')]) {
    const harness = createHarness({ file });
    const result = await loadAdBlocker({ cachePath: 'cache.bin', logger: quietLogger, ...harness });
    assert.equal(result.blocker.name, 'fresh');
    assert.equal(result.source, 'download');
    assert.equal(harness.writes.length, 1);
  }
});
