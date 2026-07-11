const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createRegistry() {
  const context = { URL, window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'network-adapters.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckNetworkAdapters.createNetworkAdapterRegistry({
    icons: { x: 'x', bell: 'bell', gear: 'gear', bsky: 'bsky' },
  });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('X compose capability prepares WebView delivery', () => {
  const registry = createRegistry();
  const request = {
    target: { networkId: 'x', accountId: 'alice' },
    text: 'hello',
    attachments: [
      { kind: 'image', file: { name: 'photo.png' }, altText: '' },
    ],
    replyTo: null,
  };

  assert.deepEqual(plain(registry.prepareComposeDelivery(request)), {
    kind: 'x-webview',
    accountId: 'alice',
    text: 'hello',
    imageFiles: [{ name: 'photo.png' }],
    video: null,
  });
});

test('X compose capability preserves video trim settings', () => {
  const registry = createRegistry();
  const request = {
    target: { networkId: 'x', accountId: 'alice' },
    text: '',
    attachments: [
      {
        kind: 'video',
        file: { name: 'clip.mp4' },
        trim: { startSeconds: 3, endSeconds: 33 },
      },
    ],
    replyTo: null,
  };

  assert.deepEqual(plain(registry.prepareComposeDelivery(request)), {
    kind: 'x-webview',
    accountId: 'alice',
    text: '',
    imageFiles: [],
    video: {
      file: { name: 'clip.mp4' },
      trim: { startSeconds: 3, endSeconds: 33 },
    },
  });
});

test('X compose capability rejects mixed image and video attachments', () => {
  const registry = createRegistry();
  const request = {
    target: { networkId: 'x', accountId: 'alice' },
    text: 'hello',
    attachments: [
      { kind: 'image', file: { name: 'photo.png' }, altText: '' },
      {
        kind: 'video',
        file: { name: 'clip.mp4' },
        trim: { startSeconds: 0, endSeconds: null },
      },
    ],
    replyTo: null,
  };

  assert.throws(
    () => registry.prepareComposeDelivery(request),
    /cannot mix image and video attachments/,
  );
});

test('Bluesky compose capability prepares AT Protocol delivery', () => {
  const registry = createRegistry();
  const request = {
    target: { networkId: 'b', accountId: 'did:plc:alice' },
    text: 'reply',
    attachments: [
      { kind: 'image', file: { name: 'photo.jpg' }, altText: 'A sunset' },
    ],
    replyTo: {
      root: { uri: 'at://root', cid: 'root-cid' },
      parent: { uri: 'at://parent', cid: 'parent-cid' },
    },
  };

  assert.deepEqual(plain(registry.prepareComposeDelivery(request)), {
    kind: 'bsky-atproto',
    repoDid: 'did:plc:alice',
    text: 'reply',
    images: [{ file: { name: 'photo.jpg' }, alt: 'A sunset' }],
    reply: {
      root: { uri: 'at://root', cid: 'root-cid' },
      parent: { uri: 'at://parent', cid: 'parent-cid' },
    },
  });
});

test('X compose capability prepares account timeline completion', () => {
  const registry = createRegistry();

  assert.deepEqual(plain(registry.prepareComposeCompletion({
    target: { networkId: 'x', accountId: 'alice' },
  })), {
    message: 'Posted to alice',
    refresh: { kind: 'x-account-columns', accountId: 'alice' },
    delayMs: 2500,
  });
});

test('Bluesky compose capability prepares timeline completion', () => {
  const registry = createRegistry();

  assert.deepEqual(plain(registry.prepareComposeCompletion({
    target: { networkId: 'b', accountId: 'did:plc:alice' },
  })), {
    message: 'Posted to Bluesky',
    refresh: { kind: 'bsky-timelines', accountId: 'did:plc:alice' },
    delayMs: 1000,
  });
});

test('X list Column plan accepts Definition parameters', () => {
  const registry = createRegistry();

  const plan = registry.createColumnPlan({
    networkId: 'x',
    definitionId: 'x-list-new',
    id: 'x-list-1',
    account: { index: 1, username: 'alice', partition: 'persist:x-1' },
    params: { url: 'https://x.com/i/lists/123', title: 'Team' },
  });

  assert.equal(plan.kind, 'wv');
  assert.equal(plan.partition, 'persist:x-1');
  assert.equal(plan.config.url, 'https://x.com/i/lists/123');
  assert.equal(plan.config.title, 'Team');
  assert.equal(plan.config.definitionId, 'x-list-new');
});

test('Bluesky profile Column is parameterized and hidden from the picker', () => {
  const registry = createRegistry();
  const definition = registry.getColumnDefinition('b', 'b-profile');
  const plan = registry.createColumnPlan({
    networkId: 'b',
    definitionId: 'b-profile',
    id: 'b-profile-1',
    params: { url: 'https://bsky.app/profile/alice.test' },
  });

  assert.equal(definition.picker, false);
  assert.equal(plan.kind, 'wv');
  assert.equal(plan.partition, 'persist:bsky');
  assert.equal(plan.config.url, 'https://bsky.app/profile/alice.test');
  assert.equal(plan.config.definitionId, 'b-profile');
});

test('resolves a legacy Bluesky profile WebView to its Column Definition', () => {
  const registry = createRegistry();

  const definition = registry.resolveColumnDefinition({
    kind: 'wv',
    partition: 'persist:bsky',
    url: 'https://bsky.app/profile/alice.test',
  });

  assert.equal(definition.id, 'b-profile');
});

test('X Column refresh falls back to WebView reload when timeline refresh is unavailable', async () => {
  const registry = createRegistry();
  const calls = [];

  await registry.executeColumnRefresh('x-home', { networkId: 'x', kind: 'webview' }, {
    refreshXTimeline: async id => {
      calls.push(['timeline', id]);
      return false;
    },
    reloadWebView: id => calls.push(['reload', id]),
  });

  assert.deepEqual(calls, [['timeline', 'x-home'], ['reload', 'x-home']]);
});

test('Bluesky Column refresh delegates feed parameters to its adapter operation', () => {
  const registry = createRegistry();
  const calls = [];

  registry.executeColumnRefresh('b-feed', {
    networkId: 'b',
    kind: 'feed',
    type: 'feed',
    feedUri: 'at://feed',
  }, {
    refreshBlueskyFeed: (...args) => calls.push(args),
  });

  assert.deepEqual(calls, [['b-feed', 'feed', 'at://feed']]);
});
