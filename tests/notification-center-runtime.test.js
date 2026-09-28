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

  view.setOpen(true);
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
  assert.equal(xSnapshot.unreadOnly, true);
  assert.equal(xSnapshot.canMarkAllRead, false);
  assert.deepEqual(plain(xSnapshot.items.map(item => item.id)), []);
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
      openNotification: item => { calls.push(['open', item.id]); return true; },
    },
  });
  await runtime.reload();

  await runtime.activate(0);
  await runtime.activate(1);
  await runtime.activate(2);

  assert.deepEqual(calls, [
    ['open', 'x:0:x-post'],
    ['open', 'b:post'],
    ['open', 'b:follow'],
  ]);
});

test('failed inline navigation keeps the notification unread and the center open', async () => {
  const calls = [];
  const runtime = loadRuntime().createNotificationCenterRuntime({
    model: createModel(), getSession: () => ({ xAccounts: [{ username: '@first' }] }),
    sources: { listX: async () => [{ id: 'one', reason: 'reply', isRead: false }] },
    view: { setOpen: () => calls.push('visibility') },
    intents: { openNotification: () => false, markXRead: () => calls.push('read'), close: () => calls.push('close') },
  });
  await runtime.reload();
  assert.equal((await runtime.activate(0)).status, 'failed');
  assert.deepEqual(calls, []);
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

test('overlapping reloads share one notification reader request', async () => {
  let finish;
  let reads = 0;
  const runtime = loadRuntime().createNotificationCenterRuntime({
    model: createModel(),
    getSession: () => ({ xAccounts: [{ username: '@me' }] }),
    sources: { listX: () => { reads++; return new Promise(resolve => { finish = resolve; }); } },
  });
  const background = runtime.reload({ background: true });
  const foreground = runtime.reload();
  assert.equal(background, foreground);
  assert.equal(reads, 1);
  finish([]);
  await foreground;
});

test('failed sources retain previous notifications and successful timestamps until retry succeeds', async () => {
  let failed = false;
  let time = '2026-09-09T01:00:00Z';
  const runtime = loadRuntime().createNotificationCenterRuntime({
    model: createModel(), now: () => new Date(time),
    getSession: () => ({ bluesky: true, xAccounts: [{ partition: 'persist:x-0', username: '@first' }, { partition: 'persist:x-1', username: '@second' }] }),
    sources: {
      listBluesky: async () => { if (failed) throw new Error('B offline'); return [{ id: 'b-old' }]; },
      listX: async (_, index) => { if (failed && index === 0) throw new Error('X offline'); return [{ id: `${index}-${failed ? 'new' : 'old'}` }]; },
    },
  });
  const first = await runtime.reload();
  failed = true;
  time = '2026-09-09T01:01:00Z';
  const second = await runtime.reload();
  assert.deepEqual(plain(second.snapshot.items.map(item => item.id)).sort(), ['b:b-old', 'x:0:0-old', 'x:1:1-new']);
  assert.equal(second.snapshot.xStates[0].phase, 'failed');
  assert.equal(second.snapshot.xStates[0].lastSuccess, first.snapshot.xStates[0].lastSuccess);
  assert.equal(second.snapshot.blueskyState.phase, 'failed');
  failed = false;
  const recovered = await runtime.retryX(0);
  assert.equal(recovered.snapshot.xStates[0].phase, 'succeeded');
  assert.equal(recovered.snapshot.xErrors.length, 0);
  assert.equal(recovered.snapshot.blueskyState.phase, 'failed');
});

test('account selection persists by partition, skips disabled fetches, and retains cached items', async () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  let accounts = [{ partition: 'persist:x-0', username: '@first' }, { partition: 'persist:x-1', username: '@second' }];
  const calls = [];
  const make = () => loadRuntime().createNotificationCenterRuntime({ model: createModel(), storage,
    getSession: () => ({ xAccounts: accounts }),
    sources: { listX: async account => { calls.push(account.partition); return [{ id: account.partition }]; } },
  });
  let runtime = make();
  await runtime.reload();
  await runtime.setXEnabled(0, false);
  calls.length = 0;
  const disabled = await runtime.reload();
  assert.deepEqual(calls, ['persist:x-1']);
  assert.equal(disabled.snapshot.items.length, 2);
  assert.equal(disabled.snapshot.xStates[0].phase, 'disabled');
  accounts = accounts.slice().reverse();
  runtime = make();
  calls.length = 0;
  await runtime.reload();
  assert.deepEqual(calls, ['persist:x-1']);
  await runtime.setXEnabled(0, false);
  calls.length = 0;
  await runtime.reload();
  assert.deepEqual(calls, []);
  await runtime.setXEnabled(1, true);
  assert.deepEqual(calls, ['persist:x-0']);
});

test('disabling an account during a fetch does not accept or announce its result', async () => {
  let finish;
  const runtime = loadRuntime().createNotificationCenterRuntime({ model: createModel(),
    getSession: () => ({ xAccounts: [{ partition: 'persist:x-0' }] }),
    sources: { listX: () => new Promise(resolve => { finish = resolve; }) },
  });
  const pending = runtime.reload();
  await runtime.setXEnabled(0, false);
  finish([{ id: 'late' }]);
  const outcome = await pending;
  assert.equal(outcome.snapshot.items.length, 0);
  assert.equal(outcome.snapshot.xStates[0].phase, 'disabled');
});

test('unread and display filters survive reopening and restarting the notification center', async () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const make = () => loadRuntime().createNotificationCenterRuntime({ model: createModel(), storage });
  const runtime = make();
  runtime.setNetwork('x');
  runtime.setFilters({ reason: 'like', unreadOnly: true });
  const reopened = await runtime.open();
  assert.equal(reopened.snapshot.unreadOnly, true);
  assert.equal(reopened.snapshot.reason, 'like');
  assert.equal(reopened.snapshot.network, 'x');
  const restarted = await make().open();
  assert.equal(restarted.snapshot.unreadOnly, true);
  assert.equal(restarted.snapshot.reason, 'like');
  assert.equal(restarted.snapshot.network, 'x');
});

test('a full reload requested during account retry also fetches the other accounts', async () => {
  const calls = [];
  let finish;
  const runtime = loadRuntime().createNotificationCenterRuntime({ model: createModel(),
    getSession: () => ({ xAccounts: [{ username: '@first' }, { username: '@second' }] }),
    sources: { listX: async (_, index) => {
      calls.push(index);
      if (calls.length === 1) return new Promise(resolve => { finish = resolve; });
      return [];
    } },
  });
  const retry = runtime.retryX(0);
  const full = runtime.reload();
  finish([]);
  await Promise.all([retry, full]);
  assert.ok(calls.includes(1));
});

test('toast navigation does not overwrite saved display filters', async () => {
  const runtime = loadRuntime().createNotificationCenterRuntime({ model: createModel() });
  runtime.setNetwork('b');
  runtime.setFilters({ reason: 'like', unreadOnly: false });
  const toast = await runtime.open({ network: 'x', reason: 'all', unreadOnly: true });
  assert.equal(toast.snapshot.unreadOnly, true);
  const normal = await runtime.open();
  assert.equal(normal.snapshot.unreadOnly, false);
  assert.equal(normal.snapshot.network, 'b');
  assert.equal(normal.snapshot.reason, 'like');
});

test('invalid saved filter values fall back to usable defaults', async () => {
  const runtime = loadRuntime().createNotificationCenterRuntime({ model: createModel(),
    storage: { getItem: () => '{"network":"missing","reason":"missing","unreadOnly":"false"}' },
  });
  const { snapshot } = await runtime.open();
  assert.equal(snapshot.network, 'all');
  assert.equal(snapshot.reason, 'all');
  assert.equal(snapshot.unreadOnly, false);
});

test('DOM view defers closed rendering and does not replace unchanged rows', () => {
  const modal = createElement();
  const list = createElement();
  let writes = 0;
  let html = '';
  Object.defineProperty(list, 'innerHTML', { get: () => html, set: value => { html = value; writes++; } });
  const view = loadRuntime().createNotificationCenterDomView({ documentRef: {
    getElementById: id => id === 'notifCenterMod' ? modal : id === 'notif-center-list' ? list : null,
    querySelector: () => null, querySelectorAll: () => [],
  } });
  const snapshot = { network: 'x', xAccounts: [], items: [{ id: 'one', networkId: 'x', text: 'hello' }], xErrors: [] };
  view.render(snapshot);
  assert.equal(writes, 0);
  view.setOpen(true);
  assert.equal(writes, 1);
  view.render(snapshot);
  assert.equal(writes, 1);
  view.setOpen(false);
  view.render({ ...snapshot, items: [{ id: 'two', networkId: 'x', text: 'latest' }] });
  assert.equal(writes, 1);
  view.setOpen(true);
  assert.equal(writes, 2);
  assert.match(html, /latest/);
});
