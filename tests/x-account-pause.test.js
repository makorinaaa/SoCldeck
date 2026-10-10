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
  assert.deepEqual(restarted.list(), [{ partition: 'persist:x-0', reason: 'locked', at: 1_000 }]);

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
