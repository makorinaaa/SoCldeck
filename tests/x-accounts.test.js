const assert = require('node:assert/strict');
const test = require('node:test');

const load = () => import('../src/renderer/x-accounts.mjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('an account without a partition uses the one for its position', async () => {
  const { xPartitionOf } = await load();
  assert.equal(xPartitionOf({ partition: 'persist:x-4' }, 0), 'persist:x-4');
  assert.equal(xPartitionOf({ username: '@old' }, 2), 'persist:x-2');
  assert.equal(xPartitionOf(undefined, 1), 'persist:x-1');
});

test('notification accounts match by partition, or by name when there is none', async () => {
  const { isSameXAccount } = await load();
  assert.equal(isSameXAccount({ partition: 'persist:x-1', username: '@a' }, { partition: 'persist:x-1' }), true);
  assert.equal(isSameXAccount({ partition: 'persist:x-1' }, { partition: 'persist:x-2' }), false);
  assert.equal(isSameXAccount({ username: '@a' }, { username: '@a' }), true);
  assert.equal(isSameXAccount({ username: '@a' }, null), false);
});

test('finds accounts by partition and by the id a post was sent from', async () => {
  const { createXAccounts } = await load();
  const accounts = [{ username: '@legacy' }, { username: '@alice', partition: 'persist:x-5' }];
  const xAccounts = createXAccounts({ getAccounts: () => accounts });

  assert.equal(xAccounts.indexOfPartition('persist:x-0'), 0);
  assert.equal(xAccounts.indexOfPartition('persist:x-5'), 1);
  assert.equal(xAccounts.indexOfPartition('persist:x-9'), -1);
  assert.equal(xAccounts.byPartition('persist:x-5'), accounts[1]);
  assert.equal(xAccounts.byPartition('persist:x-9'), null);
  assert.equal(xAccounts.partitionForAccountId('@alice'), 'persist:x-5');
  assert.equal(xAccounts.partitionForAccountId('persist:x-0'), 'persist:x-0');
  assert.equal(xAccounts.partitionForAccountId('@nobody'), null);
});

test('learns the real handle only from posts by the signed-in user', async () => {
  const { createXAccounts } = await load();
  const accounts = [{ username: 'Alice', partition: 'persist:x-0' }];
  const learned = [];
  const xAccounts = createXAccounts({
    getAccounts: () => accounts,
    getAccountId: partition => Promise.resolve(partition === 'persist:x-0' ? 42 : null),
    onHandleLearned: account => learned.push(account.handle),
  });

  xAccounts.learnHandle('persist:x-0', { id: '42', handle: 'too_early' });
  assert.deepEqual(learned, []);

  xAccounts.refreshUserIds();
  await flush();
  xAccounts.learnHandlesFromPosts('persist:x-0', [
    { author: { id: '7', handle: 'someone' }, quoted: { author: { id: '42', handle: 'alice' } } },
    { author: { id: '42', handle: 'alice' } },
  ]);

  assert.equal(accounts[0].handle, 'alice');
  assert.equal(accounts[0].username, 'Alice');
  assert.deepEqual(learned, ['alice']);
});

test('ignores accounts whose user id cannot be read', async () => {
  const { createXAccounts } = await load();
  const accounts = [{ username: 'Alice', partition: 'persist:x-0' }];
  const xAccounts = createXAccounts({
    getAccounts: () => accounts,
    getAccountId: () => Promise.reject(new Error('unavailable')),
  });

  xAccounts.refreshUserIds();
  await flush();
  xAccounts.learnHandle('persist:x-0', { id: '42', handle: 'alice' });
  assert.equal(accounts[0].handle, undefined);
});
