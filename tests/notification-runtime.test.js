const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadFactory() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'notification-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckNotificationRuntime.createNotificationRuntime;
}

test('coalesces unread-count polls while the previous request is pending', async () => {
  let scheduledTick;
  let releaseFetch;
  let fetchCount = 0;
  const fetchGate = new Promise(resolve => { releaseFetch = resolve; });
  const runtime = loadFactory()({
    documentRef: { getElementById: () => null },
    setIntervalImpl: callback => {
      scheduledTick = callback;
      return 1;
    },
  });
  const fetchUnreadCount = async () => {
    fetchCount += 1;
    return fetchGate;
  };

  runtime.startPoll(fetchUnreadCount);
  await Promise.resolve();
  const second = scheduledTick();
  const third = scheduledTick();
  await Promise.resolve();
  const countWhilePending = fetchCount;
  releaseFetch(7);
  await Promise.all([second, third]);

  assert.equal(countWhilePending, 1);
  assert.equal(fetchCount, 1);
  assert.equal(runtime.getUnreadCount(), 7);
});
