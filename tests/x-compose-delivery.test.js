const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadFactory() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'x-compose-delivery.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckXComposeDelivery.createXComposeDelivery;
}

test('executes an X image delivery through one WebView adapter', async () => {
  const createDelivery = loadFactory();
  const scripts = [];
  const webview = {
    async executeJavaScript(script) {
      scripts.push(script);
      if (scripts.length === 1) return { status: 'ready' };
      if (scripts.length === 3) return { status: 'succeeded' };
      return 'ok';
    },
  };
  const delivery = createDelivery({
    createPreparationScript: () => 'prepare-script',
    createConfirmationScript: input => `confirm:${JSON.stringify(input)}`,
    readFileAsDataUrl: async file => `data:${file.name}`,
  });

  const result = await delivery.execute({
    text: 'hello from SocialDeck',
    imageFiles: [{ name: 'photo.png', type: 'image/png' }],
    video: null,
  }, { webview });

  assert.deepEqual(result, { status: 'succeeded' });
  assert.equal(scripts[0], 'prepare-script');
  assert.match(scripts[1], /hello from SocialDeck/);
  assert.match(scripts[1], /photo\.png/);
  assert.match(scripts[2], /"hadText":true/);
  assert.match(scripts[2], /"hadMedia":true/);
});

test('owns X video trimming and temporary file cleanup', async () => {
  const createDelivery = loadFactory();
  const calls = [];
  let execution = 0;
  const webview = {
    async executeJavaScript() {
      execution += 1;
      if (execution === 1) return { status: 'ready' };
      if (execution === 3) return { status: 'succeeded' };
      return 'ok';
    },
  };
  const delivery = createDelivery({
    createPreparationScript: () => 'prepare',
    createConfirmationScript: () => 'confirm',
    readFileAsDataUrl: async () => 'untrimmed',
    trimVideo: async (...args) => {
      calls.push(['trim', ...args]);
      return 'trimmed.mp4';
    },
    readFileBase64: async filePath => {
      calls.push(['read', filePath]);
      return 'trimmed-data';
    },
    deleteTempFile: async filePath => calls.push(['delete', filePath]),
    setStatus: status => calls.push(['status', status]),
  });

  await delivery.execute({
    text: '',
    imageFiles: [],
    video: {
      file: { name: 'clip.mp4', type: 'video/mp4' },
      trim: { startSeconds: 2, endSeconds: 12 },
    },
  }, {
    webview,
    videoPath: 'clip.mp4',
    videoDuration: 20,
  });

  assert.deepEqual(calls, [
    ['status', 'トリミング中…'],
    ['trim', 'clip.mp4', 2, 12],
    ['status', '読み込み中…'],
    ['read', 'trimmed.mp4'],
    ['delete', 'trimmed.mp4'],
    ['status', ''],
  ]);
});

test('preserves sub-second trim edges for X delivery', async () => {
  const createDelivery = loadFactory();
  const trimCalls = [];
  let execution = 0;
  const delivery = createDelivery({
    createPreparationScript: () => 'prepare',
    createConfirmationScript: () => 'confirm',
    trimVideo: async (...args) => { trimCalls.push(args); return 'trimmed.mp4'; },
    readFileBase64: async () => 'trimmed-data',
    deleteTempFile: async () => {},
  });

  await delivery.execute({
    text: '',
    imageFiles: [],
    video: {
      file: { name: 'clip.mp4', type: 'video/mp4' },
      trim: { startSeconds: 0.1, endSeconds: 19.9 },
    },
  }, {
    webview: {
      async executeJavaScript() {
        execution += 1;
        if (execution === 1) return { status: 'ready' };
        if (execution === 3) return { status: 'succeeded' };
        return 'ok';
      },
    },
    videoPath: 'clip.mp4',
    videoDuration: 20,
  });

  assert.deepEqual(trimCalls, [['clip.mp4', 0.1, 19.9]]);
});

test('stops X delivery when the WebView composer is not ready', async () => {
  const createDelivery = loadFactory();
  const delivery = createDelivery({
    createPreparationScript: () => 'prepare',
    createConfirmationScript: () => 'confirm',
    readFileAsDataUrl: async () => '',
  });

  await assert.rejects(
    delivery.execute({ text: 'hello', imageFiles: [], video: null }, {
      webview: { executeJavaScript: async () => ({ status: 'blocked' }) },
    }),
    /Xの投稿欄を初期化できませんでした/,
  );
});
