const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'desktop-notification-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckDesktopNotificationRuntime;
}

function loadNotificationCenter() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'notification-center.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckNotificationCenter;
}

function createStorage(initialValue = null) {
  const values = new Map();
  if (initialValue) values.set('socialdeck_desktop_notification_rules', JSON.stringify(initialValue));
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    read: key => JSON.parse(values.get(key)),
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createElement(id = '') {
  const listeners = {};
  const classes = new Set();
  return {
    id,
    checked: false,
    dataset: {},
    textContent: '',
    value: '',
    classList: {
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      contains: name => classes.has(name),
    },
    addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener(type, listener) {
      if (listeners[type] === listener) delete listeners[type];
    },
    dispatch(type, event) { return listeners[type]?.(event); },
  };
}

function notification({
  id,
  networkId = 'b',
  reason = 'reply',
  handle = 'alice.test',
  text = 'hello from Alice',
} = {}) {
  return {
    id,
    networkId,
    reason,
    author: { handle, displayName: handle.split('.')[0] },
    text: networkId === 'x' ? text : undefined,
    raw: networkId === 'b' ? { record: { text } } : { text },
  };
}

test('DOM view renders rules and delegates open, save, and close actions', () => {
  const reasonInputs = ['reply', 'like'].map(reason => {
    const input = createElement();
    input.dataset.desktopNotificationReason = reason;
    return input;
  });
  const ids = [
    'desktopNotifSettingsMod', 'desktop-notif-settings-btn', 'desktop-notif-enabled',
    'desktop-notif-background-only', 'desktop-notif-network-x', 'desktop-notif-network-b',
    'desktop-notif-users', 'desktop-notif-keywords', 'desktop-notif-status',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, createElement(id)]));
  elements.desktopNotifSettingsMod.querySelectorAll = () => reasonInputs;
  const documentRef = { getElementById: id => elements[id] || null };
  const events = [];
  const view = loadModule().createDesktopNotificationDomView({ documentRef });
  view.connect({
    open: () => events.push(['open']),
    close: () => events.push(['close']),
    save: rules => events.push(['save', rules]),
  });
  view.render({
    rules: loadModule().normalizeRules({ enabled: true, reasons: { reply: true, like: false } }),
    error: null,
  });

  const action = name => ({
    dataset: { desktopNotificationAction: name },
    closest: () => ({ dataset: { desktopNotificationAction: name } }),
  });
  elements['desktop-notif-settings-btn'].dispatch('click', { target: action('open') });
  elements.desktopNotifSettingsMod.dispatch('click', { target: action('save') });
  elements.desktopNotifSettingsMod.dispatch('click', { target: action('close') });
  view.setOpen(true);

  assert.equal(elements['desktop-notif-enabled'].checked, true);
  assert.equal(reasonInputs[0].checked, true);
  assert.equal(reasonInputs[1].checked, false);
  assert.equal(elements.desktopNotifSettingsMod.classList.contains('on'), true);
  assert.deepEqual(plain(events), [
    ['open'],
    ['save', {
      enabled: true,
      onlyWhenUnfocused: true,
      networks: { x: true, b: true },
      reasons: { reply: true, like: false },
      users: '',
      keywords: '',
    }],
    ['close'],
  ]);
});

test('normalizes persisted desktop notification rules', () => {
  const model = loadModule();

  assert.deepEqual(plain(model.normalizeRules({
    enabled: true,
    networks: { x: false },
    reasons: { like: true, reply: false },
    users: [' @Alice ', '', '@BOB'],
    keywords: [' release ', ''],
    onlyWhenUnfocused: false,
  })), {
    enabled: true,
    networks: { x: false, b: true },
    reasons: {
      reply: false,
      mention: true,
      quote: true,
      follow: true,
      like: true,
      repost: false,
      other: false,
    },
    onlyWhenUnfocused: false,
    users: ['alice', 'bob'],
    keywords: ['release'],
  });
  assert.equal(model.matchesRules(
    notification({ id: 'unknown', reason: 'starterpack-joined' }),
    model.normalizeRules({ enabled: true, reasons: { other: true } }),
    false,
  ), true);
});

test('baselines existing notifications and emits each later match once', async () => {
  const shown = [];
  let items = [notification({ id: 'old' })];
  const storage = createStorage();
  const runtime = loadModule().createDesktopNotificationRuntime({
    storage,
    fetchItems: async () => items,
    showNotification: payload => shown.push(payload),
    isAppFocused: () => false,
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
  });

  await runtime.start();
  await runtime.updateRules({ enabled: true });
  assert.deepEqual(shown, []);

  items = [notification({ id: 'new' }), ...items];
  const firstPoll = await runtime.poll();
  const secondPoll = await runtime.poll();

  assert.equal(firstPoll.status, 'succeeded');
  assert.equal(firstPoll.emitted, 1);
  assert.equal(secondPoll.emitted, 0);
  assert.equal(shown.length, 1);
  assert.match(shown[0].title, /alice/i);
  assert.match(shown[0].body, /hello from Alice/);
  assert.deepEqual(storage.read('socialdeck_desktop_notification_rules').knownIds.sort(), ['b:new', 'b:old']);
});

test('emits a later X reaction from another actor on the same post', async () => {
  const shown = [];
  const center = loadNotificationCenter();
  const normalize = raw => center.normalizeXNotification(raw, {
    accountIndex: 0,
    account: { username: '@owner' },
  });
  const targetUrl = 'https://x.com/owner/status/123';
  let items = [normalize({
    text: 'Alice liked your post',
    targetUrl,
    profileUrl: 'https://x.com/alice',
    actorName: 'Alice',
    indexedAt: '2026-07-19T00:00:00.000Z',
  })];
  const runtime = loadModule().createDesktopNotificationRuntime({
    storage: createStorage(),
    fetchItems: async () => items,
    showNotification: payload => shown.push(payload),
    isAppFocused: () => false,
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
  });

  await runtime.start();
  await runtime.updateRules({ enabled: true, reasons: { like: true } });
  items = [normalize({
    text: 'Bob liked your post',
    targetUrl,
    profileUrl: 'https://x.com/bob',
    actorName: 'Bob',
    indexedAt: '2026-07-19T00:01:00.000Z',
  }), ...items];

  const outcome = await runtime.poll();

  assert.equal(outcome.emitted, 1);
  assert.equal(shown.length, 1);
  assert.match(shown[0].title, /Bob/);
});

test('applies network, reason, user, keyword, and focus rules without replaying misses', async () => {
  const shown = [];
  let focused = true;
  let items = [];
  const runtime = loadModule().createDesktopNotificationRuntime({
    storage: createStorage(),
    fetchItems: async () => items,
    showNotification: payload => shown.push(payload),
    isAppFocused: () => focused,
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
  });
  await runtime.start();
  await runtime.updateRules({
    enabled: true,
    networks: { x: false, b: true },
    reasons: { reply: true, mention: false, quote: false, follow: false, like: false, repost: false, other: false },
    users: ['alice.test'],
    keywords: ['release'],
    onlyWhenUnfocused: true,
  });

  items = [notification({ id: 'focused', text: 'release now' })];
  await runtime.poll();
  focused = false;
  items = [
    notification({ id: 'wrong-network', networkId: 'x', text: 'release now' }),
    notification({ id: 'wrong-reason', reason: 'like', text: 'release now' }),
    notification({ id: 'wrong-user', handle: 'bob.test', text: 'release now' }),
    notification({ id: 'wrong-keyword', text: 'ordinary update' }),
    notification({ id: 'match', text: 'release completed' }),
    ...items,
  ];
  await runtime.poll();
  await runtime.updateRules({ keywords: [] });
  await runtime.poll();

  assert.equal(shown.length, 1);
  assert.match(shown[0].body, /release completed/);
});

test('persists rules and activates the original notification from a desktop click', async () => {
  const activations = [];
  let activateDesktop;
  let items = [];
  const shown = [];
  const storage = createStorage();
  const runtime = loadModule().createDesktopNotificationRuntime({
    storage,
    fetchItems: async () => items,
    showNotification: payload => shown.push(payload),
    isAppFocused: () => false,
    subscribeActivation: handler => {
      activateDesktop = handler;
      return () => { activateDesktop = null; };
    },
    intents: { activate: item => activations.push(item.id) },
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
  });
  await runtime.start();
  await runtime.updateRules({ enabled: true, onlyWhenUnfocused: false });
  items = [notification({ id: `click-me-${'x'.repeat(500)}` })];
  await runtime.poll();

  assert.ok(shown[0].key.length < 300);
  await activateDesktop(shown[0].key);
  runtime.dispose();

  assert.deepEqual(activations, [`click-me-${'x'.repeat(500)}`]);
  assert.equal(storage.read('socialdeck_desktop_notification_rules').rules.enabled, true);
  assert.equal(activateDesktop, null);
});

test('reports polling failures without losing the existing baseline', async () => {
  const storage = createStorage({
    rules: { enabled: true },
    baselined: true,
    knownIds: ['b:old'],
    knownIdsVersion: 2,
  });
  const runtime = loadModule().createDesktopNotificationRuntime({
    storage,
    fetchItems: async () => { throw new Error('offline'); },
    showNotification() {},
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
  });

  const snapshot = await runtime.start();

  assert.equal(snapshot.error, 'offline');
  assert.deepEqual(storage.read('socialdeck_desktop_notification_rules').knownIds, ['b:old']);
});

test('rebaselines legacy notification identities without replaying existing items', async () => {
  const shown = [];
  const storage = createStorage({
    rules: { enabled: true, onlyWhenUnfocused: false },
    baselined: true,
    knownIds: ['x:0:https%3A%2F%2Fx.com%2Fowner%2Fstatus%2F123'],
  });
  const runtime = loadModule().createDesktopNotificationRuntime({
    storage,
    fetchItems: async () => [notification({ id: 'current-x-item', networkId: 'x' })],
    showNotification: payload => shown.push(payload),
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
  });

  await runtime.start();

  const saved = storage.read('socialdeck_desktop_notification_rules');
  assert.deepEqual(shown, []);
  assert.equal(saved.baselined, true);
  assert.equal(saved.knownIdsVersion, 2);
  assert.deepEqual(saved.knownIds, ['x:current-x-item']);
});

test('rebaselines after the available accounts change', async () => {
  const shown = [];
  let items = [];
  const runtime = loadModule().createDesktopNotificationRuntime({
    storage: createStorage(),
    fetchItems: async () => items,
    showNotification: payload => shown.push(payload),
    isAppFocused: () => false,
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
  });
  await runtime.start();
  await runtime.updateRules({ enabled: true });
  items = [notification({ id: 'new-account-history' })];

  const outcome = await runtime.rebaseline();

  assert.equal(outcome.status, 'baselined');
  assert.deepEqual(shown, []);
});
