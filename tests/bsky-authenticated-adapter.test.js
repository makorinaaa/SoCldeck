const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadClientModule() {
  const context = { window: {}, URLSearchParams };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'bsky-client.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckBskyClient;
}

test('refreshes an expired Bluesky account inside the authenticated adapter', async () => {
  const calls = [];
  let account = {
    did: 'did:plc:self',
    accessJwt: 'access-old',
    refreshJwt: 'refresh-old',
  };
  const client = {
    async timeline(jwt, limit, cursor) {
      calls.push(['timeline', jwt, limit, cursor]);
      if (jwt === 'access-old') throw new Error('ExpiredToken');
      return { feed: [], cursor: null };
    },
    async refresh(refreshJwt) {
      calls.push(['refresh', refreshJwt]);
      return { accessJwt: 'access-new', refreshJwt: 'refresh-new' };
    },
  };
  const adapter = loadClientModule().createAuthenticatedBlueskyAdapter({
    client,
    getAccount: () => account,
    updateAccount: next => { account = { ...account, ...next }; },
  });

  const result = await adapter.getTimeline({ limit: 40, cursor: 'cursor-1' });

  assert.deepEqual(calls, [
    ['timeline', 'access-old', 40, 'cursor-1'],
    ['refresh', 'refresh-old'],
    ['timeline', 'access-new', 40, 'cursor-1'],
  ]);
  assert.deepEqual(account, {
    did: 'did:plc:self',
    accessJwt: 'access-new',
    refreshJwt: 'refresh-new',
  });
  assert.deepEqual(result, { feed: [], cursor: null });
});

test('keeps Network Account identity inside authenticated Bluesky writes', async () => {
  const calls = [];
  const account = {
    did: 'did:plc:self',
    accessJwt: 'access-token',
    refreshJwt: 'refresh-token',
  };
  const adapter = loadClientModule().createAuthenticatedBlueskyAdapter({
    client: {
      async like(...args) { calls.push(['like', ...args]); return { uri: 'at://like/1' }; },
      async unlike(...args) { calls.push(['unlike', ...args]); return {}; },
      async repost(...args) { calls.push(['repost', ...args]); return { uri: 'at://repost/1' }; },
      async unrepost(...args) { calls.push(['unrepost', ...args]); return {}; },
    },
    getAccount: () => account,
    updateAccount() {},
  });

  await adapter.like({ uri: 'at://post/1', cid: 'cid-1' });
  await adapter.unlike({ likeUri: 'at://like/1' });
  await adapter.repost({ uri: 'at://post/1', cid: 'cid-1' });
  await adapter.unrepost({ repostUri: 'at://repost/1' });

  assert.deepEqual(calls, [
    ['like', 'access-token', 'did:plc:self', 'at://post/1', 'cid-1'],
    ['unlike', 'access-token', 'did:plc:self', 'at://like/1'],
    ['repost', 'access-token', 'did:plc:self', 'at://post/1', 'cid-1'],
    ['unrepost', 'access-token', 'did:plc:self', 'at://repost/1'],
  ]);
});

test('reads a Bluesky thread without exposing the access token', async () => {
  const calls = [];
  const adapter = loadClientModule().createAuthenticatedBlueskyAdapter({
    client: {
      async getThread(...args) { calls.push(args); return { thread: { post: {} } }; },
    },
    getAccount: () => ({ did: 'did:plc:self', accessJwt: 'access-token', refreshJwt: 'refresh-token' }),
    updateAccount() {},
  });

  await adapter.getThread({ uri: 'at://post/1', depth: 6 });

  assert.deepEqual(calls, [['access-token', 'at://post/1', 6]]);
});

test('reads a custom Bluesky Feed without exposing the access token', async () => {
  const calls = [];
  const adapter = loadClientModule().createAuthenticatedBlueskyAdapter({
    client: {
      async feed(...args) { calls.push(args); return { feed: [], cursor: null }; },
    },
    getAccount: () => ({ did: 'did:plc:self', accessJwt: 'access-token', refreshJwt: 'refresh-token' }),
    updateAccount() {},
  });

  await adapter.getFeed({ feedUri: 'at://feed/custom', limit: 40, cursor: 'next' });

  assert.deepEqual(calls, [['access-token', 'at://feed/custom', 40, 'next']]);
});

test('searches Bluesky posts without exposing the access token', async () => {
  const calls = [];
  const adapter = loadClientModule().createAuthenticatedBlueskyAdapter({
    client: {
      async search(...args) { calls.push(args); return { posts: [] }; },
    },
    getAccount: () => ({ did: 'did:plc:self', accessJwt: 'access-token', refreshJwt: 'refresh-token' }),
    updateAccount() {},
  });

  await adapter.searchPosts({ query: 'blue sky', limit: 40 });

  assert.deepEqual(calls, [['access-token', 'blue sky', 40]]);
});

test('reads and marks Bluesky notifications without exposing the access token', async () => {
  const calls = [];
  const adapter = loadClientModule().createAuthenticatedBlueskyAdapter({
    client: {
      async notifications(...args) { calls.push(['list', ...args]); return { notifications: [] }; },
      async updateSeen(...args) { calls.push(['seen', ...args]); return {}; },
    },
    getAccount: () => ({ did: 'did:plc:self', accessJwt: 'access-token', refreshJwt: 'refresh-token' }),
    updateAccount() {},
  });

  await adapter.listNotifications({ limit: 40 });
  await adapter.markNotificationsSeen({ seenAt: '2026-07-16T03:00:00.000Z' });

  assert.deepEqual(calls, [
    ['list', 'access-token', 40],
    ['seen', 'access-token', '2026-07-16T03:00:00.000Z'],
  ]);
});

test('reads profiles and updates follows without exposing account identity', async () => {
  const calls = [];
  const adapter = loadClientModule().createAuthenticatedBlueskyAdapter({
    client: {
      async getProfile(...args) { calls.push(['profile', ...args]); return { did: 'did:plc:alice' }; },
      async follow(...args) { calls.push(['follow', ...args]); return { uri: 'at://follow/1' }; },
      async unfollow(...args) { calls.push(['unfollow', ...args]); return {}; },
    },
    getAccount: () => ({ did: 'did:plc:self', accessJwt: 'access-token', refreshJwt: 'refresh-token' }),
    updateAccount() {},
  });

  await adapter.getProfile({ actor: 'alice.test' });
  await adapter.follow({ targetDid: 'did:plc:alice' });
  await adapter.unfollow({ followUri: 'at://follow/1' });

  assert.deepEqual(calls, [
    ['profile', 'access-token', 'alice.test'],
    ['follow', 'access-token', 'did:plc:self', 'did:plc:alice'],
    ['unfollow', 'access-token', 'did:plc:self', 'at://follow/1'],
  ]);
});
