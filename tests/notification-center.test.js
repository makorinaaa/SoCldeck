const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { URL, window: {} };
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
    { reason: 'like', isRead: null },
  ];

  assert.deepEqual(
    center.filterNotifications(notifications, { reason: 'like', unreadOnly: true }),
    [notifications[0]],
  );
});

test('normalizes Japanese X notifications with their account context', () => {
  const center = loadModule();
  const notification = center.normalizeXNotification({
    text: 'Aliceさんがあなたのポストをいいねしました',
    targetUrl: 'https://x.com/me/status/123',
    profileUrl: 'https://x.com/alice',
    actorName: 'Alice',
    indexedAt: '2026-07-15T00:00:00Z',
  }, {
    accountIndex: 1,
    account: { username: '@me' },
  });

  assert.equal(notification.reason, 'like');
  assert.equal(notification.author.handle, 'alice');
  assert.equal(notification.accountIndex, 1);
  assert.equal(notification.targetUrl, 'https://x.com/me/status/123');
  assert.equal(notification.isRead, null);
});

test('builds a bounded X notification extraction script', () => {
  const center = loadModule();
  const script = center.buildXNotificationExtractionScript(500);

  assert.match(script, /cellInnerDiv/);
  assert.match(script, /, 100\)/);
});

test('extracts a visible X notification cell', () => {
  const center = loadModule();
  const profileLink = {
    href: 'https://x.com/alice',
    innerText: 'Alice\n@alice',
  };
  const statusLink = { href: 'https://x.com/me/status/123', innerText: '' };
  const cell = {
    innerText: 'Aliceさんがあなたのポストをいいねしました',
    querySelector: selector => {
      if (selector === '[data-testid="promotedIndicator"]') return null;
      if (selector === 'time') return { dateTime: '2026-07-15T00:00:00Z' };
      return null;
    },
    querySelectorAll: selector => {
      if (selector === 'a[href]') return [profileLink, statusLink];
      if (selector === 'img') return [{ src: 'https://pbs.twimg.com/profile_images/alice.jpg' }];
      if (selector === '[style*="background-image"]') return [];
      return [];
    },
  };
  const documentLike = {
    querySelectorAll: selector => selector === '[data-testid="cellInnerDiv"]' ? [cell] : [],
  };

  const items = center.extractXNotificationsFromDocument(
    documentLike,
    { origin: 'https://x.com' },
    40,
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].profileUrl, 'https://x.com/alice');
  assert.equal(items[0].targetUrl, 'https://x.com/me/status/123');
  assert.equal(items[0].actorName, 'Alice');
  assert.equal(items[0].indexedAt, '2026-07-15T00:00:00Z');
});

test('extracts an X avatar from srcset when src is unavailable', () => {
  const center = loadModule();
  const profileLink = { href: 'https://x.com/alice', innerText: 'Alice' };
  const avatar = {
    src: '',
    srcset: 'https://pbs.twimg.com/profile_images/alice_normal.jpg 1x, https://pbs.twimg.com/profile_images/alice_200x200.jpg 2x',
    getAttribute: name => name === 'srcset'
      ? 'https://pbs.twimg.com/profile_images/alice_normal.jpg 1x, https://pbs.twimg.com/profile_images/alice_200x200.jpg 2x'
      : '',
  };
  const cell = {
    innerText: 'Alice liked your post',
    querySelector: () => null,
    querySelectorAll: selector => {
      if (selector === 'a[href]') return [profileLink];
      if (selector === 'img') return [avatar];
      if (selector === '[style*="background-image"]') return [];
      return [];
    },
  };
  const documentLike = {
    querySelectorAll: selector => selector === '[data-testid="cellInnerDiv"]' ? [cell] : [],
  };

  const [item] = center.extractXNotificationsFromDocument(
    documentLike,
    { origin: 'https://x.com' },
  );

  assert.equal(item.avatar, 'https://pbs.twimg.com/profile_images/alice_200x200.jpg');
});

test('builds a Bluesky post page URL from a notification target', () => {
  const center = loadModule();
  const url = center.buildBskyNotificationUrl({
    reason: 'reply',
    targetUri: 'at://did:plc:alice/app.bsky.feed.post/3kabc',
    author: { handle: 'alice.test' },
  }, 'me.test');

  assert.equal(url, 'https://bsky.app/profile/alice.test/post/3kabc');
});

test('opens the current user post for a Bluesky reaction', () => {
  const center = loadModule();
  const url = center.buildBskyNotificationUrl({
    reason: 'like',
    targetUri: 'at://did:plc:me/app.bsky.feed.post/3kown',
    author: { handle: 'alice.test' },
  }, 'me.test');

  assert.equal(url, 'https://bsky.app/profile/me.test/post/3kown');
});
