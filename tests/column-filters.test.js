const assert = require('node:assert/strict');
const test = require('node:test');

const load = () => import('../src/renderer/column-filters.mjs');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

const blueskyItem = ({ text = 'hello', repost = false, embed = null, quotedText = null } = {}) => ({
  post: {
    record: { text },
    embed: quotedText ? { $type: 'app.bsky.embed.record#view', record: { value: { text: quotedText } } } : embed,
  },
  ...(repost ? { reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: { handle: 'bob.test' } } } : {}),
});

test('reads text, reposts and media from Bluesky and native X posts in one shape', async () => {
  const { blueskyPostFacts, xPostFacts } = await load();

  assert.deepEqual(blueskyPostFacts(blueskyItem({ text: '本文', quotedText: '引用元' })),
    { text: '本文\n引用元', isRepost: false, hasMedia: false });
  assert.equal(blueskyPostFacts(blueskyItem({ repost: true })).isRepost, true);
  assert.equal(blueskyPostFacts(blueskyItem({ embed: { images: [{}] } })).hasMedia, true);
  assert.equal(blueskyPostFacts(blueskyItem({ embed: { playlist: 'https://video' } })).hasMedia, true);
  assert.equal(blueskyPostFacts(blueskyItem({ embed: { media: { images: [{}] } } })).hasMedia, true);
  assert.equal(blueskyPostFacts(blueskyItem({ embed: { external: { uri: 'https://a' } } })).hasMedia, false);

  assert.deepEqual(xPostFacts({
    segments: [{ text: 'X の' }, { text: '本文' }],
    quoted: { segments: [{ text: '引用' }] },
    repostedBy: { handle: 'carol' },
    media: [{ type: 'photo' }],
  }), { text: 'X の本文\n引用', isRepost: true, hasMedia: true });
});

test('keeps only media, hides reposts, and requires any of the words', async () => {
  const { matchesColumnFilter } = await load();
  const post = (overrides = {}) => ({ text: 'こんにちは', isRepost: false, hasMedia: false, ...overrides });

  assert.equal(matchesColumnFilter(null, post()), true);
  assert.equal(matchesColumnFilter({ mediaOnly: true }, post()), false);
  assert.equal(matchesColumnFilter({ mediaOnly: true }, post({ hasMedia: true })), true);
  assert.equal(matchesColumnFilter({ hideReposts: true }, post({ isRepost: true })), false);
  assert.equal(matchesColumnFilter({ keywords: ['アニメ', 'SocialDeck'] }, post({ text: 'socialdeck を更新' })), true);
  // Full-width and half-width letters match each other
  assert.equal(matchesColumnFilter({ keywords: ['ｓｏｃｉａｌ'] }, post({ text: 'Social' })), true);
  assert.equal(matchesColumnFilter({ keywords: ['アニメ'] }, post()), false);
  assert.equal(matchesColumnFilter({ mediaOnly: true, keywords: ['猫'] }, post({ text: '猫', hasMedia: false })), false);
});

test('normalizes, describes and saves filters per column', async () => {
  const { createColumnFilterStore, describeColumnFilter, normalizeColumnFilter } = await load();

  assert.deepEqual(normalizeColumnFilter({ mediaOnly: 1, keywords: [' 猫 ', '猫', '', 3, 'x'.repeat(101)] }),
    { mediaOnly: true, hideReposts: false, keywords: ['猫'] });
  assert.equal(describeColumnFilter({ mediaOnly: true, hideReposts: true, keywords: ['猫', '犬'] }),
    '画像・動画のみ · リポスト非表示 · 「猫」「犬」');
  assert.equal(describeColumnFilter(normalizeColumnFilter(null)), '');

  const storage = createStorage();
  const store = createColumnFilterStore({ storage });
  store.set('b-home', { hideReposts: true });
  store.set('x-list', { keywords: ['ニュース'] });
  store.set('b-search', {});
  assert.deepEqual(store.get('b-home'), { mediaOnly: false, hideReposts: true, keywords: [] });
  assert.equal(store.get('b-search'), null);
  assert.equal(store.get('missing'), null);

  store.prune(['b-home']);
  assert.deepEqual(Object.keys(JSON.parse(storage.values.get('socialdeck_column_filters'))), ['b-home']);
  store.remove('b-home');
  assert.equal(store.get('b-home'), null);
});

test('survives broken or unavailable storage', async () => {
  const { createColumnFilterStore } = await load();

  assert.equal(createColumnFilterStore({ storage: createStorage({ socialdeck_column_filters: '{broken' }) }).get('a'), null);
  const failing = createColumnFilterStore({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } } });
  assert.equal(failing.get('a'), null);
  assert.doesNotThrow(() => failing.set('a', { mediaOnly: true }));
});
