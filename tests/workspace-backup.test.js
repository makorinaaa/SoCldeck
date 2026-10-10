const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const state = { xs: [{ username: '@alice', partition: 'persist:x-0', token: 'secret-x' }],
    b: { did: 'did:plc:bob', handle: 'bob.test', accessJwt: 'secret-access', refreshJwt: 'secret-refresh' },
    appearance: { theme: 'dark', accent: '#4e9af0', density: 'standard' },
    composePreferences: { crossPostFromX: false, crossPostFromBluesky: true } };
  const column = { id: 'x-home', network: 'x', kind: 'wv', definitionId: 'x-home-new',
    title: 'Home', sub: 'X', url: 'https://x.com/home', partition: 'persist:x-0',
    interval: 60000, collapsed: false, width: '340px', accessJwt: 'secret-column' };
  const values = new Map([['socialdeck_cols', JSON.stringify([column])], ['socialdeck_v4', JSON.stringify(state)],
    ['col_fs_x-home', '15'], ['socialdeck_ng', '{"words":["mute"],"users":[]}'],
    ['socialdeck_draft_v1_x_alice', 'private draft']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const context = { window: {}, URL };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/workspace-backup.js'), 'utf8'), context);
  const api = context.window.SocialDeckWorkspaceBackup;
  const backup = api.createWorkspaceBackup({ storage, getState: () => state,
    resolveDefinition: item => item.definitionId === 'x-home-new' ? { id: 'x-home-new', network: 'x' } : null });
  return { state, values, storage, backup, api };
}

test('backup exports an allowlist and excludes credentials drafts and arbitrary fields', () => {
  const { backup } = harness();
  const text = backup.exportText();
  assert.doesNotMatch(text, /secret-|private draft|accessJwt|refreshJwt|partition/);
  const data = JSON.parse(text);
  assert.equal(data.columns[0].account, '@alice');
  assert.equal(data.columns[0].fontSize, 15);
  assert.deepEqual(data.mute.words, ['mute']);
});

test('backup remaps accounts and restores settings with a recovery copy', () => {
  const { backup, values, state, api } = harness();
  const data = JSON.parse(backup.exportText());
  data.appearance.theme = 'light';
  state.xs[0].partition = 'persist:x-7';
  const stored = JSON.parse(values.get('socialdeck_cols'));
  stored[0].partition = 'persist:x-7';
  values.set('socialdeck_cols', JSON.stringify(stored));
  backup.restore(JSON.stringify(data));
  assert.equal(JSON.parse(values.get('socialdeck_cols'))[0].partition, 'persist:x-7');
  assert.equal(JSON.parse(values.get('socialdeck_v4')).appearance.theme, 'light');
  assert.equal(JSON.parse(values.get(api.RECOVERY_KEY)).appearance.theme, 'dark');
  assert.equal(values.get('socialdeck_draft_v1_x_alice'), 'private draft');
});

test('invalid versions URLs duplicate IDs and missing accounts make no writes', () => {
  const { backup, values } = harness();
  const original = [...values];
  const data = JSON.parse(backup.exportText());
  const variants = [
    { ...data, version: 9 },
    { ...data, columns: [data.columns[0], data.columns[0]] },
    { ...data, columns: [{ ...data.columns[0], url: 'https://evil.test/' }] },
    { ...data, columns: [{ ...data.columns[0], account: '@missing' }] },
    { ...data, columns: [{ ...data.columns[0], interval: 1 }] },
  ];
  for (const invalid of variants) assert.throws(() => backup.restore(JSON.stringify(invalid)));
  assert.deepEqual([...values], original);
});

test('failed storage write rolls back affected keys and preserves a recovery copy', () => {
  const { backup, values, storage, api } = harness();
  const text = backup.exportText();
  const oldState = values.get('socialdeck_v4');
  const oldLayout = values.get('socialdeck_cols');
  const write = storage.setItem;
  let failed = false;
  storage.setItem = (key, value) => {
    if (key === 'socialdeck_cols' && !failed) { failed = true; throw new Error('Disk full'); }
    write(key, value);
  };
  assert.throws(() => backup.restore(text), /Disk full/);
  assert.equal(values.get('socialdeck_v4'), oldState);
  assert.equal(values.get('socialdeck_cols'), oldLayout);
  assert.ok(values.get(api.RECOVERY_KEY));
});

test('empty workspace survives backup validation', () => {
  const { backup, values } = harness();
  const data = JSON.parse(backup.exportText());
  data.columns = [];
  backup.restore(JSON.stringify(data));
  assert.equal(values.get('socialdeck_cols'), '[]');
});

test('an account saved without a partition uses the one for its position', () => {
  const { backup, values, state } = harness();
  state.xs.unshift({ username: '@first', partition: 'persist:x-0' });
  state.xs[1] = { username: '@alice' };
  const stored = JSON.parse(values.get('socialdeck_cols'));
  stored[0].partition = 'persist:x-1';
  values.set('socialdeck_cols', JSON.stringify(stored));
  const data = JSON.parse(backup.exportText());
  assert.equal(data.columns[0].account, '@alice');
  backup.restore(JSON.stringify(data));
  assert.equal(JSON.parse(values.get('socialdeck_cols'))[0].partition, 'persist:x-1');
});

function nativeHarness() {
  const setup = harness();
  const columns = [
    { id: 'x0-home-native', network: 'x', kind: 'x-native', definitionId: 'x-home-native',
      title: 'Home（ネイティブ）', sub: 'X · @alice', icCls: 'ic-x', partition: 'persist:x-0', interval: 60000, collapsed: false, width: '' },
    { id: 'x0-list-native-123', network: 'x', kind: 'x-native', definitionId: 'x-list-native',
      title: 'Friends', sub: 'X - @alice', icCls: 'ic-x', partition: 'persist:x-0', url: 'https://x.com/i/lists/123',
      interval: 60000, collapsed: false, width: '' },
    { id: 'x0-notif-native', network: 'x', kind: 'x-native', definitionId: 'x-notif-native',
      title: '通知', sub: 'X · @alice', icCls: 'ic-n', partition: 'persist:x-0', interval: 60000, collapsed: false, width: '' },
  ];
  setup.values.set('socialdeck_cols', JSON.stringify(columns));
  const context = { window: {}, URL };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/workspace-backup.js'), 'utf8'), context);
  const definitions = ['x-home-native', 'x-list-native', 'x-notif-native'];
  setup.backup = context.window.SocialDeckWorkspaceBackup.createWorkspaceBackup({
    storage: setup.storage, getState: () => setup.state,
    resolveDefinition: item => (definitions.includes(item.definitionId) ? { id: item.definitionId, network: 'x' } : null),
  });
  return setup;
}

test('native X Columns (Home, list and notifications) are exported and restored with their account and list', () => {
  const { backup, values, state } = nativeHarness();
  const data = JSON.parse(backup.exportText());
  assert.deepEqual(data.columns.map(column => [column.kind, column.definitionId, column.account]), [
    ['x-native', 'x-home-native', '@alice'],
    ['x-native', 'x-list-native', '@alice'],
    ['x-native', 'x-notif-native', '@alice'],
  ]);
  assert.equal(data.columns[1].url, 'https://x.com/i/lists/123');
  assert.equal('url' in data.columns[0], false);
  assert.doesNotMatch(JSON.stringify(data), /partition/);

  // Restored on a machine where the account sits in another slot.
  state.xs[0].partition = 'persist:x-4';
  values.set('socialdeck_cols', JSON.stringify(JSON.parse(values.get('socialdeck_cols'))
    .map(column => ({ ...column, partition: 'persist:x-4' }))));
  backup.restore(JSON.stringify(data));
  const restored = JSON.parse(values.get('socialdeck_cols'));
  assert.deepEqual(restored.map(column => [column.kind, column.partition]), [
    ['x-native', 'persist:x-4'], ['x-native', 'persist:x-4'], ['x-native', 'persist:x-4'],
  ]);
  assert.equal(restored[1].url, 'https://x.com/i/lists/123');
});

test('a native X Column accepts only an X list URL', () => {
  const { backup, values } = nativeHarness();
  const original = [...values];
  const data = JSON.parse(backup.exportText());
  const list = data.columns[1];
  const variants = [
    { ...list, url: 'https://x.com/home' },
    { ...list, url: 'https://evil.test/i/lists/123' },
    { ...list, url: 'https://x.com/i/lists/123/members' },
    { ...list, url: 'https://x.com/i/lists/abc' },
    { ...list, network: 'b' },
  ];
  for (const invalid of variants) {
    assert.throws(() => backup.restore(JSON.stringify({ ...data, columns: [invalid] })), JSON.stringify(invalid));
  }
  assert.deepEqual([...values], original);
});
