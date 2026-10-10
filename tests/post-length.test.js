const assert = require('node:assert/strict');
const test = require('node:test');

const load = () => import('../src/renderer/post-length.mjs');

test('X counts CJK characters as two and Latin characters as one', async () => {
  const { countXPostLength, measurePost } = await load();

  assert.equal(countXPostLength('hello'), 5);
  assert.equal(countXPostLength('あ'.repeat(140)), 280);
  assert.equal(measurePost('あ'.repeat(140), ['x']).valid, true);
  assert.equal(measurePost('あ'.repeat(141), ['x']).valid, false);
  assert.equal(measurePost('a'.repeat(280), ['x']).valid, true);
});

test('X counts every emoji, including joined sequences, as two', async () => {
  const { countXPostLength } = await load();

  assert.equal(countXPostLength('😀'), 2);
  assert.equal(countXPostLength('👨‍👩‍👧‍👦'), 2);
  assert.equal(countXPostLength('👍🏽'), 2);
  assert.equal(countXPostLength('🇯🇵'), 2);
  assert.equal(countXPostLength('1️⃣'), 2);
});

test('X counts each URL as 23 characters whatever its length', async () => {
  const { countXPostLength } = await load();
  const longUrl = `https://example.com/${'a'.repeat(200)}`;

  assert.equal(countXPostLength(longUrl), 23);
  assert.equal(countXPostLength(`見て ${longUrl}`), 4 + 1 + 23);
  assert.equal(countXPostLength('https://t.co/x.'), 24);
  assert.equal(countXPostLength('詳しくはexample.comへ'), 8 + 23 + 2);
  assert.equal(countXPostLength('ver.2'), 5);
});

test('Bluesky counts graphemes, so emoji count as one', async () => {
  const { countBlueskyPostLength, measurePost } = await load();

  assert.equal(countBlueskyPostLength('😀'.repeat(151)), 151);
  assert.equal(countBlueskyPostLength('👨‍👩‍👧‍👦'), 1);
  assert.equal(measurePost('😀'.repeat(151), ['b']).valid, true);
  assert.equal(measurePost('😀'.repeat(300), ['b']).valid, true);
  assert.equal(measurePost('😀'.repeat(301), ['b']).valid, false);
  assert.equal(measurePost(`https://example.com/${'a'.repeat(290)}`, ['b']).valid, false);
});

test('Bluesky also rejects text over its byte limit', async () => {
  const { measurePost } = await load();

  // 25 bytes per family emoji: 121 of them exceed 3000 bytes while staying under 300 graphemes
  assert.equal(measurePost('👨‍👩‍👧‍👦'.repeat(120), ['b']).valid, true);
  assert.equal(measurePost('👨‍👩‍👧‍👦'.repeat(121), ['b']).valid, false);
});

test('a cross-post must fit both networks and shows the tighter one', async () => {
  const { measurePost } = await load();

  const japanese = measurePost('あ'.repeat(141), ['b', 'x']);
  assert.equal(japanese.valid, false);
  assert.equal(japanese.count, 282);
  assert.equal(japanese.limit, 280);

  const longUrl = measurePost(`https://example.com/${'a'.repeat(290)}`, ['x', 'b']);
  assert.equal(longUrl.valid, false);
  assert.equal(longUrl.limit, 300);
});

test('measures the text that will be sent, without surrounding whitespace', async () => {
  const { measurePost } = await load();

  assert.deepEqual({ ...measurePost(`  ${'a'.repeat(280)}\n`, ['x']) }, { count: 280, limit: 280, valid: true });
  assert.equal(measurePost('   ', ['b']).count, 0);
});
