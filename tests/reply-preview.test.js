const assert = require('node:assert/strict');
const test = require('node:test');

const load = () => import('../src/renderer/reply-preview.mjs');

function postElement({ name = 'Alice', handle = '@alice.test', text = 'hello', images = [], video = false } = {}) {
  const nodes = {
    '.p-name': { textContent: name },
    '.p-handle': { textContent: handle },
    '.p-body': { textContent: text },
    '.p-video': video ? {} : null,
  };
  return {
    querySelector: selector => nodes[selector] ?? null,
    querySelectorAll: selector => (selector === '.p-imgs img' ? images.map(src => ({ src })) : []),
  };
}

test('reads the author, text and image thumbnails of the post being replied to', async () => {
  const { readReplyPreview } = await load();

  assert.deepEqual(readReplyPreview(postElement({
    text: '  元の投稿\n2行目  ',
    images: ['https://cdn.bsky.app/img/thumb/1.jpg', 'javascript:alert(1)', 'https://pbs.twimg.com/media/2.jpg'],
    video: true,
  })), {
    name: 'Alice',
    handle: 'alice.test',
    text: '元の投稿\n2行目',
    images: ['https://cdn.bsky.app/img/thumb/1.jpg', 'https://pbs.twimg.com/media/2.jpg'],
    hasVideo: true,
  });
});

test('keeps the saved preview small', async () => {
  const { readReplyPreview } = await load();
  const preview = readReplyPreview(postElement({
    text: 'あ'.repeat(600),
    images: Array.from({ length: 6 }, (_, index) => `https://cdn.bsky.app/${index}.jpg`),
  }));

  assert.equal([...preview.text].length, 500);
  assert.ok(preview.text.endsWith('…'));
  assert.equal(preview.images.length, 4);
  assert.equal(readReplyPreview(null), null);
});
