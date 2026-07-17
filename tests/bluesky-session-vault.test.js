const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createBlueskySessionVault } = require('../src/main/bluesky-session-vault');

function createSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString(value) {
      return Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`);
    },
    decryptString(value) {
      const encoded = value.toString().replace(/^encrypted:/, '');
      return Buffer.from(encoded, 'base64').toString();
    },
  };
}

function createHarness(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'socialdeck-vault-test-'));
  const filePath = path.join(directory, 'bluesky-session.vault');
  const vault = createBlueskySessionVault({
    filePath,
    safeStorage: createSafeStorage(options),
  });
  return {
    directory,
    filePath,
    vault,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

const SESSION = {
  handle: 'alice.test',
  did: 'did:plc:alice',
  accessJwt: 'access-secret-token',
  refreshJwt: 'refresh-secret-token',
};

test('encrypts a Bluesky session at rest and restores validated credentials', t => {
  const harness = createHarness();
  t.after(harness.cleanup);

  assert.deepEqual(harness.vault.save(SESSION), SESSION);
  const stored = fs.readFileSync(harness.filePath);
  assert.equal(stored.includes(SESSION.accessJwt), false);
  assert.equal(stored.includes(SESSION.refreshJwt), false);
  assert.deepEqual(harness.vault.load(), SESSION);
});

test('atomically replaces an existing encrypted session after token refresh', t => {
  const harness = createHarness();
  t.after(harness.cleanup);
  harness.vault.save(SESSION);

  const refreshed = {
    ...SESSION,
    accessJwt: 'access-refreshed-token',
    refreshJwt: 'refresh-refreshed-token',
  };
  harness.vault.save(refreshed);

  assert.deepEqual(harness.vault.load(), refreshed);
  assert.deepEqual(
    fs.readdirSync(harness.directory),
    ['bluesky-session.vault'],
  );
});

test('fails closed when operating-system encryption is unavailable', t => {
  const harness = createHarness({ available: false });
  t.after(harness.cleanup);

  assert.throws(() => harness.vault.save(SESSION), /encryption is unavailable/i);
  assert.equal(fs.existsSync(harness.filePath), false);
});

test('rejects malformed and oversized credentials before writing', t => {
  const harness = createHarness();
  t.after(harness.cleanup);

  assert.throws(() => harness.vault.save({ ...SESSION, accessJwt: '' }), /invalid/i);
  assert.throws(
    () => harness.vault.save({ ...SESSION, refreshJwt: 'x'.repeat(20_000) }),
    /invalid/i,
  );
  assert.equal(fs.existsSync(harness.filePath), false);
});

test('reports a corrupted encrypted session without exposing partial data', t => {
  const harness = createHarness();
  t.after(harness.cleanup);
  fs.writeFileSync(harness.filePath, Buffer.from('not-an-encrypted-session'));

  assert.throws(() => harness.vault.load(), /could not be read/i);
});

test('clears the encrypted session idempotently', t => {
  const harness = createHarness();
  t.after(harness.cleanup);
  harness.vault.save(SESSION);

  assert.equal(harness.vault.clear(), true);
  assert.equal(harness.vault.clear(), true);
  assert.equal(harness.vault.load(), null);
});
