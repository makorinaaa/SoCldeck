const assert = require('node:assert/strict');
const test = require('node:test');

const load = () => import('../src/renderer/x-account-pause.mjs');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('pauses an account until the user resumes it, also across restart', async () => {
  const { createXAccountPause } = await load();
  const storage = createStorage();
  const pause = createXAccountPause({ storage, now: () => 1_000 });

  assert.equal(pause.isPaused('persist:x-0'), false);
  assert.equal(pause.pause('persist:x-0', 'locked'), true);
  assert.equal(pause.pause('persist:x-0', 'rate-limit'), false, 'already paused');
  assert.equal(pause.isPaused('persist:x-0'), true);
  assert.equal(pause.reasonOf('persist:x-0'), 'locked');

  const restarted = createXAccountPause({ storage });
  assert.equal(restarted.isPaused('persist:x-0'), true);
  assert.deepEqual(restarted.list(), [{ partition: 'persist:x-0', reason: 'locked', at: 1_000, operation: null, until: null }]);

  restarted.resume('persist:x-0');
  assert.equal(createXAccountPause({ storage }).isPaused('persist:x-0'), false);
});

test('ignores unknown reasons and broken saved data', async () => {
  const { createXAccountPause, describeXPauseReason } = await load();

  const pause = createXAccountPause({ storage: createStorage({ socialdeck_x_paused: '{broken' }) });
  assert.equal(pause.isPaused('persist:x-0'), false);
  assert.equal(pause.pause('persist:x-0', 'nonsense'), false);
  assert.equal(pause.pause('', 'locked'), false);

  assert.match(describeXPauseReason('locked'), /ロック・本人確認/);
  assert.match(describeXPauseReason('rate-limit'), /回数制限/);
  assert.match(describeXPauseReason('post-limit'), /投稿の上限・制限/);
});

test('a rate limit pauses for 15 minutes and lifts by itself; a lock waits for the user', async () => {
  const { createXAccountPause, describeXPauseReason, RATE_LIMIT_PAUSE_MS } = await load();
  let clock = 0;
  const storage = createStorage();
  const pause = createXAccountPause({ storage, now: () => clock });

  assert.equal(RATE_LIMIT_PAUSE_MS, 15 * 60 * 1000);
  assert.equal(pause.pause('persist:x-0', 'rate-limit', { operation: 'HomeTimeline' }), true);
  assert.equal(pause.isPaused('persist:x-0'), true);
  assert.equal(pause.isStopped('persist:x-0'), false, 'a rate limit only pauses');
  assert.equal(pause.untilOf('persist:x-0'), RATE_LIMIT_PAUSE_MS);
  assert.match(pause.describe('persist:x-0'), /HomeTimeline/);
  assert.match(describeXPauseReason('rate-limit', { operation: 'HomeTimeline' }), /HomeTimeline で回数制限/);

  // A lock found while paused becomes a stop
  assert.equal(pause.pause('persist:x-0', 'locked'), true);
  assert.equal(pause.isStopped('persist:x-0'), true);
  clock = RATE_LIMIT_PAUSE_MS + 1;
  assert.equal(pause.isPaused('persist:x-0'), true, 'a lock does not lift by itself');

  pause.pause('persist:x-1', 'rate-limit', { operation: 'TweetDetail' });
  clock += RATE_LIMIT_PAUSE_MS;
  assert.equal(pause.isPaused('persist:x-1'), false);
  assert.deepEqual(createXAccountPause({ storage, now: () => clock }).list().map(entry => entry.partition), ['persist:x-0']);
});

test('a rate limit saved by v2.6.1 without an end lifts 15 minutes after it began', async () => {
  const { createXAccountPause, RATE_LIMIT_PAUSE_MS } = await load();
  const storage = createStorage({ socialdeck_x_paused: JSON.stringify({
    'persist:x-0': { reason: 'rate-limit', at: 1_000 },
    'persist:x-1': { reason: 'locked', at: 1_000 },
  }) });

  const pause = createXAccountPause({ storage, now: () => 1_000 + RATE_LIMIT_PAUSE_MS });
  assert.equal(pause.isPaused('persist:x-0'), false);
  assert.equal(pause.isStopped('persist:x-1'), true);
});
