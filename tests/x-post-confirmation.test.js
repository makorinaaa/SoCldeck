const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadConfirmationRuntime() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'x-post-confirmation.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckXPostConfirmation;
}

test('reports an X error notice as failed delivery', async () => {
  const result = await loadConfirmationRuntime().confirmXPost({
    hadText: true,
    hadMedia: false,
    observe: () => ({
      noticeText: 'Something went wrong. Try reloading.',
      composerEmpty: false,
      mediaPresent: false,
    }),
    schedule: callback => callback(),
    maxChecks: 1,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'failed',
    message: 'Something went wrong. Try reloading.',
  });
});

test('reports delivery as succeeded after the composed content clears', async () => {
  const observations = [
    { noticeText: '', composerEmpty: false, mediaPresent: true },
    { noticeText: '', composerEmpty: true, mediaPresent: false },
  ];
  let observationIndex = 0;

  const result = await loadConfirmationRuntime().confirmXPost({
    hadText: true,
    hadMedia: true,
    observe: () => observations[observationIndex++],
    schedule: callback => callback(),
    maxChecks: 2,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'succeeded',
    reason: 'content-cleared',
  });
});

test('reports an unconfirmed delivery after the observation window expires', async () => {
  const result = await loadConfirmationRuntime().confirmXPost({
    hadText: true,
    hadMedia: false,
    observe: () => ({
      noticeText: '',
      composerEmpty: false,
      mediaPresent: false,
    }),
    schedule: callback => callback(),
    maxChecks: 2,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'unknown',
    reason: 'confirmation-timeout',
  });
});

test('runs post confirmation through the generated WebView script', async () => {
  const runtime = loadConfirmationRuntime();
  const documentLike = {
    querySelectorAll: () => [],
    querySelector: selector => {
      if (selector === '[data-testid="tweetTextarea_0"]') return { textContent: '' };
      return null;
    },
  };

  const result = await vm.runInNewContext(runtime.createConfirmationScript({
    hadText: true,
    hadMedia: false,
    maxChecks: 1,
  }), {
    document: documentLike,
    setTimeout: callback => callback(),
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.reason, 'content-cleared');
});

test('confirms a media post while timeline videos stay visible', async () => {
  const runtime = loadConfirmationRuntime();
  let attachmentsPresent = true;
  const composerBlock = {
    parentElement: null,
    querySelector: selector => {
      if (selector === '[data-testid="toolBar"]') return {};
      if (selector.includes('[data-testid="attachments"]')) {
        return attachmentsPresent ? {} : null;
      }
      return null;
    },
  };
  const composer = { textContent: '', parentElement: composerBlock };
  const documentLike = {
    querySelectorAll: () => [],
    querySelector: selector => {
      if (selector === '[data-testid="tweetTextarea_0"]') return composer;
      if (selector === '[data-sd-compose-submit="pending"]') return composer;
      if (selector.includes('[data-testid="videoPlayer"]')) return {};
      return null;
    },
  };

  const result = await vm.runInNewContext(runtime.createConfirmationScript({
    hadText: false,
    hadMedia: true,
    maxChecks: 2,
  }), {
    document: documentLike,
    setTimeout: callback => { attachmentsPresent = false; callback(); },
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.reason, 'content-cleared');
});

test('does not assume a media-only post succeeded when media was never observed', async () => {
  const result = await loadConfirmationRuntime().confirmXPost({
    hadText: false,
    hadMedia: true,
    observe: () => ({
      noticeText: '',
      composerEmpty: true,
      composerReplaced: false,
      mediaPresent: false,
    }),
    schedule: callback => callback(),
    maxChecks: 1,
  });

  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'confirmation-timeout');
});
