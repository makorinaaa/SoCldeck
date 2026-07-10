const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadComposeFlow() {
  const context = { URL, window: {} };
  const moduleNames = [
    'compose-request.js',
    'network-adapters.js',
    'compose-completion.js',
  ];

  moduleNames.forEach(moduleName => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'renderer', moduleName),
      'utf8',
    );
    vm.runInNewContext(source, context);
  });

  const registry = context.window.SocialDeckNetworkAdapters.createNetworkAdapterRegistry({
    icons: { x: 'x', bell: 'bell', gear: 'gear', bsky: 'bsky' },
  });

  return {
    createRequest: context.window.SocialDeckComposeRequest.createComposeRequest,
    prepareDelivery: request => registry.prepareComposeDelivery(request),
    prepareCompletion: request => registry.prepareComposeCompletion(request),
    createCompletionRuntime:
      context.window.SocialDeckComposeCompletion.createComposeCompletionRuntime,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createCompletionRecorder(flow) {
  const events = [];
  const scheduled = [];
  const runtime = flow.createCompletionRuntime({
    notify: message => events.push(['notify', message]),
    refresh: target => events.push(['refresh', plain(target)]),
    schedule: (task, delayMs) => {
      events.push(['schedule', delayMs]);
      scheduled.push(task);
    },
  });
  return { events, runtime, scheduled };
}

test('X video compose flows from user intent to account refresh', async () => {
  const flow = loadComposeFlow();
  const completion = createCompletionRecorder(flow);
  const request = flow.createRequest({
    networkId: 'x',
    accountId: 'alice',
    text: '  launch video  ',
    video: {
      file: { name: 'launch.mp4', type: 'video/mp4' },
      trim: { startSeconds: 2, endSeconds: 20 },
    },
  });

  assert.deepEqual(plain(flow.prepareDelivery(request)), {
    kind: 'x-webview',
    accountId: 'alice',
    text: 'launch video',
    imageFiles: [],
    video: {
      file: { name: 'launch.mp4', type: 'video/mp4' },
      trim: { startSeconds: 2, endSeconds: 20 },
    },
  });

  completion.runtime.complete(flow.prepareCompletion(request));
  assert.deepEqual(completion.events, [
    ['notify', 'Posted to alice'],
    ['schedule', 2500],
  ]);

  await completion.scheduled[0]();
  assert.deepEqual(completion.events.at(-1), [
    'refresh',
    { kind: 'x-account-columns', accountId: 'alice' },
  ]);
});

test('Bluesky reply compose preserves alt text through timeline refresh', async () => {
  const flow = loadComposeFlow();
  const completion = createCompletionRecorder(flow);
  const request = flow.createRequest({
    networkId: 'b',
    accountId: 'did:plc:alice',
    text: 'A reply',
    images: [{
      file: { name: 'sunset.jpg', type: 'image/jpeg' },
      altText: 'Sunset over the bay',
    }],
    replyTo: {
      root: { uri: 'at://root', cid: 'root-cid' },
      parent: { uri: 'at://parent', cid: 'parent-cid' },
    },
  });

  assert.deepEqual(plain(flow.prepareDelivery(request)), {
    kind: 'bsky-atproto',
    repoDid: 'did:plc:alice',
    text: 'A reply',
    images: [{
      file: { name: 'sunset.jpg', type: 'image/jpeg' },
      alt: 'Sunset over the bay',
    }],
    reply: {
      root: { uri: 'at://root', cid: 'root-cid' },
      parent: { uri: 'at://parent', cid: 'parent-cid' },
    },
  });

  completion.runtime.complete(flow.prepareCompletion(request));
  assert.deepEqual(completion.events, [
    ['notify', 'Posted to Bluesky'],
    ['schedule', 1000],
  ]);

  await completion.scheduled[0]();
  assert.deepEqual(completion.events.at(-1), [
    'refresh',
    { kind: 'bsky-timelines', accountId: 'did:plc:alice' },
  ]);
});

test('invalid X attachments stop before completion is emitted', () => {
  const flow = loadComposeFlow();
  const completion = createCompletionRecorder(flow);
  const request = flow.createRequest({
    networkId: 'x',
    accountId: 'alice',
    text: 'invalid attachments',
    images: [{ file: { name: 'photo.jpg' } }],
    video: { file: { name: 'clip.mp4' } },
  });

  assert.throws(
    () => flow.prepareDelivery(request),
    /cannot mix image and video attachments/,
  );
  assert.deepEqual(completion.events, []);
  assert.deepEqual(completion.scheduled, []);
});
