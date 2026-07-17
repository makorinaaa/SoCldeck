const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AtprotoError,
  createBlueskyGateway,
} = require('../src/main/bluesky-gateway');

function createVault(initial = null) {
  let session = initial;
  const events = [];
  return {
    events,
    load() { events.push(['load']); return session; },
    save(next) { session = { ...next }; events.push(['save', session]); return session; },
    clear() { session = null; events.push(['clear']); return true; },
    getSession: () => session,
  };
}

const SESSION = {
  handle: 'alice.test',
  did: 'did:plc:alice',
  accessJwt: 'access-secret',
  refreshJwt: 'refresh-secret',
};

test('logs in through the Gateway, stores credentials, and returns only public account data', async () => {
  const vault = createVault();
  const client = {
    async login(identifier, password) {
      assert.equal(identifier, 'alice.test');
      assert.equal(password, 'app-password');
      return SESSION;
    },
    async getProfile(jwt, actor) {
      assert.equal(jwt, SESSION.accessJwt);
      assert.equal(actor, SESSION.did);
      return { displayName: 'Alice', avatar: 'https://cdn.example/alice.png' };
    },
  };
  const gateway = createBlueskyGateway({ vault, client });

  const account = await gateway.login({ handle: ' alice.test ', password: 'app-password' });

  assert.deepEqual(account, {
    handle: 'alice.test',
    did: 'did:plc:alice',
    displayName: 'Alice',
    avatar: 'https://cdn.example/alice.png',
  });
  assert.equal(JSON.stringify(account).includes('secret'), false);
  assert.deepEqual(vault.getSession(), SESSION);
});

test('restores only public Network Account identity from the encrypted Vault', () => {
  const gateway = createBlueskyGateway({ vault: createVault(SESSION), client: {} });

  assert.deepEqual(gateway.restoreAccount(), {
    handle: 'alice.test',
    did: 'did:plc:alice',
  });
  assert.equal(JSON.stringify(gateway.restoreAccount()).includes('Jwt'), false);
});

test('executes an allowlisted operation with Vault credentials', async () => {
  const calls = [];
  const gateway = createBlueskyGateway({
    vault: createVault(SESSION),
    client: {
      async timeline(jwt, limit, cursor) {
        calls.push([jwt, limit, cursor]);
        return { feed: [{ post: { uri: 'at://post/1' } }], cursor: 'next' };
      },
    },
  });

  const result = await gateway.execute('getTimeline', { limit: 20, cursor: 'cursor-1' });

  assert.deepEqual(calls, [['access-secret', 20, 'cursor-1']]);
  assert.deepEqual(result, { feed: [{ post: { uri: 'at://post/1' } }], cursor: 'next' });
});

test('refreshes an expired session, persists it, and retries once', async () => {
  const vault = createVault(SESSION);
  const calls = [];
  const gateway = createBlueskyGateway({
    vault,
    client: {
      async notifications(jwt, limit) {
        calls.push(['notifications', jwt, limit]);
        if (jwt === SESSION.accessJwt) throw new AtprotoError('ExpiredToken', { status: 401, code: 'ExpiredToken' });
        return { notifications: [] };
      },
      async refresh(refreshJwt) {
        calls.push(['refresh', refreshJwt]);
        return {
          ...SESSION,
          accessJwt: 'access-refreshed',
          refreshJwt: 'refresh-refreshed',
        };
      },
    },
  });

  const result = await gateway.execute('listNotifications', { limit: 40 });

  assert.deepEqual(result, { notifications: [] });
  assert.deepEqual(calls, [
    ['notifications', 'access-secret', 40],
    ['refresh', 'refresh-secret'],
    ['notifications', 'access-refreshed', 40],
  ]);
  assert.equal(vault.getSession().accessJwt, 'access-refreshed');
});

test('forces post creation to use the Vault account DID', async () => {
  const calls = [];
  const gateway = createBlueskyGateway({
    vault: createVault(SESSION),
    client: {
      async createRecord(jwt, did, record) {
        calls.push([jwt, did, record]);
        return { uri: 'at://did:plc:alice/app.bsky.feed.post/1' };
      },
    },
  });
  const record = { $type: 'app.bsky.feed.post', text: 'hello', createdAt: '2026-07-17T00:00:00.000Z' };

  await gateway.execute('createPostRecord', { repoDid: 'did:plc:attacker', record });

  assert.deepEqual(calls, [['access-secret', 'did:plc:alice', record]]);
});

test('rejects unknown operations and invalid bounded inputs', async () => {
  const gateway = createBlueskyGateway({ vault: createVault(SESSION), client: {} });

  await assert.rejects(gateway.execute('rawXrpc', { endpoint: 'admin.delete' }), /unsupported/i);
  await assert.rejects(
    gateway.execute('searchPosts', { query: 'x'.repeat(2_000), limit: 40 }),
    /invalid/i,
  );
  await assert.rejects(
    gateway.execute('uploadBlob', { mimeType: 'text/html', bytes: new Uint8Array([1, 2, 3]) }),
    /invalid/i,
  );
});
