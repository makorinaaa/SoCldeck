const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AtprotoError,
  createBlueskyGateway,
} = require('../src/main/bluesky-gateway');
const { createAtprotoClient } = require('../src/main/bluesky-atproto-client');

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

test('bounds Bluesky conversation ancestor and reply depth', async () => {
  const calls = [];
  const gateway = createBlueskyGateway({
    vault: createVault(SESSION),
    client: {
      async getThread(...args) {
        calls.push(args);
        return { thread: {} };
      },
    },
  });

  await gateway.execute('getThread', {
    uri: 'at://did:plc:alice/app.bsky.feed.post/1',
    depth: 12,
    parentHeight: 8,
  });

  assert.deepEqual(calls, [[
    SESSION.accessJwt,
    'at://did:plc:alice/app.bsky.feed.post/1',
    12,
    8,
  ]]);
  await assert.rejects(
    gateway.execute('getThread', { uri: 'at://post/1', depth: 101, parentHeight: 8 }),
    /depth/i,
  );
});

test('prepares and uploads an allowlisted Bluesky video file', async () => {
  const calls = [];
  const gateway = createBlueskyGateway({
    vault: createVault(SESSION),
    prepareVideo: async input => {
      calls.push(['prepare', input]);
      return { name: 'clip.mp4', bytes: Buffer.from([1, 2, 3]) };
    },
    client: {
      async uploadVideo(...args) {
        calls.push(['upload', ...args]);
        return { ref: 'video-blob' };
      },
    },
  });

  const result = await gateway.execute('uploadVideo', {
    filePath: 'C:\\media\\clip.mp4',
    name: 'clip.mp4',
    startSeconds: 5,
    endSeconds: 65,
    durationSeconds: 90,
  });

  assert.deepEqual(result, { blob: { ref: 'video-blob' } });
  assert.equal(calls[0][0], 'prepare');
  assert.equal(calls[0][1].filePath, 'C:\\media\\clip.mp4');
  assert.deepEqual(calls[1].slice(0, 4), [
    'upload', SESSION.accessJwt, SESSION.did, 'clip.mp4',
  ]);
  assert.deepEqual(calls[1][4], Buffer.from([1, 2, 3]));
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

test('refreshes an expired session without sending an unexpected request body', async () => {
  const calls = [];
  const client = createAtprotoClient({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      const endpoint = new URL(url).pathname;
      if (endpoint.endsWith('/app.bsky.notification.listNotifications')) {
        const token = options.headers.Authorization;
        if (token === `Bearer ${SESSION.accessJwt}`) {
          return {
            ok: false,
            status: 401,
            async text() {
              return JSON.stringify({ error: 'ExpiredToken', message: 'Token has expired' });
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() { return JSON.stringify({ notifications: [] }); },
        };
      }
      if (endpoint.endsWith('/com.atproto.server.refreshSession')) {
        if (options.body !== undefined) {
          return {
            ok: false,
            status: 400,
            async text() {
              return JSON.stringify({
                error: 'InvalidRequest',
                message: 'A request body was provided when none was expected',
              });
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ...SESSION,
              accessJwt: 'access-refreshed',
              refreshJwt: 'refresh-refreshed',
            });
          },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const gateway = createBlueskyGateway({ vault: createVault(SESSION), client });

  const result = await gateway.execute('listNotifications', { limit: 40 });

  assert.deepEqual(result, { notifications: [] });
  const refreshCall = calls.find(([url]) => (
    new URL(url).pathname.endsWith('/com.atproto.server.refreshSession')
  ));
  assert.equal(refreshCall[1].body, undefined);
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
