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
