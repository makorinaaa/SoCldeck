const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function load() {
  const context = { window: {}, URL };
  vm.runInNewContext(fs.readFileSync('src/renderer/notification-reply-runtime.js', 'utf8'), context);
  return context.window.SocialDeckNotificationReply;
}

test('reply intents target only a supported X notification post', () => {
  const { replyUrl } = load();
  const item = { networkId: 'x', reason: 'reply', targetUrl: 'https://x.com/alice/status/123?ref=notification' };
  assert.equal(replyUrl(item), 'https://x.com/intent/tweet?in_reply_to=123');
  assert.equal(replyUrl({ ...item, targetUrl: 'https://example.com/alice/status/123' }), null);
  assert.equal(replyUrl({ ...item, reason: 'like' }), null);
  assert.equal(replyUrl({ ...item, targetUrl: 'https://x.com/notifications' }), null);
});
