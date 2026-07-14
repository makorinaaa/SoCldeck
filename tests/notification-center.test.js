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

test('waits for delayed X notification avatars before completing extraction', async () => {
  const center = loadModule();
  let polls = 0;
  const profileLink = { href: 'https://x.com/alice', innerText: 'Alice' };
  const avatar = {
    get currentSrc() {
      return polls >= 3 ? 'https://pbs.twimg.com/profile_images/alice.jpg' : '';
    },
    src: '',
    srcset: '',
    getAttribute: () => '',
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
    querySelectorAll: selector => {
      if (selector !== '[data-testid="cellInnerDiv"]') return [];
      polls += 1;
      return [cell];
    },
  };
  const script = center.buildXNotificationExtractionScript(40);
  const items = await vm.runInNewContext(script, {
    Date,
    URL,
    document: documentLike,
    location: { origin: 'https://x.com' },
    setTimeout: callback => setTimeout(callback, 0),
  });

  assert.equal(items[0].avatar, 'https://pbs.twimg.com/profile_images/alice.jpg');
  assert.ok(polls >= 3);
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
  assert.equal(items[0].sourceIndex, 0);
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

test('builds an X notification activation script for a post without a direct link', () => {
  const center = loadModule();
  const script = center.buildXNotificationActivationScript({
    sourceIndex: 3,
    text: 'Alice liked your post',
    indexedAt: '2026-07-15T00:00:00Z',
  });

  assert.match(script, /cells\[3\]/);
  assert.match(script, /Alice liked your post/);
  assert.match(script, /tweetText/);
  assert.match(script, /target\.click\(\)/);
  assert.doesNotThrow(() => new Function(script));
});

test('finds an X notification column after it navigates to a post', () => {
  const center = loadModule();
  const webview = {
    partition: 'persist:x-1',
    src: 'https://x.com/alice/status/123',
  };
  const column = {
    dataset: { definitionId: 'x-notif-new' },
    querySelector: selector => selector === 'webview' ? webview : null,
  };

  assert.equal(center.findXNotificationColumn([column], 'persist:x-1'), column);
  assert.equal(center.findXNotificationColumn([column], 'persist:x-2'), null);
});

test('finds a legacy X notification column from its current URL', () => {
  const center = loadModule();
  const column = {
    dataset: {},
    querySelector: () => ({
      partition: 'persist:x-0',
      src: 'https://x.com/notifications',
    }),
  };

  assert.equal(center.findXNotificationColumn([column], 'persist:x-0'), column);
});

test('finds a reusable Bluesky profile column after its URL changes', () => {
  const center = loadModule();
  const column = {
    dataset: { definitionId: 'b-profile' },
    querySelector: () => ({ src: 'https://bsky.app/profile/alice.test' }),
  };

  assert.equal(center.findBlueskyProfileColumn([column]), column);
});

test('finds a legacy Bluesky profile column from its URL', () => {
  const center = loadModule();
  const profileColumn = {
    dataset: {},
    querySelector: () => ({ src: 'https://bsky.app/profile/alice.test' }),
  };
  const postColumn = {
    dataset: {},
    querySelector: () => ({ src: 'https://bsky.app/profile/alice.test/post/123' }),
  };

  assert.equal(center.findBlueskyProfileColumn([postColumn, profileColumn]), profileColumn);
});
