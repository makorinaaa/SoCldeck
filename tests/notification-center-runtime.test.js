const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRuntime() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'notification-center-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckNotificationCenterRuntime;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createModel() {
  return {
    normalizeBskyNotification(item) {
      return { ...item, id: `b:${item.id}`, networkId: 'b' };
    },
    normalizeXNotification(item, context) {
      return { ...item, id: `x:${context.accountIndex}:${item.id}`, networkId: 'x', ...context };
    },
    filterNotifications(items, { reason, unreadOnly }) {
      return items.filter(item => (reason === 'all' || item.reason === reason)
        && (!unreadOnly || item.isRead === false));
    },
  };
}

function createElement() {
  const classes = new Set();
  return {
    innerHTML: '',
    checked: false,
    disabled: false,
    value: 'all',
    classList: {
      toggle(name, force) {
        if (force) classes.add(name); else classes.delete(name);
      },
      contains: name => classes.has(name),
    },
    addEventListener() {},
    removeEventListener() {},
  };
}

test('DOM view renders notification controls without inline handlers', () => {
  const elements = {
    notifCenterMod: createElement(),
    'notif-center-list': createElement(),
    'notif-center-x': createElement(),
    'notif-center-reason': createElement(),
    'notif-center-unread': createElement(),
  };
  const markRead = createElement();
  const tabs = ['all', 'x', 'b'].map(network => ({ ...createElement(), dataset: { network } }));
  const documentRef = {
    getElementById: id => elements[id] || null,
    querySelector: selector => selector === '.notif-center-tools .mark-read' ? markRead : null,
    querySelectorAll: selector => selector === '.notif-center-tab' ? tabs : [],
  };
  const view = loadRuntime().createNotificationCenterDomView({
    documentRef,
    ui: {
      escape: value => String(value),
      renderAvatar: actor => `<span class="avatar">${actor.displayName}</span>`,
      relativeTime: () => 'now',
      avatarBackground: () => '#123456',
    },
  });

  view.render({
    network: 'all',
    reason: 'all',
    unreadOnly: false,
    loading: false,
    items: [{
      id: 'b:1', networkId: 'b', reason: 'reply', isRead: false,
      indexedAt: '2026-07-16T01:00:00Z', author: { displayName: 'Alice', handle: 'alice.test' },
      raw: { record: { text: 'hello' } },
    }],
    xAccounts: [{ username: '@first', initials: 'F', bg: '#334455' }],
    hasBluesky: true,
    xErrors: [],
    blueskyError: null,
    unreadFilterEnabled: true,
    canMarkAllRead: true,
  });

  assert.match(elements['notif-center-list'].innerHTML, /data-notification-index="0"/);
  assert.match(elements['notif-center-list'].innerHTML, /Alice/);
  assert.match(elements['notif-center-x'].innerHTML, /data-x-account-index="0"/);
  assert.doesNotMatch(elements['notif-center-list'].innerHTML, /\sonclick=/);
  assert.doesNotMatch(elements['notif-center-x'].innerHTML, /\sonclick=/);
  assert.equal(elements['notif-center-x'].classList.contains('show'), true);
  assert.equal(markRead.disabled, false);
});

test('opens by loading both networks and exposes a sorted display snapshot', async () => {
  const renders = [];
  const runtime = loadRuntime().createNotificationCenterRuntime({
    model: createModel(),
    getSession: () => ({ bluesky: true, xAccounts: [{ username: '@first' }] }),
    sources: {
      listBluesky: async () => [{ id: 'old', reason: 'reply', indexedAt: '2026-07-16T01:00:00Z', isRead: false }],
      listX: async () => [{ id: 'new', reason: 'like', indexedAt: '2026-07-16T02:00:00Z', isRead: null }],
    },
    view: {
      setOpen: value => renders.push({ open: value }),
      render: snapshot => renders.push(plain(snapshot)),
    },
  });

  const outcome = await runtime.open();

  assert.equal(outcome.status, 'succeeded');
  assert.deepEqual(plain(outcome.snapshot.items.map(item => item.id)), ['x:0:new', 'b:old']);
  assert.equal(outcome.snapshot.network, 'all');
  assert.equal(outcome.snapshot.loading, false);
  assert.deepEqual(renders[0], { open: true });
  assert.equal(renders.at(-1).items.length, 2);
});

test('filters the loaded notifications without reloading their sources', async () => {
  let reads = 0;
  const runtime = loadRuntime().createNotificationCenterRuntime({
    model: createModel(),
    getSession: () => ({ bluesky: true, xAccounts: [{ username: '@first' }] }),
    sources: {
      listBluesky: async () => {
        reads += 1;
        return [
          { id: 'unread-like', reason: 'like', indexedAt: '2026-07-16T02:00:00Z', isRead: false },
          { id: 'read-like', reason: 'like', indexedAt: '2026-07-16T01:00:00Z', isRead: true },
        ];
      },
      listX: async () => {
        reads += 1;
        return [{ id: 'x-like', reason: 'like', indexedAt: '2026-07-16T03:00:00Z', isRead: null }];
      },
    },
  });

  await runtime.reload();
  runtime.setNetwork('b');
  const snapshot = runtime.setFilters({ reason: 'like', unreadOnly: true });

  assert.equal(reads, 2);
  assert.deepEqual(plain(snapshot.items.map(item => item.id)), ['b:unread-like']);
  assert.equal(snapshot.canMarkAllRead, true);
  assert.equal(snapshot.unreadFilterEnabled, true);

  const xSnapshot = runtime.setNetwork('x');
  assert.equal(xSnapshot.unreadOnly, false);
  assert.equal(xSnapshot.canMarkAllRead, false);
  assert.deepEqual(plain(xSnapshot.items.map(item => item.id)), ['x:0:x-like']);
  assert.deepEqual(plain(runtime.getAllItems().map(item => item.id)), [
    'x:0:x-like',
    'b:unread-like',
    'b:read-like',
  ]);
});

test('activates notifications through semantic navigation intents', async () => {
  const calls = [];
  const runtime = loadRuntime().createNotificationCenterRuntime({
    model: createModel(),
    getSession: () => ({ bluesky: true, xAccounts: [{ username: '@first' }] }),
    sources: {
      listBluesky: async () => [
        { id: 'post', reason: 'like', indexedAt: '2026-07-16T02:00:00Z', targetUri: 'at://post/1', author: { handle: 'alice.test' } },
        { id: 'follow', reason: 'follow', indexedAt: '2026-07-16T01:00:00Z', author: { did: 'did:plc:alice' } },
      ],
      listX: async () => [{ id: 'x-post', reason: 'reply', indexedAt: '2026-07-16T03:00:00Z' }],
    },
    intents: {
      close: () => calls.push(['close']),
      openXNotification: item => calls.push(['x', item.id]),
      openBlueskyPost: item => calls.push(['post', item.targetUri]),
      openBlueskyProfile: item => calls.push(['profile', item.author.did]),
    },
  });
  await runtime.reload();

  await runtime.activate(0);
  await runtime.activate(1);
  await runtime.activate(2);

  assert.deepEqual(calls, [
    ['close'], ['x', 'x:0:x-post'],
    ['close'], ['post', 'at://post/1'],
    ['close'], ['profile', 'did:plc:alice'],
  ]);
});

test('marks Bluesky notifications read using one captured timestamp', async () => {
  const calls = [];
  const runtime = loadRuntime().createNotificationCenterRuntime({
    model: createModel(),
    getSession: () => ({ bluesky: true, xAccounts: [] }),
    now: () => new Date('2026-07-16T04:05:06.000Z'),
    sources: {
      listBluesky: async () => [{ id: 'unread', reason: 'reply', indexedAt: '2026-07-16T01:00:00Z', isRead: false }],
      listX: async () => [],
      markBlueskySeen: async timestamp => calls.push(['seen', timestamp]),
    },
    intents: {
      clearUnread: () => calls.push(['clear']),
      toast: message => calls.push(['toast', message]),
    },
  });
  await runtime.reload();

  const outcome = await runtime.markAllRead();

  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.snapshot.items[0].isRead, true);
  assert.deepEqual(calls, [
    ['seen', '2026-07-16T04:05:06.000Z'],
    ['clear'],
    ['toast', 'Bluesky通知をすべて既読にしました'],
  ]);
});
