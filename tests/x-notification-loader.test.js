const assert = require('node:assert/strict');
const test = require('node:test');

const account = { username: '@alice', partition: 'persist:x-0' };

async function harness({ badge = null, hasColumn = false } = {}) {
  const { createXNotificationLoader } = await import('../src/renderer/x-notification-loader.mjs');
  const fetches = [];
  let clock = 1000;
  let fetched = 0;
  const control = { badge, hasColumn, fetches };
  const loader = createXNotificationLoader({
    readBadge: async () => control.badge,
    hasNotificationColumn: () => control.hasColumn,
    fetchNotifications: async request => {
      fetches.push(request);
      fetched++;
      return [`item-${fetched}`];
    },
    maxAgeMs: 100,
    now: () => clock,
  });
  control.advance = ms => { clock += ms; };
  return { loader, control };
}

test('keeps the notification page when the badge cannot be read', async () => {
  const { loader, control } = await harness({ badge: null });
  assert.deepEqual(await loader.load(account, 0), ['item-1']);
  assert.deepEqual(await loader.load(account, 0), ['item-2']);
  assert.deepEqual(control.fetches, [
    { accountId: '@alice', retainReader: true },
    { accountId: '@alice', retainReader: true },
  ]);
});

test('reuses recent notifications while the badge shows nothing new', async () => {
  const { loader, control } = await harness({ badge: 2 });
  assert.deepEqual(await loader.load(account, 0), ['item-1']);
  assert.deepEqual(await loader.load(account, 0), ['item-1']);
  control.badge = 0;
  assert.deepEqual(await loader.load(account, 0), ['item-1']);
  assert.deepEqual(control.fetches, [{ accountId: '@alice', retainReader: false }]);
});

test('fetches again when the badge changes or the copy is old', async () => {
  const { loader, control } = await harness({ badge: 1 });
  await loader.load(account, 0);
  control.badge = 3;
  assert.deepEqual(await loader.load(account, 0), ['item-2']);
  control.advance(150);
  assert.deepEqual(await loader.load(account, 0), ['item-3']);
});

test('a native notification Column keeps the page open', async () => {
  const { loader, control } = await harness({ badge: 1, hasColumn: true });
  await loader.load(account, 0);
  assert.equal(control.fetches[0].retainReader, true);
});

test('shares a running load, while a forced load runs after it', async () => {
  const { loader, control } = await harness({ badge: 1 });
  const first = loader.load(account, 0);
  const shared = loader.load(account, 0);
  const forced = loader.load(account, 0, { force: true });
  assert.equal(first, shared);
  assert.deepEqual(await first, ['item-1']);
  assert.deepEqual(await forced, ['item-2']);
  assert.equal(control.fetches.length, 2);
});

test('uses the position-based partition and forgets cached accounts', async () => {
  const { loader, control } = await harness({ badge: 0 });
  const legacy = { username: '@legacy' };
  await loader.load(legacy, 3);
  await loader.load(legacy, 3);
  assert.equal(control.fetches.length, 1);
  loader.forget('persist:x-3');
  await loader.load(legacy, 3);
  assert.equal(control.fetches.length, 2);
  loader.forget();
  await loader.load(legacy, 3);
  assert.equal(control.fetches.length, 3);
});
