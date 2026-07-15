const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createMuteRules(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set('socialdeck_ng', JSON.stringify(initialValue));
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const context = { window: { localStorage: storage } };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'mute-rules.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return {
    muteRules: context.window.SocialDeckMuteRules.createMuteRules(storage),
    readSaved: () => JSON.parse(values.get('socialdeck_ng')),
  };
}

test('normalizes missing and malformed persisted rules', () => {
  const { muteRules } = createMuteRules({ words: 'invalid', users: null });

  assert.deepEqual(
    JSON.parse(JSON.stringify(muteRules.getRules())),
    { words: [], users: [] },
  );
});

test('adds and removes normalized rules behind one persistence interface', () => {
  const { muteRules, readSaved } = createMuteRules();

  assert.deepEqual(
    { ...muteRules.add('user', ' @Alice.example ') },
    { changed: true, value: 'Alice.example' },
  );
  assert.deepEqual(
    { ...muteRules.add('user', '@Alice.example') },
    { changed: false, value: 'Alice.example' },
  );
  muteRules.add('word', 'spoiler');
  assert.deepEqual(readSaved(), { words: ['spoiler'], users: ['Alice.example'] });

  assert.equal(muteRules.remove('user', 0), true);
  assert.deepEqual(readSaved(), { words: ['spoiler'], users: [] });
});

test('matches text and authors across posts, reposts, and quoted posts', () => {
  const { muteRules } = createMuteRules({
    words: ['spoiler'],
    users: ['muted.example'],
  });

  assert.equal(muteRules.blocksPost({ record: { text: 'A SPOILER appears' } }), true);
  assert.equal(muteRules.blocksPost({
    post: { author: { handle: 'visible.example' }, record: { text: 'hello' } },
    reason: { by: { handle: 'muted.example' } },
  }), true);
  assert.equal(muteRules.blocksPost({
    record: { text: 'hello' },
    embed: {
      record: {
        author: { handle: 'visible.example' },
        value: { text: 'quoted Spoiler' },
      },
    },
  }), true);
  assert.equal(muteRules.blocksPost({ record: { text: 'safe' } }), false);
});

test('matches notification authors without leaking notification shape to callers', () => {
  const { muteRules } = createMuteRules({ words: [], users: ['muted.example'] });

  assert.equal(muteRules.blocksNotification({ author: { handle: 'MUTED.EXAMPLE' } }), true);
  assert.equal(muteRules.blocksNotification({ author: { handle: 'visible.example' } }), false);
});
