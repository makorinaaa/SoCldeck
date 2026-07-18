const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadComposeRequest() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'compose-request.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckComposeRequest;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('creates an X Compose Request from confirmed text and images', () => {
  const firstImage = { name: 'one.png' };
  const secondImage = { name: 'two.png' };

  const request = loadComposeRequest().createComposeRequest({
    networkId: 'x',
    accountId: 'alice',
    text: '  hello SocialDeck  ',
    images: [
      { file: firstImage },
      { file: secondImage },
    ],
  });

  assert.deepEqual(plain(request), {
    target: { networkId: 'x', accountId: 'alice' },
    text: 'hello SocialDeck',
    attachments: [
      { kind: 'image', file: { name: 'one.png' }, altText: '' },
      { kind: 'image', file: { name: 'two.png' }, altText: '' },
    ],
    replyTo: null,
  });
});

test('creates a Bluesky Compose Request with alt text and reply context', () => {
  const request = loadComposeRequest().createComposeRequest({
    networkId: 'b',
    accountId: 'did:plc:alice',
    text: 'reply text',
    images: [{ file: { name: 'photo.jpg' }, altText: 'A sunset' }],
    replyTo: {
      root: { uri: 'at://root', cid: 'root-cid' },
      parent: { uri: 'at://parent', cid: 'parent-cid' },
    },
  });

  assert.deepEqual(plain(request), {
    target: { networkId: 'b', accountId: 'did:plc:alice' },
    text: 'reply text',
    attachments: [
      { kind: 'image', file: { name: 'photo.jpg' }, altText: 'A sunset' },
    ],
    replyTo: {
      root: { uri: 'at://root', cid: 'root-cid' },
      parent: { uri: 'at://parent', cid: 'parent-cid' },
    },
  });
});

test('captures a video attachment and user-selected trim range', () => {
  const request = loadComposeRequest().createComposeRequest({
    networkId: 'x',
    accountId: 'alice',
    text: '',
    video: {
      file: { name: 'clip.mp4' },
      trim: { startSeconds: 2.5, endSeconds: 42 },
    },
  });

  assert.deepEqual(plain(request), {
    target: { networkId: 'x', accountId: 'alice' },
    text: '',
    attachments: [{
      kind: 'video',
      file: { name: 'clip.mp4' },
      trim: { startSeconds: 2.5, endSeconds: 42 },
    }],
    replyTo: null,
  });
});

test('keeps Bluesky video host metadata out of image attachments', () => {
  const request = loadComposeRequest().createComposeRequest({
    networkId: 'b',
    accountId: 'did:plc:alice',
    text: 'video',
    video: {
      file: { name: 'clip.mp4' },
      sourcePath: 'C:\\media\\clip.mp4',
      durationSeconds: 90,
      altText: 'Demo video',
      trim: { startSeconds: 5, endSeconds: 65 },
    },
  });

  assert.deepEqual(plain(request.attachments[0]), {
    kind: 'video',
    file: { name: 'clip.mp4' },
    sourcePath: 'C:\\media\\clip.mp4',
    durationSeconds: 90,
    altText: 'Demo video',
    trim: { startSeconds: 5, endSeconds: 65 },
  });
});

test('rejects a Compose Request without text or attachments', () => {
  assert.throws(
    () => loadComposeRequest().createComposeRequest({
      networkId: 'x',
      accountId: 'alice',
      text: '   ',
    }),
    /text or attachment/i,
  );
});
