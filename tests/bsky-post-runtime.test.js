const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRuntime() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'bsky-post-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckBskyPostRuntime;
}

function createButton() {
  const classes = new Set();
  const count = { textContent: '' };
  const svg = { fill: '', setAttribute: (name, value) => { if (name === 'fill') svg.fill = value; } };
  return {
    classes,
    count,
    svg,
    classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    querySelector: selector => selector === 'span' ? count : selector === 'svg' ? svg : null,
  };
}

test('updates counts and viewer state for an existing Bluesky post', () => {
  const reply = createButton();
  const repost = createButton();
  const like = createButton();
  const element = {
    dataset: { uri: 'at://did/app.bsky.feed.post/abc' },
    querySelector: selector => ({
      '.pa.rep span': reply.count,
      '.pa.rt span': repost.count,
      '.pa.lk span': like.count,
      '.pa.rep': reply,
      '.pa.rt': repost,
      '.pa.lk': like,
    })[selector] || null,
  };
  const feed = { querySelectorAll: () => [element] };

  const updated = loadRuntime().syncPostMetrics(feed, [{ post: {
    uri: element.dataset.uri,
    replyCount: 3,
    repostCount: 4,
    likeCount: 5,
    viewer: { like: 'at://like', repost: 'at://repost' },
  } }]);

  assert.equal(updated, 1);
  assert.equal(reply.count.textContent, '3');
  assert.equal(repost.count.textContent, '4');
  assert.equal(like.count.textContent, '5');
  assert.equal(like.classes.has('liked'), true);
  assert.equal(repost.classes.has('rted'), true);
  assert.equal(element.dataset.likeuri, 'at://like');
  assert.equal(element.dataset.reposturi, 'at://repost');
});
