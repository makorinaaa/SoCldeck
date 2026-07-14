const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'notification-center.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckNotificationCenter;
}

test('normalizes a Bluesky reaction to its subject post', () => {
  const center = loadModule();
  const notification = center.normalizeBskyNotification({
    reason: 'like',
    uri: 'at://did:actor/app.bsky.feed.like/1',
    reasonSubject: 'at://did:me/app.bsky.feed.post/2',
    isRead: false,
    indexedAt: '2026-07-14T00:00:00Z',
    author: { handle: 'actor.test' },
  });

  assert.equal(notification.targetUri, 'at://did:me/app.bsky.feed.post/2');
  assert.equal(notification.isRead, false);
  assert.equal(notification.networkId, 'b');
});

test('uses a reply record as its post target', () => {
  const center = loadModule();
  const notification = center.normalizeBskyNotification({
    reason: 'reply',
    uri: 'at://did:actor/app.bsky.feed.post/3',
  });

  assert.equal(notification.targetUri, 'at://did:actor/app.bsky.feed.post/3');
});

test('filters notifications by reason and unread state', () => {
  const center = loadModule();
  const notifications = [
    { reason: 'like', isRead: false },
    { reason: 'like', isRead: true },
    { reason: 'reply', isRead: false },
  ];

  assert.deepEqual(
    center.filterNotifications(notifications, { reason: 'like', unreadOnly: true }),
    [notifications[0]],
  );
});
