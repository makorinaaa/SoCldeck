const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const flush = () => new Promise(resolve => setImmediate(resolve));

function load() {
  const context = { window: {}, URL };
  for (const name of ['html-escape.js', 'x-post-view.js', 'x-native-posts.js', 'x-native-page-scripts.js', 'x-native-column-view.js', 'x-native-detail.js', 'x-native-reactions.js', 'x-native-notifications.js', 'x-native-readers.js', 'x-native-timeline-runtime.js']) {
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

const event = target => ({ target, preventDefault() {}, stopPropagation() {} });

const author = handle => ({ id: `id-${handle}`, handle, name: handle.toUpperCase(), avatar: '' });
const reply = {
  id: '2001', url: 'https://x.com/bob/status/2001', createdAt: '2026-10-06T10:00:00.000Z',
  author: author('bob'), segments: [{ type: 'text', text: 'a reply to you' }], media: [],
  replyTo: 'me', counts: { reply: 0, repost: 0, like: 0 }, viewer: {},
};
const mine = {
  id: '1001', url: 'https://x.com/me/status/1001', createdAt: '2026-10-06T09:00:00.000Z',
  author: author('me'), segments: [{ type: 'text', text: 'my post' }], media: [], counts: {}, viewer: {},
};
const items = [
  { id: 'post-2001', reason: 'reply', text: 'a reply to you', postText: 'a reply to you', targetId: '2001', targetUrl: reply.url, actorName: 'BOB', actorHandle: 'bob', indexedAt: reply.createdAt, post: reply },
  { id: 'n-like', reason: 'like', text: 'ALICEさんがいいねしました\nmy post', postText: 'my post', targetId: '1001', targetUrl: mine.url, actorName: 'ALICE', actorHandle: 'alice', avatar: 'https://pbs.twimg.com/a.jpg', indexedAt: '2026-10-06T09:30:00.000Z', target: mine },
  { id: 'n-follow', reason: 'follow', text: 'CAROLさんにフォローされました', postText: '', targetId: '', targetUrl: 'https://x.com/carol', profileUrl: 'https://x.com/carol', actorName: 'CAROL', actorHandle: 'carol', indexedAt: '2026-10-06T09:10:00.000Z' },
];

function createHarness({ known = items, loadError = null, blocksPost = () => false } = {}) {
  const window = load();
  const appended = [];
  const runs = [];
  const toggles = [];
  const loads = [];
  const external = [];
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
      run: async (partition, target) => { runs.push([partition, target.id]); },
      toggle: async (partition, target, action, active) => { toggles.push([partition, target.id, action, active]); return 'done'; },
      dispose() {},
    },
    renderPost: view.renderPost,
    renderThread: view.renderThread,
    blocksPost,
    loadNotifications: async (partition, options) => {
      loads.push([partition, options?.force === true]);
      if (loadError) throw loadError;
      return [{ captured: true }];
    },
    getNotifications: () => known,
    intents: { openExternal: ({ url }) => external.push(url) },
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const host = createTarget({ innerHTML: '', scrollTop: 0, querySelectorAll: () => [], scrollTo() {} });
  const badge = createTarget({ textContent: '', title: '', style: { display: 'none' } });
  return { runtime, host, badge, appended, runs, toggles, loads, external };
}

test('a native notification Column draws replies as posts and other notifications as rows', async () => {
  const harness = createHarness();
  harness.runtime.mountNotifications({ id: 'n', partition: 'persist:x-0', host: harness.host, badge: harness.badge });
  await flush();
  const html = harness.host.innerHTML;
  assert.match(html, /data-x-notif-id="post-2001"[\s\S]*data-x-id="2001"/, 'the reply is a full post');
  assert.match(html, /a reply to you/);
  assert.match(html, /data-x-notif-id="n-like"[\s\S]*ALICEさんがいいねしました[\s\S]*x-notif-target">my post/);
  assert.match(html, /data-x-notif-id="n-follow"/);
  assert.equal(harness.runtime.hasNotificationColumn('persist:x-0'), true);
  assert.deepEqual(harness.loads, [['persist:x-0', false]], 'the Column loads the account once when mounted');
  await harness.runtime.refreshNotifications('n', { force: true });
  assert.deepEqual(harness.loads.at(-1), ['persist:x-0', true]);
});

test('rows open their post in the detail view, follows open the profile', async () => {
  const harness = createHarness();
  harness.runtime.mountNotifications({ id: 'n', partition: 'persist:x-0', host: harness.host });
  await flush();
  const row = id => element({ matches: ['.x-native-notif[data-x-notif-id]'], dataset: { xNotifId: id } });
  await harness.host.dispatch('click', event(row('n-like')));
  await flush();
  assert.deepEqual(harness.runs, [['persist:x-0', '1001']]);
  await harness.host.dispatch('click', event(row('n-follow')));
  assert.deepEqual(harness.external, ['https://x.com/carol']);
});

test('a reply in the Column can be liked without a Home page', async () => {
  const harness = createHarness();
  harness.runtime.mountNotifications({ id: 'n', partition: 'persist:x-0', host: harness.host });
  await flush();
  const post = element({ matches: ['[data-x-id]'], dataset: { xId: '2001' } });
  const like = element({ matches: ['[data-x-action]'], dataset: { xAction: 'like' }, parent: post });
  await harness.host.dispatch('click', event(like));
  await flush();
  assert.deepEqual(harness.toggles, [['persist:x-0', '2001', 'like', true]]);
  assert.match(harness.host.innerHTML, /pa lk liked/);
});

test('new notifications show a count on the Column header', async () => {
  const harness = createHarness();
  harness.runtime.mountNotifications({ id: 'n', partition: 'persist:x-0', host: harness.host, badge: harness.badge });
  await flush();
  const newer = { ...items[2], id: 'n-new', indexedAt: '2026-10-06T11:00:00.000Z' };
  harness.runtime.setNotifications('persist:x-0', [newer, ...items]);
  assert.equal(harness.badge.textContent, '+1');
  assert.equal(harness.badge.style.display, '');
  assert.match(harness.host.innerHTML, /data-x-notif-id="n-new"/);
});

test('a signed-out account and muted posts are handled in the Column', async () => {
  const signedOut = createHarness({ known: null, loadError: Object.assign(new Error('login'), { code: 'X_LOGIN_REQUIRED' }) });
  signedOut.runtime.mountNotifications({ id: 'n', partition: 'persist:x-0', host: signedOut.host });
  await flush();
  assert.match(signedOut.host.innerHTML, /ログインしてください/);

  const muted = createHarness({ blocksPost: shape => /reply/.test(shape.post?.record?.text || '') });
  muted.runtime.mountNotifications({ id: 'n', partition: 'persist:x-0', host: muted.host });
  await flush();
  assert.doesNotMatch(muted.host.innerHTML, /data-x-notif-id="post-2001"/);
  assert.match(muted.host.innerHTML, /data-x-notif-id="n-like"/);
});

test('removing the Column stops its listeners and frees the account', async () => {
  const harness = createHarness();
  harness.runtime.mountNotifications({ id: 'n', partition: 'persist:x-0', host: harness.host });
  await flush();
  assert.equal(harness.runtime.has('n'), true);
  harness.runtime.dispose('n');
  assert.equal(harness.runtime.has('n'), false);
  assert.equal(harness.runtime.hasNotificationColumn('persist:x-0'), false);
  assert.equal((harness.host.listeners.click || []).length, 0);
});
