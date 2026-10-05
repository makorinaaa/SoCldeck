const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const fixture = require('./fixtures/x-home-timeline.json');
const { normalizeTimelineResponse } = require('../src/main/x-timeline-normalizer');

function load() {
  const context = { window: {}, URL };
  for (const name of ['html-escape.js', 'x-post-view.js', 'x-native-timeline-runtime.js', 'x-status-actions.js', 'x-status-runtime.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8'), context);
  }
  return context.window;
}

// A tiny keyed DOM: enough to observe which nodes are kept, built, moved and removed.
class FakeElement {
  constructor(html) {
    this.html = html;
    this.parent = null;
    const id = /data-x-id="(\d+)"/.exec(html)?.[1];
    this.dataset = id ? { xId: id } : {};
    this.classList = { contains: name => html.includes(`class="${name}`) };
  }
  hasAttribute(name) { return this.html.includes(name); }
  get nextElementSibling() {
    const siblings = this.parent?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  replaceWith(next) {
    const siblings = this.parent.children;
    siblings[siblings.indexOf(this)] = next;
    next.parent = this.parent;
    this.parent = null;
  }
}

function createHost() {
  const listeners = {};
  const host = {
    children: [],
    domWrites: 0,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    querySelectorAll: () => [],
    get firstElementChild() { return host.children[0] || null; },
    set innerHTML(value) { host.children = []; host.text = value; host.domWrites += 1; },
    get innerHTML() { return host.text || host.children.map(child => child.html).join(''); },
    insertBefore(node, reference) {
      host.domWrites += 1;
      host.text = '';
      node.remove();
      const index = reference ? host.children.indexOf(reference) : host.children.length;
      host.children.splice(index < 0 ? host.children.length : index, 0, node);
      node.parent = host;
    },
  };
  return host;
}

function createRuntime(window) {
  const listeners = {};
  const webview = {
    setAttribute() {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    getWebContentsId: () => 41,
    loadURL: () => Promise.resolve(),
    executeJavaScript: () => Promise.resolve(true),
    remove() {},
  };
  let captured = null;
  const built = [];
  const pending = new Map();
  const view = window.SocialDeckXPostView.createXPostView({
    getPendingReaction: (kind, id) => pending.get(`${kind}:${id}`) || null,
  });
  const runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef: { hidden: false, createElement: () => webview },
    getReaderHost: () => ({ appendChild() {} }),
    tap: { attach: async () => true, onCaptured: fn => { captured = fn; } },
    renderPost: view.renderPost,
    createElementFromHtml: html => {
      const element = new FakeElement(html);
      built.push(element);
      return element;
    },
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const ready = () => Promise.all((listeners['dom-ready'] || []).map(fn => fn()));
  return { runtime, built, pending, ready, emit: payload => captured({ webContentsId: 41, ...payload }) };
}

test('columns are patched in place: unchanged posts keep their nodes', async () => {
  const window = load();
  const { runtime, built, ready, emit } = createRuntime(window);
  const host = createHost();
  runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  await ready();
  const timeline = normalizeTimelineResponse(fixture);
  emit(timeline);
  const firstNodes = [...host.children];
  assert.deepEqual(firstNodes.map(node => node.dataset.xId || (node.html.includes('data-x-native-tabs') ? 'tabs' : 'more')), ['tabs', ...timeline.posts.map(post => post.id), 'more']);
  const builtAfterFirst = built.length;

  // The same capture again (a refresh with nothing new) does not touch the DOM.
  const writes = host.domWrites;
  emit(timeline);
  assert.equal(host.domWrites, writes);
  assert.equal(built.length, builtAfterFirst);

  // A new post arrives on top: only that post is built; the others are the same nodes.
  const newer = { ...timeline.posts[0], id: '1900000000000000009', sortIndex: '1900000000000000009', url: 'https://x.com/alice/status/1900000000000000009' };
  emit({ ...timeline, posts: [newer], requestCursor: 'TOPCURSOR' });
  assert.equal(built.length, builtAfterFirst + 1);
  assert.equal(host.children[1].dataset.xId, newer.id);
  firstNodes.forEach(node => assert.ok(host.children.includes(node), 'existing post node was kept'));
});

test('a changed post is rebuilt alone and removed posts disappear', async () => {
  const window = load();
  const { runtime, built, ready, emit } = createRuntime(window);
  const host = createHost();
  runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  await ready();
  const timeline = normalizeTimelineResponse(fixture);
  emit(timeline);
  const [, first, second] = host.children;
  const builtBefore = built.length;
  emit({ ...timeline, posts: [{ ...timeline.posts[1], counts: { ...timeline.posts[1].counts, like: 999 } }], requestCursor: 'TOPCURSOR' });
  assert.equal(built.length, builtBefore + 1, 'only the changed post is rebuilt');
  assert.equal(host.children[1], first);
  assert.notEqual(host.children[2], second);
  assert.match(host.children[2].html, /999/);
});

test('the status page is released after it sits idle', async () => {
  const window = load();
  const timers = [];
  let removed = false;
  const listeners = {};
  const webview = {
    setAttribute() {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    getWebContentsId: () => 9,
    loadURL: () => Promise.resolve(),
    executeJavaScript: () => Promise.resolve('ready'),
    remove() { removed = true; },
  };
  const runtime = window.SocialDeckXStatusRuntime.createXStatusRuntime({
    documentRef: { createElement: () => webview },
    getHost: () => ({ appendChild() {} }),
    tap: { attach: async () => true, detach: async () => true },
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutFn: () => {},
    idleMs: 1000,
  });
  const pending = runtime.run('persist:x-0', { id: '1', url: 'https://x.com/a/status/1' });
  await Promise.all((listeners['dom-ready'] || []).map(fn => fn()));
  await pending;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.at(-1).ms, 1000);
  assert.equal(runtime.partitionOf(9), 'persist:x-0');
  timers.at(-1).fn();
  assert.equal(removed, true);
  assert.equal(runtime.partitionOf(9), null);
});

test('a first page removes posts deleted within its range but keeps older and just-sent posts', () => {
  const { reconcileFirstPage } = load().SocialDeckXNativeTimelineRuntime;
  const post = (id, sortIndex, extra = {}) => ({ id, sortIndex, ...extra });
  const shown = [post('mine', '900', { local: true }), post('a', '500'), post('deleted', '450'), post('b', '400'), post('older', '100')];
  const firstPage = [post('a', '500'), post('b', '400')];
  assert.deepEqual(reconcileFirstPage(shown, firstPage, 'following').map(item => item.id), ['mine', 'a', 'b', 'older']);
  // A ranked feed is replaced by its new first page.
  assert.deepEqual(reconcileFirstPage(shown, firstPage, 'for-you').map(item => item.id), ['mine', 'a', 'b']);
  assert.equal(reconcileFirstPage(shown, [], 'following'), shown);
});

test('a reloaded first page drops a post deleted elsewhere from the Column', async () => {
  const window = load();
  const { runtime, ready, emit } = createRuntime(window);
  const host = createHost();
  runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  await ready();
  const timeline = normalizeTimelineResponse(fixture);
  emit(timeline);
  const [kept, deleted, last] = timeline.posts;
  emit({ ...timeline, posts: [kept, last], firstPage: true });
  assert.deepEqual(host.children.map(node => node.dataset.xId || (node.html.includes('data-x-native-tabs') ? 'tabs' : 'more')), ['tabs', kept.id, last.id, 'more']);
  assert.equal(host.children.some(node => node.dataset.xId === deleted.id), false);
});

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values,
  };
}

function createSnapshotRuntime(window, storage, timers) {
  const listeners = {};
  const webview = {
    setAttribute() {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    getWebContentsId: () => 41,
    loadURL: () => Promise.resolve(),
    executeJavaScript: () => Promise.resolve(true),
    remove() {},
  };
  let captured = null;
  const view = window.SocialDeckXPostView.createXPostView({});
  const runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef: { hidden: false, createElement: () => webview },
    getReaderHost: () => ({ appendChild() {} }),
    tap: { attach: async () => true, onCaptured: fn => { captured = fn; } },
    renderPost: view.renderPost,
    storage,
    createElementFromHtml: html => new FakeElement(html),
    setTimeoutFn: fn => { timers.push(fn); return timers.length; },
    clearTimeoutFn: () => {},
  });
  return { runtime, ready: () => Promise.all((listeners['dom-ready'] || []).map(fn => fn())), emit: payload => captured({ webContentsId: 41, ...payload }) };
}

test('the newest posts are saved and shown at once on the next start', async () => {
  const window = load();
  const storage = createStorage();
  const timers = [];
  const first = createSnapshotRuntime(window, storage, timers);
  first.runtime.mount({ id: 'a', partition: 'persist:x-0', host: createHost() });
  await first.ready();
  first.emit({ ...normalizeTimelineResponse(fixture, 'HomeLatestTimeline'), firstPage: true });
  timers.forEach(fn => fn());
  const saved = JSON.parse(storage.getItem('socialdeck_x_native_snapshot_persist:x-0'));
  assert.equal(saved.timeline, 'following');
  assert.equal(saved.posts.length, 3);

  // A new start renders the saved posts before X has answered.
  const second = createSnapshotRuntime(window, storage, []);
  const host = createHost();
  second.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  assert.deepEqual(host.children.map(node => node.dataset.xId || (node.html.includes('data-x-native-tabs') ? 'tabs' : 'more')),
    ['tabs', ...saved.posts.map(post => post.id), 'more']);

  // Removing the account forgets its saved posts.
  second.runtime.forgetAccount('persist:x-0');
  assert.equal(storage.getItem('socialdeck_x_native_snapshot_persist:x-0'), null);
  assert.equal(host.children.some(node => node.dataset.xId), false);
});

test('scrolling near the end of a Column loads more posts automatically', async () => {
  const window = load();
  const { runtime, ready, emit } = createRuntime(window);
  const host = createHost();
  host.scrollHeight = 5000;
  host.clientHeight = 800;
  host.scrollTop = 0;
  const scrollListeners = [];
  const addEventListener = host.addEventListener;
  host.addEventListener = (type, fn) => (type === 'scroll' ? scrollListeners.push(fn) : addEventListener(type, fn));
  runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  await ready();
  emit({ ...normalizeTimelineResponse(fixture), firstPage: true });
  const moreButton = () => host.children.find(node => node.html.includes('data-x-native-more'));
  scrollListeners.forEach(fn => fn());
  assert.match(moreButton().html, /さらに読み込む/, 'far from the end nothing loads');
  host.scrollTop = 3900;
  scrollListeners.forEach(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  assert.match(moreButton().html, /読み込み中…/);
});

test('saved posts only bridge the wait: the first page from X replaces all of them', async () => {
  const window = load();
  const timeline = normalizeTimelineResponse(fixture, 'HomeLatestTimeline');
  const old = { ...timeline.posts[0], id: '1000', sortIndex: '1000', url: 'https://x.com/alice/status/1000' };
  const storage = createStorage({
    'socialdeck_x_native_snapshot_persist:x-0': JSON.stringify({ savedAt: Date.now(), timeline: 'following', posts: [...timeline.posts, old] }),
  });
  const runtime = createSnapshotRuntime(window, storage, []);
  const host = createHost();
  runtime.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  assert.ok(host.children.some(node => node.dataset.xId === '1000'), 'the saved post shows while waiting');
  await runtime.ready();
  // X's first page covers only the newer posts; the old saved post must not linger below it.
  runtime.emit({ ...timeline, firstPage: true });
  assert.equal(host.children.some(node => node.dataset.xId === '1000'), false);
  assert.equal(host.children.filter(node => node.dataset.xId).length, timeline.posts.length);
});

test('a snapshot older than 12 hours is not shown', () => {
  const window = load();
  const timeline = normalizeTimelineResponse(fixture, 'HomeLatestTimeline');
  const storage = createStorage({
    'socialdeck_x_native_snapshot_persist:x-0': JSON.stringify({ savedAt: Date.now() - 13 * 60 * 60 * 1000, timeline: 'following', posts: timeline.posts }),
  });
  const runtime = createSnapshotRuntime(window, storage, []);
  const host = createHost();
  runtime.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  assert.equal(host.children.some(node => node.dataset.xId), false);
});

function createBadge() {
  const listeners = {};
  return {
    textContent: '', title: '', style: { display: 'none' },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    click() { (listeners.click || []).forEach(fn => fn({ stopPropagation() {} })); },
  };
}

test('new posts above the top raise a badge that stays until the reader returns to the top', async () => {
  const window = load();
  const timers = [];
  const { runtime, ready, emit } = (() => {
    const listeners = {};
    const webview = { setAttribute() {}, addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, getWebContentsId: () => 41, loadURL: () => Promise.resolve(), executeJavaScript: () => Promise.resolve(true), remove() {} };
    let captured = null;
    const view = window.SocialDeckXPostView.createXPostView({});
    const created = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
      documentRef: { hidden: false, createElement: () => webview },
      getReaderHost: () => ({ appendChild() {} }),
      tap: { attach: async () => true, onCaptured: fn => { captured = fn; } },
      renderPost: view.renderPost,
      createElementFromHtml: html => new FakeElement(html),
      requestFrame: fn => fn(),
      setTimeoutFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimeoutFn: () => {},
    });
    return { runtime: created, ready: () => Promise.all((listeners['dom-ready'] || []).map(fn => fn())), emit: payload => captured({ webContentsId: 41, ...payload }) };
  })();
  const host = createHost();
  const scrollListeners = [];
  const addEventListener = host.addEventListener;
  host.addEventListener = (type, fn) => (type === 'scroll' ? scrollListeners.push(fn) : addEventListener(type, fn));
  host.scrollTop = 0;
  host.scrollTo = ({ top }) => { host.scrollTop = top; };
  const badge = createBadge();
  runtime.mount({ id: 'a', partition: 'persist:x-0', host, badge });
  await ready();
  const timeline = normalizeTimelineResponse(fixture);
  emit({ ...timeline, firstPage: true });
  assert.equal(badge.style.display, 'none', 'the first load is not "new"');

  const newer = n => ({ ...timeline.posts[0], id: `19000000000000000${n}`, sortIndex: `19000000000000000${n}`, url: `https://x.com/alice/status/19000000000000000${n}` });
  // At the top the badge shows briefly.
  emit({ ...timeline, posts: [newer(10)], requestCursor: 'TOP' });
  assert.equal(badge.textContent, '+1');
  assert.equal(badge.style.display, '');
  timers.filter(timer => timer.ms === 5000).at(-1).fn();
  assert.equal(badge.style.display, 'none');

  // Scrolled down, the count adds up and stays.
  host.scrollTop = 900;
  emit({ ...timeline, posts: [newer(11)], requestCursor: 'TOP' });
  emit({ ...timeline, posts: [newer(12), newer(13)], requestCursor: 'TOP' });
  assert.equal(badge.textContent, '+3');
  // Loading older posts at the bottom is not "new".
  emit({ ...timeline, posts: [{ ...timeline.posts[0], id: '5', sortIndex: '5', url: 'https://x.com/alice/status/5' }], requestCursor: 'BOTTOM' });
  assert.equal(badge.textContent, '+3');

  badge.click();
  assert.equal(host.scrollTop, 0);
  assert.equal(badge.style.display, 'none');
});
