const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPreparationRuntime() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'x-compose-preparation.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckXComposePreparation;
}

test('clears stale X compose content before reporting ready', async () => {
  const observations = [
    { composerFound: true, textEmpty: false, mediaPresent: true },
    { composerFound: true, textEmpty: true, mediaPresent: false },
  ];
  const actions = [];
  let observationIndex = 0;

  const result = await loadPreparationRuntime().prepareXComposer({
    observe: () => observations[observationIndex++],
    clearText: () => actions.push('clear-text'),
    removeMedia: () => actions.push('remove-media'),
    schedule: callback => callback(),
    maxChecks: 2,
  });

  assert.deepEqual(actions, ['clear-text', 'remove-media']);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'ready',
  });
});

test('runs X composer preparation through the generated WebView script', async () => {
  const runtime = loadPreparationRuntime();
  const composer = {
    textContent: 'stale post',
    focus: () => {},
    dispatchEvent: () => {},
    removeAttribute: () => {},
  };
  let mediaPresent = true;
  const removeButton = { click: () => { mediaPresent = false; } };
  const documentLike = {
    querySelector: selector => {
      if (selector === '[data-testid="tweetTextarea_0"]') return composer;
      if (selector.includes('[data-testid="attachments"]')) {
        return mediaPresent ? {} : null;
      }
      return null;
    },
    querySelectorAll: selector => selector.includes('Remove media') && mediaPresent
      ? [removeButton]
      : [],
    createRange: () => ({ selectNodeContents: () => {} }),
    execCommand: command => {
      if (command === 'delete') composer.textContent = '';
    },
  };

  const result = await vm.runInNewContext(runtime.createPreparationScript({ maxChecks: 2 }), {
    document: documentLike,
    window: {
      getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {} }),
    },
    InputEvent: class InputEvent {},
    setTimeout: callback => callback(),
  });

  assert.equal(result.status, 'ready');
  assert.equal(composer.textContent, '');
  assert.equal(mediaPresent, false);
});

test('blocks delivery when stale X compose content cannot be cleared', async () => {
  let clearAttempts = 0;
  let removeAttempts = 0;
  const result = await loadPreparationRuntime().prepareXComposer({
    observe: () => ({
      composerFound: true,
      textEmpty: false,
      mediaPresent: true,
    }),
    clearText: () => { clearAttempts += 1; },
    removeMedia: () => { removeAttempts += 1; },
    schedule: callback => callback(),
    maxChecks: 2,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'blocked',
    reason: 'cleanup-timeout',
  });
  assert.equal(clearAttempts, 1);
  assert.equal(removeAttempts, 1);
});
