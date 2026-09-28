const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const values = new Map();
  const notices = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/workspace-storage.js'), 'utf8'), context);
  return { values, notices, storage: context.window.SocialDeckWorkspaceStorage.createWorkspaceStorage({ storage, onRecovery: message => notices.push(message) }) };
}

test('corrupted layout is retained and restored from the previous valid save', () => {
  const { storage, values, notices } = harness();
  const previous = '[{"id":"first"}]';
  storage.setItem('socialdeck_cols', previous);
  storage.setItem('socialdeck_cols', '[{"id":"second"}]');
  values.set('socialdeck_cols', '{broken');
  assert.equal(storage.getItem('socialdeck_cols'), previous);
  assert.equal(values.get('socialdeck_cols.corrupt'), '{broken');
  assert.equal(values.get('socialdeck_cols'), previous);
  assert.equal(notices.length, 1);
  storage.getItem('socialdeck_cols');
  assert.equal(notices.length, 1);
});

test('recovery snapshots do not retain migrated Bluesky credentials', () => {
  const { storage, values } = harness();
  storage.setItem('socialdeck_v4', JSON.stringify({ xs: [], b: { did: 'bob', accessJwt: 'secret', refreshJwt: 'secret' } }));
  assert.doesNotMatch(values.get('socialdeck_v4.last-good'), /secret|Jwt/);
});

test('missing and explicitly empty layouts are not replaced by old backups', () => {
  const { storage, values } = harness();
  storage.setItem('socialdeck_cols', '[{"id":"first"}]');
  storage.setItem('socialdeck_cols', '[]');
  assert.equal(storage.getItem('socialdeck_cols'), '[]');
  values.delete('socialdeck_cols');
  assert.equal(storage.getItem('socialdeck_cols'), null);
});

test('unrecoverable data is preserved and reported; unrelated keys pass through', () => {
  const { storage, values, notices } = harness();
  values.set('socialdeck_v4', '{broken');
  assert.equal(storage.getItem('socialdeck_v4'), '{broken');
  assert.equal(values.get('socialdeck_v4.corrupt'), '{broken');
  assert.equal(notices.length, 1);
  storage.setItem('col_fs_example', '14');
  assert.equal(storage.getItem('col_fs_example'), '14');
  assert.throws(() => storage.setItem('socialdeck_cols', '{}'));
});
