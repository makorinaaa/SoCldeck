const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeNotificationWindowRequest,
} = require('../src/notification-window');

test('accepts an X notification URL with its account partition', () => {
  assert.deepEqual(normalizeNotificationWindowRequest({
    networkId: 'x',
    url: 'https://x.com/alice/status/123',
    partition: 'persist:x-2',
    title: 'X notification',
  }), {
    networkId: 'x',
    url: 'https://x.com/alice/status/123',
    partition: 'persist:x-2',
    title: 'X notification',
  });
});

test('accepts a public Bluesky notification URL without an X partition', () => {
  assert.deepEqual(normalizeNotificationWindowRequest({
    networkId: 'b',
    url: 'https://bsky.app/profile/alice.test/post/abc',
  }), {
    networkId: 'b',
    url: 'https://bsky.app/profile/alice.test/post/abc',
    partition: null,
    title: 'SocialDeck Notification',
  });
});

test('rejects unsafe notification targets and invalid partitions', () => {
  assert.equal(normalizeNotificationWindowRequest({
    networkId: 'x',
    url: 'https://example.com/steal',
    partition: 'persist:x-0',
  }), null);
  assert.equal(normalizeNotificationWindowRequest({
    networkId: 'x',
    url: 'https://x.com/alice/status/123',
    partition: 'persist:untrusted',
  }), null);
  assert.equal(normalizeNotificationWindowRequest({
    networkId: 'b',
    url: 'https://x.com/alice/status/123',
    partition: 'persist:x-0',
  }), null);
});
