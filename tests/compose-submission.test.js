const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSubmission() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'compose-submission.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckComposeSubmission;
}

function createHarness({
  snapshots,
  status = {},
  singleResult = { status: 'succeeded' },
  crossResult = { status: 'succeeded' },
  validateVideo = () => ({ valid: true }),
  replyTarget = null,
  confirmAnswer = true,
  postKeys = ['post-key-1', 'post-key-2'],
} = {}) {
  const calls = {
    busy: [],
    closed: [],
    confirms: [],
    crossPlans: [],
    requests: [],
    single: [],
    cross: [],
    toasts: [],
    xDeliveries: [],
    bDeliveries: [],
  };
  const runtime = loadSubmission().createComposeSubmission({
    modalRuntime: {
      getSnapshot: networkId => snapshots[networkId],
      setBusy: (...args) => {
        calls.busy.push(args);
        const [networkId, busy, , options] = args;
        if (busy && options?.deliveryKey && snapshots[networkId] && !snapshots[networkId].deliveryKey) {
          snapshots[networkId].deliveryKey = options.deliveryKey;
        }
      },
      close: networkId => calls.closed.push(networkId),
    },
    coordinator: {
      getStatus: networkId => ({
        isSending: false,
        hasUnknownSingle: false,
        hasUnknownCross: false,
        ...(status[networkId] || {}),
      }),
      submitSingle: async submission => {
        calls.single.push(submission);
        return singleResult;
      },
      submitCrossPost: async (targets, options) => {
        calls.cross.push({ targets, options });
        return crossResult;
      },
    },
    createRequest: request => {
      calls.requests.push(request);
      return { request };
    },
    adapters: {
      prepareComposeDelivery: request => ({ delivery: request }),
      prepareComposeCompletion: request => ({ completion: request }),
      executeComposeDelivery: async delivery => {
        calls.bDeliveries.push(delivery);
        return { delivered: delivery };
      },
    },
    createCrossPostPlan: plan => {
      calls.crossPlans.push(plan);
      return {
        x: {
          request: { id: 'x-request' },
          delivery: { id: 'x-delivery' },
          completionPlan: { id: 'x-completion' },
          executionContext: { videoPath: plan.media?.video?.path || null },
        },
        bluesky: {
          request: { id: 'b-request' },
          delivery: { id: 'b-delivery' },
          completionPlan: { id: 'b-completion' },
          executionContext: {},
        },
      };
    },
    mediaDrafts: {
      x: { validateVideo },
      b: { validateVideo },
    },
    executeXDelivery: async (delivery, context) => {
      calls.xDeliveries.push({ delivery, context });
      return { delivered: delivery };
    },
    getBlueskyAccount: () => ({ did: 'did:plc:me' }),
    getReplyTarget: () => replyTarget,
    formatSeconds: seconds => `${seconds}s`,
    createPostKey: () => postKeys.shift(),
    ui: {
      toast: message => calls.toasts.push(message),
      confirm: message => {
        calls.confirms.push(message);
        return confirmAnswer;
      },
    },
  });
  return { runtime, calls };
}

test('submits a single X post through the Coordinator and closes on success', async () => {
  const { runtime, calls } = createHarness({
    snapshots: {
      x: {
        text: ' 今これ ',
        crossPost: false,
        selectedAccount: { username: 'stl' },
        media: { images: [{ file: 'image-file', altText: '' }], video: null },
      },
    },
  });

  await runtime.submit('x');

  assert.equal(calls.requests[0].networkId, 'x');
  assert.equal(calls.requests[0].accountId, 'stl');
  assert.equal(calls.requests[0].text, '今これ');
  assert.deepEqual(plain(calls.requests[0].images), [{ file: 'image-file' }]);
  assert.equal(calls.single.length, 1);
  await calls.single[0].deliver();
  assert.deepEqual(plain(calls.xDeliveries[0].context), { videoPath: null, videoDuration: 0 });
  assert.deepEqual(plain(calls.busy), [['x', true, '送信中…'], ['x', false, null]]);
  assert.deepEqual(calls.closed, ['x']);
  assert.deepEqual(calls.toasts, []);
});

test('blocks an over-length X video before delivery', async () => {
  const { runtime, calls } = createHarness({
    snapshots: {
      x: {
        text: '',
        crossPost: false,
        selectedAccount: { username: 'stl' },
        media: {
          images: [],
          video: { file: 'clip', trim: { startSeconds: 0, endSeconds: 150 }, trimDurationSeconds: 150 },
        },
      },
    },
  });

  await runtime.submit('x');

  assert.equal(calls.single.length, 0);
  assert.match(calls.toasts[0], /動画が長すぎます（150s）/);
});

test('keeps the X modal open for retry after an unknown delivery', async () => {
  const { runtime, calls } = createHarness({
    snapshots: {
      x: {
        text: 'hello',
        crossPost: false,
        selectedAccount: { username: 'stl' },
        media: { images: [], video: null },
      },
    },
    singleResult: { status: 'unknown' },
  });

  await runtime.submit('x');

  assert.deepEqual(calls.closed, []);
  assert.deepEqual(plain(calls.busy.at(-1)), ['x', false, '確認後に再試行', { locked: true }]);
  assert.match(calls.toasts[0], /投稿結果を確認できませんでした/);
});

test('submits a Bluesky reply with root and parent references', async () => {
  const { runtime, calls } = createHarness({
    snapshots: {
      b: {
        text: '返信です',
        crossPost: true,
        media: { images: [], video: null },
      },
    },
    replyTarget: { uri: 'at://p', cid: 'c1', rootUri: 'at://r', rootCid: 'c0' },
  });

  await runtime.submit('b');

  assert.equal(calls.cross.length, 0, 'a reply must not cross-post');
  assert.equal(calls.requests[0].accountId, 'did:plc:me');
  assert.deepEqual(plain(calls.requests[0].replyTo), {
    root: { uri: 'at://r', cid: 'c0' },
    parent: { uri: 'at://p', cid: 'c1' },
  });
  assert.deepEqual(calls.closed, ['b']);
});

test('routes Bluesky cross-posting through one shared plan', async () => {
  const { runtime, calls } = createHarness({
    snapshots: {
      b: {
        text: '同時投稿',
        crossPost: true,
        crossPostXAccount: { username: 'stl' },
        media: { images: [], video: null },
      },
    },
  });

  await runtime.submit('b');

  assert.equal(calls.crossPlans[0].xAccountId, 'stl');
  assert.equal(calls.crossPlans[0].blueskyAccountId, 'did:plc:me');
  assert.deepEqual(plain(calls.cross[0].targets.map(target => target.id)), ['x', 'b']);
  assert.deepEqual(calls.closed, ['b']);
  assert.deepEqual(calls.toasts, ['XとBlueskyへ投稿しました']);
});

test('blocks cross-posting when the shared video validation fails', async () => {
  const { runtime, calls } = createHarness({
    snapshots: {
      b: {
        text: '同時投稿',
        crossPost: true,
        crossPostXAccount: { username: 'stl' },
        media: { images: [], video: { file: 'clip' } },
      },
    },
    validateVideo: () => ({ valid: false, reason: 'missing-path' }),
  });

  await runtime.submit('b');

  assert.equal(calls.cross.length, 0);
  assert.match(calls.toasts[0], /パスを取得できないため同時投稿できません/);
});

test('locks the owner modal and names failed networks after a cross-post failure', async () => {
  const { runtime, calls } = createHarness({
    snapshots: {
      x: {
        text: '同時投稿',
        crossPost: true,
        selectedAccount: { username: 'stl' },
        media: { images: [], video: null },
      },
    },
    crossResult: {
      status: 'failed',
      results: [
        { id: 'x', status: 'failed', error: { message: 'boom' } },
        { id: 'b', status: 'succeeded' },
      ],
    },
  });

  await runtime.submit('x');

  assert.deepEqual(calls.closed, []);
  assert.deepEqual(plain(calls.busy.at(-1)), ['x', false, '失敗分を再試行', { locked: true }]);
  assert.equal(calls.toasts[0], 'Xへの投稿に失敗しました: boom');
});

test('asks before retrying a cross-post with an unknown previous outcome', async () => {
  const { runtime, calls } = createHarness({
    snapshots: {
      x: {
        text: '再試行',
        crossPost: true,
        selectedAccount: { username: 'stl' },
        media: { images: [], video: null },
      },
    },
    status: { x: { hasUnknownCross: true, crossPost: { targets: [{ id: 'x', status: 'unknown' }] } } },
    confirmAnswer: false,
  });

  await runtime.submit('x');

  assert.equal(calls.confirms.length, 1);
  assert.equal(calls.cross.length, 0);
  assert.deepEqual(plain(calls.busy), []);
});

test('Bluesky failure leaves the draft open and releases the sending state', async () => {
  const { runtime, calls } = createHarness({
    snapshots: { b: { text: '投稿テスト', crossPost: false, media: { images: [], video: null } } },
    singleResult: { status: 'failed', error: new Error('Upload failed') },
  });
  await runtime.submit('b');
  assert.deepEqual(calls.closed, []);
  assert.deepEqual(plain(calls.busy.at(-1)), ['b', false, '再試行', { locked: false }]);
  assert.match(calls.toasts.at(-1), /Upload failed/);
});

test('X failure unlocks the draft so the text can be edited', async () => {
  const { runtime, calls } = createHarness({
    snapshots: {
      x: { text: 'hello', crossPost: false, selectedAccount: { username: 'stl' }, media: { images: [], video: null } },
    },
    singleResult: { status: 'failed', error: new Error('boom') },
  });

  await runtime.submit('x');

  assert.deepEqual(plain(calls.busy.at(-1)), ['x', false, '再試行', { locked: false }]);
});

test('Bluesky sends under one post key and keeps it for a retry after an unknown outcome', async () => {
  const snapshots = { b: { text: '投稿テスト', crossPost: false, media: { images: [], video: null } } };
  const { runtime, calls } = createHarness({
    snapshots,
    singleResult: { status: 'unknown' },
  });

  await runtime.submit('b');
  await calls.single[0].deliver();
  assert.deepEqual(plain(calls.busy[0]), ['b', true, '送信中…', { deliveryKey: 'post-key-1' }]);
  assert.equal(calls.bDeliveries[0].rkey, 'post-key-1');
  assert.deepEqual(plain(calls.busy.at(-1)), ['b', false, '再試行', { locked: true }]);
  assert.match(calls.toasts.at(-1), /重複/);

  await runtime.submit('b');
  await calls.single[1].deliver();
  assert.equal(calls.bDeliveries[1].rkey, 'post-key-1');
  assert.deepEqual(calls.confirms, []);
});

test('retries an unknown Bluesky cross-post target without asking when X is settled', async () => {
  const snapshots = {
    x: { text: '同時投稿', crossPost: true, selectedAccount: { username: 'stl' }, media: { images: [], video: null } },
  };
  const { runtime, calls } = createHarness({
    snapshots,
    status: { x: { hasUnknownCross: true, crossPost: { targets: [
      { id: 'x', status: 'succeeded' }, { id: 'b', status: 'unknown' },
    ] } } },
  });

  await runtime.submit('x');
  await calls.cross[0].targets[1].deliver();

  assert.deepEqual(calls.confirms, []);
  assert.equal(calls.cross[0].options.retryUnknown, true);
  assert.equal(calls.bDeliveries[0].rkey, 'post-key-1');
});
