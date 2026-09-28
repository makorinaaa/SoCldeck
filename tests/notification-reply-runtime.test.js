const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function load() {
  const context = { window: {}, URL };
  vm.runInNewContext(fs.readFileSync('src/renderer/notification-reply-runtime.js', 'utf8'), context);
  return context.window.SocialDeckNotificationReply;
}

test('notification pages resolve likes, follows, and Bluesky post owners', () => {
  const { notificationUrl } = load();
  assert.equal(notificationUrl({ networkId: 'x', reason: 'like', targetUrl: 'https://x.com/me/status/123' }), 'https://x.com/me/status/123');
  assert.equal(notificationUrl({ networkId: 'x', reason: 'like', targetUrl: 'https://x.com/alice' }), 'https://x.com/notifications');
  assert.equal(notificationUrl({ networkId: 'x', reason: 'follow', author: { handle: 'alice' } }), 'https://x.com/alice');
  assert.equal(notificationUrl({ networkId: 'b', reason: 'like', targetUri: 'at://did:plc:owner/app.bsky.feed.post/abc', author: { did: 'did:plc:liker' } }), 'https://bsky.app/profile/did%3Aplc%3Aowner/post/abc');
});

test('reply view opens the conversation post without tracking or media suffixes', () => {
  const { replyUrl } = load();
  const item = { networkId: 'x', reason: 'reply', targetUrl: 'https://x.com/alice/status/123?ref=notification' };
  assert.equal(replyUrl(item), 'https://x.com/alice/status/123');
  assert.equal(replyUrl({ ...item, reason: 'mention', targetUrl: 'https://twitter.com/alice/status/123/photo/1' }), 'https://x.com/alice/status/123');
  assert.equal(replyUrl({ ...item, reason: 'quote', targetUrl: 'https://x.com/alice/status/123#replies' }), 'https://x.com/alice/status/123');
  assert.equal(replyUrl({ ...item, targetUrl: 'https://example.com/alice/status/123' }), null);
  assert.equal(replyUrl({ ...item, reason: 'like' }), null);
  assert.equal(replyUrl({ ...item, targetUrl: 'https://x.com/notifications' }), null);
});
