const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadFlow() {
  const context = { URL, window: {} };
  for (const moduleName of [
    'compose-request.js',
    'network-adapters.js',
    'compose-cross-post-plan.js',
  ]) {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'renderer', moduleName),
      'utf8',
    );
    vm.runInNewContext(source, context);
  }
  const registry = context.window.SocialDeckNetworkAdapters.createNetworkAdapterRegistry({
    icons: { x: 'x', bell: 'bell', gear: 'gear', bsky: 'bsky' },
  });
  return {
    createPlan: options => context.window.SocialDeckComposeCrossPostPlan.createCrossPostPlan({
      ...options,
      createRequest: context.window.SocialDeckComposeRequest.createComposeRequest,
      prepareDelivery: request => registry.prepareComposeDelivery(request),
      prepareCompletion: request => registry.prepareComposeCompletion(request),
    }),
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('builds X and Bluesky video deliveries from one selected trim range', () => {
  const flow = loadFlow();
  const file = { name: 'shared.mp4', type: 'video/mp4' };
  const plan = flow.createPlan({
    text: 'shared clip',
    media: {
      images: [],
      video: {
        file,
        path: 'C:\\video\\shared.mp4',
        durationSeconds: 90,
        trim: { startSeconds: 5.25, endSeconds: 45.75 },
      },
    },
    xAccountId: '@alice',
    blueskyAccountId: 'did:plc:alice',
  });

  assert.deepEqual(plain(plan.x.delivery.video), {
    file,
    trim: { startSeconds: 5.25, endSeconds: 45.75 },
  });
  assert.deepEqual(plain(plan.x.executionContext), {
    videoPath: 'C:\\video\\shared.mp4',
    videoDuration: 90,
  });
  assert.deepEqual(plain(plan.bluesky.delivery.video), {
    file,
    sourcePath: 'C:\\video\\shared.mp4',
    durationSeconds: 90,
    trim: { startSeconds: 5.25, endSeconds: 45.75 },
    alt: '',
  });
});

test('preserves image alt text while sharing an image post', () => {
  const flow = loadFlow();
  const file = { name: 'diagram.png', type: 'image/png' };
  const plan = flow.createPlan({
    text: 'diagram',
    media: { images: [{ file, altText: 'System diagram' }], video: null },
    xAccountId: '@alice',
    blueskyAccountId: 'did:plc:alice',
  });

  assert.deepEqual(plain(plan.x.delivery.imageFiles), [file]);
  assert.deepEqual(plain(plan.bluesky.delivery.images), [{ file, alt: 'System diagram' }]);
});
