const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'bluesky-gateway-adapter.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckBlueskyGatewayAdapter;
}

const plain = value => JSON.parse(JSON.stringify(value));

test('maps Bluesky reads to the host Gateway without credentials', async () => {
  const calls = [];
  const adapter = loadModule().createBlueskyGatewayAdapter({
    invoke: async (...args) => { calls.push(args); return { ok: true }; },
  });

  await adapter.getTimeline({ limit: 40, cursor: 'next' });
  await adapter.getFeed({ feedUri: 'at://feed/1', limit: 30 });
  await adapter.getProfile({ actor: 'alice.test' });
  await adapter.getUnreadCount();

  assert.deepEqual(plain(calls), [
    ['getTimeline', { limit: 40, cursor: 'next' }],
    ['getFeed', { feedUri: 'at://feed/1', limit: 30 }],
    ['getProfile', { actor: 'alice.test' }],
    ['getUnreadCount', {}],
  ]);
  assert.equal(JSON.stringify(calls).includes('Jwt'), false);
});

test('maps writes while leaving Network Account identity inside the host', async () => {
  const calls = [];
  const adapter = loadModule().createBlueskyGatewayAdapter({
    invoke: async (...args) => { calls.push(args); return {}; },
  });

  await adapter.follow({ targetDid: 'did:plc:alice' });
  await adapter.like({ uri: 'at://post/1', cid: 'cid-1' });
  await adapter.createPostRecord({ record: { $type: 'app.bsky.feed.post', text: 'hello' } });
  await adapter.uploadBlob({ mimeType: 'image/png', bytes: new Uint8Array([1, 2]) });

  assert.deepEqual(calls.map(([operation]) => operation), [
    'follow', 'like', 'createPostRecord', 'uploadBlob',
  ]);
  assert.equal(JSON.stringify(calls).includes('repoDid'), false);
});

test('uses dedicated host capabilities for login and logout', async () => {
  const calls = [];
  const adapter = loadModule().createBlueskyGatewayAdapter({
    invoke: async () => ({}),
    login: async credentials => {
      calls.push(['login', credentials]);
      return { handle: 'alice.test', did: 'did:plc:alice' };
    },
    clearSession: async () => { calls.push(['clear']); return true; },
  });

  const account = await adapter.login(' alice.test ', 'app-password');
  await adapter.clearSession();

  assert.deepEqual(account, { handle: 'alice.test', did: 'did:plc:alice' });
  assert.deepEqual(plain(calls), [
    ['login', { handle: 'alice.test', password: 'app-password' }],
    ['clear'],
  ]);
});
