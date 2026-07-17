const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createStore(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set('socialdeck_v4', JSON.stringify(initialValue));
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const context = { window: { localStorage: storage } };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'state-store.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return {
    stateStore: context.window.SocialDeckStateStore.createStateStore(storage),
    readSaved: () => JSON.parse(values.get('socialdeck_v4')),
  };
}

test('defaults cross-post preferences to disabled for existing users', () => {
  const { stateStore } = createStore({ xs: [], activeX: 0, b: null });

  assert.deepEqual(
    { ...stateStore.load().composePreferences },
    { crossPostFromX: false, crossPostFromBluesky: false },
  );
});

test('persists cross-post preferences across app restarts', () => {
  const { stateStore, readSaved } = createStore();
  const state = stateStore.load();
  state.composePreferences.crossPostFromX = true;
  state.composePreferences.crossPostFromBluesky = true;

  stateStore.save(state);

  assert.deepEqual(
    readSaved().composePreferences,
    { crossPostFromX: true, crossPostFromBluesky: true },
  );
});

test('never persists Bluesky credentials in Workspace State', () => {
  const { stateStore, readSaved } = createStore();
  const state = stateStore.load();
  state.b = {
    handle: 'alice.test',
    did: 'did:plc:alice',
    displayName: 'Alice',
    accessJwt: 'access-secret',
    refreshJwt: 'refresh-secret',
  };

  stateStore.save(state);

  assert.deepEqual(readSaved().b, {
    handle: 'alice.test',
    did: 'did:plc:alice',
    displayName: 'Alice',
  });
});
