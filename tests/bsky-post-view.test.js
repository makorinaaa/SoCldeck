const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPostView() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'bsky-post-view.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckBlueskyPostView;
}

const POST = {
  uri: 'at://post/1',
  cid: 'cid-1',
  author: { did: 'did:plc:a', handle: 'alice.test', displayName: 'Alice <b>' },
  record: { text: 'hello', createdAt: '2026-07-20T00:00:00.000Z' },
  likeCount: 3,
  repostCount: 2,
  replyCount: 1,
  viewer: {},
};

test('renders a post with escaped metadata and a relative-time source', () => {
  const view = loadPostView().createBlueskyPostView({
    ui: { relTime: () => '5m', formatText: text => text },
    icons: { heart: '<svg id="heart"/>' },
  });

  const html = view.renderPost({ post: POST });

  assert.match(html, /data-uri="at:\/\/post\/1"/);
  assert.match(html, /Alice &lt;b&gt;/);
  assert.match(html, /class="p-time" data-created-at="2026-07-20T00:00:00\.000Z">5m</);
  assert.match(html, /class="pa lk " data-bsky-action="like"><svg id="heart"\/> <span>3<\/span>/);
});

test('renders timeline videos without preloading media data', () => {
  const view = loadPostView().createBlueskyPostView({ ui: { relTime: () => '' } });

  const html = view.renderPost({ post: {
    ...POST,
    embed: { playlist: 'https://video/playlist.m3u8', thumbnail: 'https://video/thumb.jpg' },
  } });

  assert.match(html, /<video class="p-video"[^>]*preload="none"/);
  assert.match(html, /poster="https:\/\/video\/thumb\.jpg"/);
  assert.doesNotMatch(html, /preload="metadata"/);
});

test('overlays pending reactions onto server counts and disables their buttons', () => {
  const view = loadPostView().createBlueskyPostView({
    ui: { relTime: () => '' },
    getPendingReaction: (kind, uri) => (
      kind === 'like' && uri === 'at://post/1'
        ? { active: true, previousRecordUri: '' }
        : null
    ),
  });

  const html = view.renderPost({ post: POST });

  assert.match(html, /class="pa lk liked" data-bsky-action="like" disabled>/);
  assert.match(html, /data-bsky-action="like" disabled>[^<]*<span>4<\/span>/);
  assert.match(html, /class="pa rt " data-bsky-action="repost">/);
});

test('derives a stable notification identity without a uri', () => {
  const view = loadPostView().createBlueskyPostView({});
  const identity = view.getNotificationIdentity({
    indexedAt: '2026-07-20T01:00:00.000Z',
    reason: 'like',
    author: { did: 'did:plc:b' },
    reasonSubject: 'at://post/9',
  });
  assert.equal(identity, '2026-07-20T01:00:00.000Z|like|did:plc:b|at://post/9');
});

test('renders nested thread replies with increasing depth', () => {
  const view = loadPostView().createBlueskyPostView({ ui: { relTime: () => '' } });
  const html = view.renderThreadReplies([
    {
      post: { ...POST, uri: 'at://reply/1' },
      replies: [{ post: { ...POST, uri: 'at://reply/2' } }],
    },
  ]);

  assert.match(html, /data-thread-depth="0"/);
  assert.match(html, /data-thread-depth="1"/);
  assert.match(html, /data-uri="at:\/\/reply\/1"/);
  assert.match(html, /data-uri="at:\/\/reply\/2"/);
});
