const assert = require('node:assert/strict');
const test = require('node:test');
const { createAtprotoClient } = require('../src/main/bluesky-atproto-client');
const { createBlueskySessionVault } = require('../src/main/bluesky-session-vault');
const { inspect } = require('../scripts/check-secrets.cjs');

test('deletes only records of the authenticated owner and expected collection', async () => {
  const calls = [];
  const client = createAtprotoClient({ fetchImpl: async (url, options) => {
    calls.push(options);
    return { ok: true, text: async () => '{}' };
  } });
  for (const [operation, collection] of [
    ['unlike', 'app.bsky.feed.like'], ['unrepost', 'app.bsky.feed.repost'], ['unfollow', 'app.bsky.graph.follow'],
  ]) {
    for (const uri of [`at://did:plc:bob/${collection}/1`, 'https://evil.test/1', `at://did:plc:alice/wrong/1`, `at://did:plc:alice/${collection}/..`]) {
      assert.throws(() => client[operation]('fixture', 'did:plc:alice', uri), /ownership/);
    }
    const count = calls.length;
    await client[operation]('fixture', 'did:plc:alice', `at://did:plc:alice/${collection}/123`);
    assert.equal(calls.length, count + 1);
    assert.deepEqual(JSON.parse(calls.at(-1).body), { repo: 'did:plc:alice', collection, rkey: '123' });
    assert.equal(calls.at(-1).redirect, 'error');
    assert.equal(calls.at(-1).credentials, 'omit');
  }
  assert.equal(calls.length, 3);
});

test('refuses the safeStorage plaintext fallback before persisting a session', () => {
  const vault = createBlueskySessionVault({ filePath: 'unused', safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'basic_text',
    encryptString: () => assert.fail('must not encrypt with fallback'),
  } });
  assert.throws(() => vault.save({}), /encryption is unavailable/);
});

test('secret detection returns redacted locations for synthetic credentials', () => {
  const key = ['sk-', 'proj-', 'a'.repeat(40)].join('');
  const findings = inspect(`const value = '${key}';`);
  assert.deepEqual(findings, [{ line: 1, rule: 'provider-key' }]);
  assert.equal(JSON.stringify(findings).includes(key), false);
  assert.equal(inspect('const apiKey = process.env.API_KEY;').length, 0);
  assert.equal(inspect(`apiKey = '${'a'.repeat(24)}'`).length, 1);
});
