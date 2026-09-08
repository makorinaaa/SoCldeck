const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
function setup(saved = {}, openItem = async () => true) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('src/renderer/reply-notification-runtime.js', 'utf8'), context);
  const events = [];
  const runtime = context.window.SocialDeckReplyNotifications.createReplyNotificationRuntime({
    storage: { getItem: key => saved[key], setItem: (key, value) => { saved[key] = value; } },
    view: { notify: items => events.push(items), badge: count => events.push(count) }, openItem,
  });
  return { runtime, events, saved };
}
const account = { partition: 'persist:x-0', username: '@me' };
const reply = id => ({ reason: 'reply', targetUrl: `https://x.com/alice/status/${id}`, author: { handle: 'alice' }, account });
test('baselines per account, deduplicates replies and retains unread across restart', () => {
  const { runtime, events, saved } = setup();
  runtime.observe([reply(1)], account, 0);
  assert.equal(runtime.unreadItems().length, 0);
  runtime.observe([reply(2), reply(2), reply(1)], account, 0);
  assert.equal(runtime.unreadItems().length, 1);
  runtime.observe([reply(2)], account, 0);
  assert.equal(events.filter(Array.isArray).length, 1);
  const restored = setup(saved).runtime;
  assert.equal(restored.unreadItems().length, 1);
  restored.observe([reply(3)], { partition: 'persist:x-1' }, 1);
  assert.equal(restored.unreadItems().length, 1);
  restored.syncAccounts([]);
  assert.equal(restored.unreadItems().length, 0);
});
test('only successful activation marks a reply read', async () => {
  let success = false;
  const { runtime } = setup({}, async () => success);
  runtime.observe([], account, 0);
  runtime.observe([reply(2)], account, 0);
  await runtime.activate(reply(2));
  assert.equal(runtime.isRead(reply(2)), false);
  success = true;
  await runtime.activate(reply(2));
  assert.equal(runtime.isRead(reply(2)), true);
  runtime.observe([reply(2)], account, 0);
  assert.equal(runtime.unreadItems().length, 0);
});
test('additional replies do not restart dismissal while toast is hovered', () => {
  const elements = {};
  for (const id of ['reply-toast', 'reply-toast-content', 'reply-toast-close', 'reply-toast-title', 'reply-toast-body']) {
    elements[id] = { handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; } };
  }
  const timers = new Map();
  let next = 0;
  const context = { window: {}, setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(fs.readFileSync('src/renderer/reply-notification-runtime.js', 'utf8'), context);
  const view = context.window.SocialDeckReplyNotifications.createReplyNotificationDomView({
    documentRef: { getElementById: id => elements[id] },
  });
  view.notify([reply(1)]);
  assert.equal(timers.size, 1);
  elements['reply-toast'].handlers.mouseenter();
  view.notify([reply(2)]);
  assert.equal(timers.size, 0);
  elements['reply-toast'].handlers.mouseleave();
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(elements['reply-toast'].hidden, true);
});
