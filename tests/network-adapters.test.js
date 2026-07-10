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
