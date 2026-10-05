const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const fixture = require('./fixtures/x-home-timeline.json');
const { normalizeTimelineResponse } = require('../src/main/x-timeline-normalizer');

const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function load() {
  const context = { window: {}, URL };
  for (const name of ['html-escape.js', 'x-post-view.js', 'x-native-posts.js', 'x-native-page-scripts.js', 'x-native-column-view.js', 'x-native-detail.js', 'x-native-reactions.js', 'x-native-readers.js', 'x-native-timeline-runtime.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8'), context);
  }
  return context.window;
}

function createTarget(extra = {}) {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
    dispatch(type, event = {}) { return Promise.all((listeners[type] || []).map(fn => fn(event))); },
    ...extra,
  };
}

// Minimal element whose closest() walks a fixed ancestor chain described by selectors.
function element({ matches = [], dataset = {}, parent = null } = {}) {
  const node = { dataset, parent, matches };
  node.closest = selector => {
    const wanted = selector.split(',').map(part => part.trim());
    for (let current = node; current; current = current.parent) {
      if (wanted.some(part => current.matches.includes(part))) return current;
    }
    return null;
  };
  node.getBoundingClientRect = () => ({ left: 10, bottom: 20 });
  return node;
}

function event(target) {
  return { target, preventDefault() {}, stopPropagation() {} };
}

function createHarness({ toggleResult = 'done' } = {}) {
  const window = load();
  const appended = [];
  const webviews = [];
  const documentRef = createTarget({
    hidden: false,
    body: { appendChild: node => appended.push(node) },
    createElement: tag => {
      if (tag === 'webview') {
        return webviews[webviews.push(createTarget({
          setAttribute() {},
          getWebContentsId: () => 41,
          loadURL: () => Promise.resolve(),
          executeJavaScript: () => Promise.resolve(true),
          remove() {},
        })) - 1];
      }
      const detailBody = { innerHTML: '' };
      return createTarget({
        style: {},
        innerHTML: '',
        removed: false,
        detailBody,
        querySelector: selector => (selector === '.bsky-post-detail-body' ? detailBody : null),
        querySelectorAll: () => [],
        contains: () => false,
        remove() { this.removed = true; },
      });
    },
  });
  let captured = null;
  const toggles = [];
  const runs = [];
  const intents = { replies: [], quotes: [], outcomes: [] };
  let runtime = null;
  const view = window.SocialDeckXPostView.createXPostView({
    relTime: () => '1h',
    getPendingReaction: (kind, id, partition) => runtime?.getPendingReaction(kind, id, partition) || null,
  });
  const statusRuntime = {
    partitionOf: id => (id === 77 ? 'persist:x-0' : null),
    run: async (partition, target) => { runs.push([partition, target.id]); },
    toggle: async (partition, target, action, active) => {
      toggles.push([partition, target.id, action, active]);
      return toggleResult;
    },
    dispose() {},
  };
  runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef,
    getReaderHost: () => ({ appendChild() {} }),
    tap: { attach: async () => true, detach: async () => true, onCaptured: fn => { captured = fn; } },
    statusRuntime,
    renderPost: view.renderPost,
    renderThread: view.renderThread,
    intents: {
      reply: target => intents.replies.push(target),
      quote: target => intents.quotes.push(target),
      onOutcome: outcome => intents.outcomes.push(outcome),
    },
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const host = createTarget({ innerHTML: '', scrollTop: 0, querySelectorAll: () => [] });
  return { runtime, host, appended, webviews, toggles, runs, intents, documentRef, emit: payload => captured(payload) };
}

function postElement(id, inner = []) {
  const post = element({ matches: ['[data-x-id]'], dataset: { xId: id } });
  return inner.reduce((parent, step) => element({ ...step, parent }), post);
}

test('clicking a timeline post opens the detail overlay and loads its status page', async () => {
  const harness = createHarness();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host: harness.host });
  // A payload without a WebContents id never reaches a reader that is still starting.
  harness.emit({ ...normalizeTimelineResponse(fixture) });
  assert.doesNotMatch(harness.host.innerHTML, /data-x-id/);
  await harness.webviews[0].dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });

  await harness.host.dispatch('click', event(postElement('404')));
  assert.equal(harness.appended.length, 0, 'unknown posts do not open an empty overlay');
  await harness.host.dispatch('click', event(postElement('1800000000000000003')));
  assert.equal(harness.appended.length, 1);
  assert.deepEqual(harness.runs, [['persist:x-0', '1800000000000000003']]);
  assert.match(harness.appended[0].detailBody.innerHTML, /Tom &amp; Jerry/);
});

test('a known post opens a Bluesky-style detail and renders the captured thread', async () => {
  const harness = createHarness();
  const detail = harness.runtime.openPost({
    id: '5', url: 'https://x.com/alice/status/5', author: { handle: 'alice', name: 'Alice' }, segments: [{ type: 'text', text: 'focal' }], media: [],
  }, 'persist:x-0');
  await flush();
  assert.equal(harness.appended.length, 1);
  assert.deepEqual(harness.runs, [['persist:x-0', '5']]);
  assert.match(detail.overlay.detailBody.innerHTML, /focal/);
  assert.match(detail.overlay.detailBody.innerHTML, /返信を読み込み中/);

  const [ancestor, reply] = normalizeTimelineResponse(fixture).posts;
  harness.emit({
    webContentsId: 77,
    operation: 'TweetDetail',
    focalId: '5',
    thread: [
      ancestor,
      { id: '5', url: 'https://x.com/alice/status/5', author: { handle: 'alice' }, segments: [{ type: 'text', text: 'focal' }], media: [], counts: { like: 9 } },
      { id: '8', url: 'https://x.com/zed/status/8', author: { handle: 'zed' }, segments: [{ type: 'text', text: 'discover more' }], media: [] },
    ],
    replies: [{ post: reply, replies: [] }],
  });
  assert.match(detail.overlay.detailBody.innerHTML, /会話/);
  assert.match(detail.overlay.detailBody.innerHTML, /x-focal" role="link" tabindex="0" data-x-id="5"/);
  assert.doesNotMatch(detail.overlay.detailBody.innerHTML, /discover more/, 'posts after the focal post are not part of the conversation');
  assert.match(detail.overlay.detailBody.innerHTML, new RegExp(`data-x-id="${reply.id}"`));

  harness.emit({
    webContentsId: 77,
    operation: 'CreateTweet',
    posts: [{ id: '6', url: 'https://x.com/me/status/6', replyTo: 'alice', author: { handle: 'me' }, segments: [{ type: 'text', text: 'my reply' }], media: [] }],
  });
  assert.match(detail.overlay.detailBody.innerHTML, /my reply/);

  await detail.overlay.dispatch('click', { target: element({ matches: ['[data-x-detail-close]'] }) });
  assert.equal(detail.overlay.removed, true);
});

test('like toggles through the status runtime with a pending state', async () => {
  const harness = createHarness();
  const post = { id: '5', url: 'https://x.com/alice/status/5', author: { handle: 'alice' }, segments: [], media: [], counts: { like: 2 }, viewer: { liked: false } };
  const detail = harness.runtime.openPost(post, 'persist:x-0');
  const like = postElement('5', [{ matches: ['[data-x-action]'], dataset: { xAction: 'like' } }]);
  const clicked = detail.overlay.dispatch('click', event(like));
  assert.deepEqual(plain(harness.runtime.getPendingReaction('like', '5', 'persist:x-0')), { active: true });
  assert.match(detail.overlay.detailBody.innerHTML, /pa lk liked" data-x-action="like" title="いいね" disabled/);
  await clicked;
  await flush();
  assert.deepEqual(harness.toggles, [['persist:x-0', '5', 'like', true]]);
  assert.equal(harness.runtime.getPendingReaction('like', '5', 'persist:x-0'), null);
  assert.match(detail.overlay.detailBody.innerHTML, /pa lk liked" data-x-action="like" title="いいね"> <span>3<\/span>/);
  assert.deepEqual(plain(harness.intents.outcomes), [{ kind: 'like', status: 'succeeded', active: true }]);
});

test('a failed like is reported and rolled back', async () => {
  const harness = createHarness({ toggleResult: 'missing' });
  const post = { id: '5', url: 'https://x.com/alice/status/5', author: { handle: 'alice' }, segments: [], media: [], counts: { like: 2 }, viewer: { liked: false } };
  const detail = harness.runtime.openPost(post, 'persist:x-0');
  await detail.overlay.dispatch('click', event(postElement('5', [{ matches: ['[data-x-action]'], dataset: { xAction: 'like' } }])));
  await flush();
  assert.equal(harness.intents.outcomes[0].status, 'failed');
  assert.doesNotMatch(detail.overlay.detailBody.innerHTML, /pa lk liked/);
});

test('reply and quote are handed to compose with the Column account', async () => {
  const harness = createHarness();
  const post = { id: '5', url: 'https://x.com/alice/status/5', author: { handle: 'alice' }, segments: [], media: [], viewer: {} };
  const detail = harness.runtime.openPost(post, 'persist:x-2');
  await detail.overlay.dispatch('click', event(postElement('5', [{ matches: ['[data-x-action]'], dataset: { xAction: 'reply' } }])));
  assert.deepEqual(plain(harness.intents.replies), [{ id: '5', url: 'https://x.com/alice/status/5', handle: 'alice', partition: 'persist:x-2' }]);

  await detail.overlay.dispatch('click', event(postElement('5', [{ matches: ['[data-x-action]'], dataset: { xAction: 'repost' } }])));
  const menu = harness.appended.at(-1);
  assert.match(menu.innerHTML, /リポスト/);
  assert.match(menu.innerHTML, /引用/);
  await menu.dispatch('click', event(element({ matches: ['[data-x-menu-action]'], dataset: { xMenuAction: 'quote' } })));
  assert.deepEqual(plain(harness.intents.quotes), [{ id: '5', url: 'https://x.com/alice/status/5', handle: 'alice', partition: 'persist:x-2' }]);
  assert.equal(menu.removed, true);
});

test('a like from one account does not change the same post in another account', async () => {
  const harness = createHarness();
  const otherHost = createTarget({ innerHTML: '', scrollTop: 0, querySelectorAll: () => [] });
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host: harness.host });
  harness.runtime.mount({ id: 'b', partition: 'persist:x-1', host: otherHost });
  await harness.webviews[0].dispatch('dom-ready');
  harness.webviews[1].getWebContentsId = () => 42;
  await harness.webviews[1].dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });
  harness.emit({ webContentsId: 42, ...normalizeTimelineResponse(fixture) });
  const target = '1700000000000000001';
  const likeButton = postElement(target, [{ matches: ['[data-x-action]'], dataset: { xAction: 'like' } }]);
  const clicked = harness.host.dispatch('click', event(likeButton));
  assert.ok(harness.runtime.getPendingReaction('like', target, 'persist:x-0'));
  assert.equal(harness.runtime.getPendingReaction('like', target, 'persist:x-1'), null);
  await clicked;
  await flush();
  assert.deepEqual(harness.toggles, [['persist:x-0', target, 'like', true]]);
  const likedButton = html => {
    const start = html.indexOf(`data-x-id="${target}"`);
    const section = html.slice(start, html.indexOf('data-x-id=', start + 12));
    return /pa lk liked/.test(section);
  };
  assert.equal(likedButton(harness.host.innerHTML), true);
  assert.equal(likedButton(otherHost.innerHTML), false);
});

test('a detail with no captured conversation reloads the status page once before failing', async () => {
  const window = load();
  const runs = [];
  const timers = [];
  const appended = [];
  const documentRef = createTarget({
    body: { appendChild: node => appended.push(node) },
    createElement: () => {
      const detailBody = { innerHTML: '' };
      return createTarget({ style: {}, innerHTML: '', detailBody, querySelector: () => detailBody, querySelectorAll: () => [], remove() {} });
    },
  });
  const view = window.SocialDeckXPostView.createXPostView({});
  const runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef,
    tap: { attach: async () => true, onCaptured() {} },
    statusRuntime: {
      partitionOf: () => null,
      run: async (partition, target, task, options) => { runs.push(options?.reload === true); },
      dispose() {},
    },
    renderPost: view.renderPost,
    renderThread: view.renderThread,
    setTimeoutFn: fn => { timers.push(fn); return timers.length; },
    clearTimeoutFn: () => {},
  });
  const detail = runtime.openPost({ id: '5', url: 'https://x.com/a/status/5', author: { handle: 'a' }, segments: [], media: [] }, 'persist:x-0');
  await flush();
  timers.shift()();
  await flush();
  assert.deepEqual(runs, [false, true]);
  timers.shift()();
  await flush();
  assert.match(detail.overlay.detailBody.innerHTML, /返信を読み込めませんでした/);
});

test('openPostFrom shows a searching state, then the found post with an already captured thread', async () => {
  const harness = createHarness();
  const thread = normalizeTimelineResponse(fixture).posts;
  // X fetched the status page while the notification was being followed.
  harness.emit({ webContentsId: 77, operation: 'TweetDetail', focalId: thread[0].id, thread: [thread[0]], replies: [{ post: thread[2], replies: [] }] });
  let resolveFind;
  const opening = harness.runtime.openPostFrom('persist:x-0', () => new Promise(resolve => { resolveFind = resolve; }));
  const overlay = harness.appended[0];
  assert.match(overlay.detailBody.innerHTML, /ポストを探しています/);
  resolveFind({ id: thread[0].id, url: thread[0].url, author: thread[0].author, segments: [], media: [] });
  const detail = await opening;
  assert.equal(detail.focalId, thread[0].id);
  assert.match(overlay.detailBody.innerHTML, new RegExp(`data-x-id="${thread[2].id}"`), 'cached replies are shown');

  const failed = await harness.runtime.openPostFrom('persist:x-0', async () => null);
  assert.equal(failed, null);
  assert.equal(harness.appended.at(-1).removed, true);
});

test('own posts get a delete menu that removes the post after X confirms', async () => {
  const window = load();
  const appended = [];
  const removed = [];
  const outcomes = [];
  const documentRef = createTarget({
    hidden: false,
    body: { appendChild: node => appended.push(node) },
    createElement: () => {
      const detailBody = { innerHTML: '' };
      return createTarget({
        style: {}, innerHTML: '', detailBody,
        querySelector: selector => (selector === '.bsky-post-detail-body' ? detailBody : null),
        querySelectorAll: () => [], contains: () => false, remove() { this.removed = true; },
      });
    },
  });
  const view = window.SocialDeckXPostView.createXPostView({});
  const runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef,
    getReaderHost: () => null,
    tap: { attach: async () => true, onCaptured() {} },
    statusRuntime: { partitionOf: () => null, run: async () => {}, remove: async (partition, post) => { removed.push([partition, post.id]); return 'done'; }, dispose() {} },
    renderPost: view.renderPost,
    getAccountId: async () => '11',
    confirmAction: () => true,
    intents: { onOutcome: outcome => outcomes.push(outcome) },
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  // Mounting a Column looks up the account's own user id (11 = Alice in the fixture).
  runtime.mount({ id: 'a', partition: 'persist:x-0', host: createTarget({ innerHTML: '', scrollTop: 0, querySelectorAll: () => [] }) });
  await flush();
  const [alicePost, carolRepost] = normalizeTimelineResponse(fixture).posts;

  const otherDetail = runtime.openPost(carolRepost, 'persist:x-0');
  assert.doesNotMatch(otherDetail.overlay.detailBody.innerHTML, /data-x-action="more"/, 'other accounts cannot be deleted');

  const detail = runtime.openPost(alicePost, 'persist:x-0');
  assert.match(detail.overlay.detailBody.innerHTML, /data-x-action="more"/);
  await detail.overlay.dispatch('click', event(postElement(alicePost.id, [{ matches: ['[data-x-action]'], dataset: { xAction: 'more' } }])));
  const menu = appended.at(-1);
  assert.match(menu.innerHTML, /削除/);
  await menu.dispatch('click', event(element({ matches: ['[data-x-menu-action]'], dataset: { xMenuAction: 'delete' } })));
  await flush();
  assert.deepEqual(removed, [['persist:x-0', alicePost.id]]);
  assert.deepEqual(plain(outcomes), [{ kind: 'delete', status: 'succeeded' }]);
  assert.equal(detail.overlay.removed, true, 'deleting the focal post closes its detail view');
});

test('a post deleted from one account disappears from every account Column', async () => {
  const window = load();
  let captured = null;
  const webviews = [];
  const documentRef = createTarget({
    hidden: false,
    body: { appendChild() {} },
    createElement: () => webviews[webviews.push(createTarget({
      setAttribute() {}, getWebContentsId: (id => () => id)(41 + webviews.length), loadURL: () => Promise.resolve(),
      executeJavaScript: () => Promise.resolve(true), remove() {}, style: {}, innerHTML: '',
      querySelector: () => null, querySelectorAll: () => [], contains: () => false,
    })) - 1],
  });
  const view = window.SocialDeckXPostView.createXPostView({});
  const runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef,
    getReaderHost: () => ({ appendChild() {} }),
    tap: { attach: async () => true, onCaptured: fn => { captured = fn; } },
    statusRuntime: { partitionOf: () => null, run: async () => {}, remove: async () => 'done', dispose() {} },
    renderPost: view.renderPost,
    getAccountId: async partition => (partition === 'persist:x-0' ? '11' : '99'),
    confirmAction: () => true,
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const main = createTarget({ innerHTML: '', scrollTop: 0, querySelectorAll: () => [] });
  const sub = createTarget({ innerHTML: '', scrollTop: 0, querySelectorAll: () => [] });
  runtime.mount({ id: 'main', partition: 'persist:x-0', host: main });
  runtime.mount({ id: 'sub', partition: 'persist:x-1', host: sub });
  await flush();
  await webviews[0].dispatch('dom-ready');
  await webviews[1].dispatch('dom-ready');
  const timeline = normalizeTimelineResponse(fixture);
  captured({ webContentsId: 41, ...timeline });
  captured({ webContentsId: 42, ...timeline });
  const target = timeline.posts[0].id;
  assert.match(sub.innerHTML, new RegExp(`data-x-id="${target}"`));

  await main.dispatch('click', event(postElement(target, [{ matches: ['[data-x-action]'], dataset: { xAction: 'more' } }])));
  const menu = webviews.at(-1);
  await menu.dispatch('click', event(element({ matches: ['[data-x-menu-action]'], dataset: { xMenuAction: 'delete' } })));
  await flush();
  assert.doesNotMatch(main.innerHTML, new RegExp(`data-x-id="${target}"`));
  assert.doesNotMatch(sub.innerHTML, new RegExp(`data-x-id="${target}"`), 'the other account no longer shows it');
});

test('posts show no view count and the own-post menu sits at the end of the actions', () => {
  const view = load().SocialDeckXPostView.createXPostView({});
  const html = view.renderPost({ id: '1', url: 'https://x.com/a/status/1', author: { handle: 'a' }, segments: [], media: [], counts: { view: 12345 } }, { own: true });
  assert.doesNotMatch(html, /表示/);
  const actions = html.slice(html.indexOf('p-acts'));
  assert.ok(actions.indexOf('data-x-action="more"') > actions.indexOf('data-x-action="like"'));
});

test('a delete that fails before X confirms is retried once', async () => {
  const window = load();
  const results = ['menu-missing', 'done'];
  const calls = [];
  const outcomes = [];
  const appended = [];
  const documentRef = createTarget({
    body: { appendChild: node => appended.push(node) },
    createElement: () => {
      const detailBody = { innerHTML: '' };
      return createTarget({ style: {}, innerHTML: '', detailBody, querySelector: () => detailBody, querySelectorAll: () => [], contains: () => false, remove() { this.removed = true; } });
    },
  });
  const view = window.SocialDeckXPostView.createXPostView({});
  const runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef,
    tap: { attach: async () => true, onCaptured() {} },
    statusRuntime: { partitionOf: () => null, run: async () => {}, remove: async () => { calls.push('remove'); return results.shift(); }, dispose() {} },
    renderPost: view.renderPost,
    confirmAction: () => true,
    intents: { onOutcome: outcome => outcomes.push(outcome) },
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const post = { id: '5', url: 'https://x.com/a/status/5', author: { handle: 'a', id: '11' }, segments: [], media: [] };
  const detail = runtime.openPost(post, 'persist:x-0');
  await detail.overlay.dispatch('click', event(postElement('5', [{ matches: ['[data-x-action]'], dataset: { xAction: 'more' } }])));
  const menu = appended.at(-1);
  await menu.dispatch('click', event(element({ matches: ['[data-x-menu-action]'], dataset: { xMenuAction: 'delete' } })));
  await flush();
  assert.deepEqual(calls, ['remove', 'remove']);
  assert.deepEqual(plain(outcomes), [{ kind: 'delete', status: 'succeeded' }]);
});

test('reaction counts never show fewer reactions than the post visibly has', () => {
  const view = load().SocialDeckXPostView.createXPostView({});
  const base = { id: '1', url: 'https://x.com/a/status/1', author: { handle: 'a' }, segments: [], media: [] };
  const count = (html, action) => new RegExp(`data-x-action="${action}"[^>]*>[^<]*<span>(\\d+)</span>`).exec(html)?.[1];
  assert.equal(count(view.renderPost({ ...base, counts: { repost: 0 }, viewer: { reposted: true } }), 'repost'), '1');
  assert.equal(count(view.renderPost({ ...base, counts: { repost: 0 }, repostedBy: { handle: 'shun' } }), 'repost'), '1');
  assert.equal(count(view.renderPost({ ...base, counts: { like: 0 }, viewer: { liked: true } }), 'like'), '1');
  assert.equal(count(view.renderPost({ ...base, counts: { repost: 7 }, viewer: { reposted: true } }), 'repost'), '7');
});

test('a repost of this account\'s own post keeps the delete menu', async () => {
  const window = load();
  const documentRef = createTarget({
    body: { appendChild() {} },
    createElement: () => {
      const detailBody = { innerHTML: '' };
      return createTarget({ style: {}, innerHTML: '', detailBody, querySelector: () => detailBody, querySelectorAll: () => [], contains: () => false, remove() {} });
    },
  });
  const view = window.SocialDeckXPostView.createXPostView({});
  const runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef,
    getReaderHost: () => null,
    tap: { attach: async () => true, onCaptured() {} },
    renderPost: view.renderPost,
    getAccountId: async () => '11',
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  runtime.mount({ id: 'a', partition: 'persist:x-0', host: createTarget({ innerHTML: '', scrollTop: 0, querySelectorAll: () => [] }) });
  await flush();
  const detail = runtime.openPost({
    id: '5', url: 'https://x.com/me/status/5', author: { handle: 'me', id: '11' },
    repostedBy: { handle: 'shun', name: 'shun' }, segments: [], media: [],
  }, 'persist:x-0');
  assert.match(detail.overlay.detailBody.innerHTML, /data-x-action="more"/);
});

test('a successful repost moves the post to the top as the account own repost', async () => {
  const harness = createHarness();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host: harness.host });
  await harness.webviews[0].dispatch('dom-ready');
  const timeline = normalizeTimelineResponse(fixture);
  harness.emit({ webContentsId: 41, ...timeline });
  const last = timeline.posts.at(-1);
  await harness.host.dispatch('click', event(postElement(last.id, [{ matches: ['[data-x-action]'], dataset: { xAction: 'repost' } }])));
  const menu = harness.appended.at(-1);
  await menu.dispatch('click', event(element({ matches: ['[data-x-menu-action]'], dataset: { xMenuAction: 'repost' } })));
  await flush();
  const firstPost = harness.host.innerHTML.indexOf('data-x-id=');
  assert.equal(harness.host.innerHTML.slice(firstPost, firstPost + 40).includes(last.id), true);
  assert.match(harness.host.innerHTML, /あなた がリポスト/);
});

test('memory cleanup reloads a long-running reader and releases idle status pages', async () => {
  const window = load();
  let clock = 1_000_000;
  let captured = null;
  const loads = [];
  const listeners = {};
  const webview = {
    setAttribute() {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    getWebContentsId: () => 41,
    loadURL: url => { loads.push(url); return Promise.resolve(); },
    executeJavaScript: () => Promise.resolve(true),
    remove() {},
  };
  let statusDisposed = 0;
  const view = window.SocialDeckXPostView.createXPostView({});
  const runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef: { hidden: false, createElement: () => webview },
    getReaderHost: () => ({ appendChild() {} }),
    tap: { attach: async () => true, onCaptured: fn => { captured = fn; } },
    statusRuntime: { partitionOf: () => null, disposeAll: () => { statusDisposed += 1; return 1; }, count: () => 1, dispose() {} },
    renderPost: view.renderPost,
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
    now: () => clock,
  });
  runtime.mount({ id: 'a', partition: 'persist:x-0', host: createTarget({ innerHTML: '', scrollTop: 0, querySelectorAll: () => [] }) });
  await Promise.all((listeners['dom-ready'] || []).map(fn => fn()));
  captured({ webContentsId: 41, ...normalizeTimelineResponse(fixture), firstPage: true });
  assert.deepEqual(plain(runtime.getMemoryStats()), { readers: 1, posts: 3, statusReaders: 1 });

  assert.deepEqual(plain(runtime.trim()), { readersReloaded: 0, statusReadersDisposed: 1 }, 'a fresh reader is left alone');
  clock += 31 * 60 * 1000;
  const loadsBefore = loads.length;
  assert.deepEqual(plain(runtime.trim()), { readersReloaded: 1, statusReadersDisposed: 1 });
  assert.equal(loads.length, loadsBefore + 1);
  assert.equal(statusDisposed, 2);
});

test('likes are pressed on the hidden home page first and fall back to the status page', async () => {
  const window = load();
  const scripts = [];
  let homeResult = 'done';
  const toggles = [];
  let captured = null;
  const listeners = {};
  const webview = {
    setAttribute() {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    getWebContentsId: () => 41,
    loadURL: () => Promise.resolve(),
    executeJavaScript: script => { scripts.push(script); return Promise.resolve(script.startsWith('TOGGLE') ? homeResult : true); },
    remove() {},
  };
  const outcomes = [];
  const view = window.SocialDeckXPostView.createXPostView({});
  const runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef: { hidden: false, createElement: () => webview, body: { appendChild() {} } },
    getReaderHost: () => ({ appendChild() {} }),
    tap: { attach: async () => true, onCaptured: fn => { captured = fn; } },
    statusRuntime: { partitionOf: () => null, toggle: async (...args) => { toggles.push(args.slice(2)); return 'done'; }, dispose() {} },
    renderPost: view.renderPost,
    createToggleScript: ({ statusId, action, active }) => `TOGGLE:${statusId}:${action}:${active}`,
    intents: { onOutcome: outcome => outcomes.push(outcome) },
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const host = createTarget({ innerHTML: '', scrollTop: 0, querySelectorAll: () => [] });
  runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  await Promise.all((listeners['dom-ready'] || []).map(fn => fn()));
  const timeline = normalizeTimelineResponse(fixture);
  captured({ webContentsId: 41, ...timeline, firstPage: true });
  const target = timeline.posts[2].id;
  const like = () => host.dispatch('click', event(postElement(target, [{ matches: ['[data-x-action]'], dataset: { xAction: 'like' } }])));

  await like();
  await flush();
  assert.ok(scripts.includes(`TOGGLE:${target}:like:true`));
  assert.deepEqual(toggles, [], 'the status page was not needed');

  homeResult = 'missing';
  await like();
  await flush();
  assert.deepEqual(plain(toggles), [['like', false]], 'a post no longer on the home page uses the status page');
  assert.deepEqual(plain(outcomes.map(outcome => outcome.status)), ['succeeded', 'succeeded']);
});
