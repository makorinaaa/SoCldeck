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
test('new likes and replies both count as unread without opening the notification center', () => {
  const { runtime, events } = setup();
  runtime.observe([], account, 0);
  runtime.observe([reply(1), { ...reply(1), reason: 'like' }], account, 0);
  assert.equal(runtime.unreadItems().length, 2);
  assert.equal(events.filter(Array.isArray).at(-1).length, 2);
  runtime.markRead({ ...reply(1), reason: 'like' });
  assert.equal(runtime.unreadItems().length, 1);
  assert.equal(runtime.unreadItems()[0].reason, 'reply');
});

test('existing reply-only storage keeps unread replies and baselines historical likes once', () => {
  const saved = { socialdeck_x_reply_notifications_v1: JSON.stringify({
    [account.partition]: { seen: ['https://x.com/alice/status/1|alice'], unread: [reply(1)] },
  }) };
  const { runtime, events } = setup(saved);
  const historicalLike = { ...reply(2), reason: 'like' };
  runtime.observe([reply(1), historicalLike], account, 0);
  assert.equal(runtime.unreadItems().length, 1);
  assert.equal(events.filter(Array.isArray).length, 0);
  const restored = setup(saved).runtime;
  restored.observe([historicalLike, { ...reply(3), reason: 'like' }], account, 0);
  assert.equal(restored.unreadItems().length, 2);
});
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

test('manual read and read all persist without opening posts or notifying again', () => {
  let opens = 0;
  const { runtime, saved } = setup({}, async () => { opens++; });
  runtime.observe([], account, 0);
  runtime.observe([reply(1), reply(2)], account, 0);
  runtime.markRead(reply(1));
  assert.equal(runtime.unreadItems().length, 1);
  let restored = setup(saved).runtime;
  assert.equal(restored.isRead(reply(1)), true);
  restored.markAllRead();
  restored = setup(saved).runtime;
  restored.observe([reply(1), reply(2)], account, 0);
  assert.equal(restored.unreadItems().length, 0);
  assert.equal(opens, 0);
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

test('unchanged polling and badge rendering do not rewrite stored unread state', () => {
  let writes = 0;
  const saved = new Proxy({}, { set(target, key, value) { writes++; target[key] = value; return true; } });
  const { runtime } = setup(saved);
  runtime.observe([], account, 0);
  runtime.observe([reply(1)], account, 0);
  const initialWrites = writes;
  for (let index = 0; index < 10; index++) {
    runtime.syncAccounts([account]);
    runtime.observe([reply(1)], account, 0);
    runtime.render();
  }
  assert.equal(writes, initialWrites);
  runtime.markRead(reply(1));
  assert.equal(writes, initialWrites + 1);
});
