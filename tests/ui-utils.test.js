const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadUiUtils(options) {
  const context = { window: {}, TextEncoder, TextDecoder };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'ui-utils.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckUiUtils.createUiUtils(options);
}

test('renders delegated Bluesky avatars without inline handlers', () => {
  const html = loadUiUtils().renderAvatar({
    did: 'did:plc:alice',
    handle: 'alice.test',
    displayName: 'Alice',
    avatar: 'https://cdn.test/alice.jpg',
  }, 34, { delegated: true });

  assert.match(html, /data-bsky-profile/);
  assert.match(html, /data-did="did:plc:alice"/);
  assert.match(html, />AL</);
  assert.doesNotMatch(html, /\son(?:mouseenter|mouseleave|error)=/);
});

test('renders delegated mentions without inline handlers', () => {
  const text = '@alice hello';
  const html = loadUiUtils().formatText(text, [{
    index: { byteStart: 0, byteEnd: 6 },
    features: [{
      $type: 'app.bsky.richtext.facet#mention',
      did: 'did:plc:alice',
    }],
  }], { delegated: true });

  assert.match(html, /data-bsky-profile/);
  assert.match(html, /data-did="did:plc:alice"/);
  assert.doesNotMatch(html, /\sonclick=/);
});

test('keeps relative times valid for clock skew and invalid timestamps', () => {
  const { relTime } = loadUiUtils({ now: () => Date.parse('2026-07-19T12:00:00.000Z') });
  assert.equal(relTime('2026-07-19T12:00:05.000Z'), '0s');
  assert.equal(relTime('not-a-date'), '');
});
