const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'account-session-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckAccountSessionRuntime;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStateAdapter(initialState) {
  let state = structuredClone(initialState);
  return {
    get: () => state,
    commit(nextState) {
      state = structuredClone(nextState);
      return state;
    },
  };
}

function createElement(id = '') {
  const listeners = {};
  const classes = new Set();
  return {
    id,
    className: '',
    dataset: {},
    disabled: false,
    innerHTML: '',
    style: {},
    textContent: '',
    value: '',
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle(name, force) {
        if (force) classes.add(name); else classes.delete(name);
      },
      contains: name => classes.has(name),
    },
    addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener(type, listener) {
      if (listeners[type] === listener) delete listeners[type];
    },
    dispatch(type, event) {
      event.currentTarget = this;
      return listeners[type]?.(event);
    },
  };
}

test('DOM view delegates account actions and renders account presentation without inline handlers', () => {
  const ids = [
    'login-screen', 'x-user', 'b-user', 'b-pass', 'x-status', 'b-status',
    'x-err', 'b-err', 'x-login-btn', 'b-login-btn', 'b-logout-btn', 'lenter',
    'lfoot-msg', 'nav-chips', 'sb-avs', 'amenu-items', 'amenu',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, createElement(id)]));
  const documentRef = { getElementById: id => elements[id] || null };
  elements['x-user'].value = 'alice';
  elements['b-user'].value = 'bob.test';
  elements['b-pass'].value = 'app-password';
  const events = [];
  const view = loadModule().createAccountSessionDomView({
    documentRef,
    escape: value => String(value),
  });
  view.connect({
    enter: () => events.push(['enter']),
    login: (network, credentials) => events.push(['login', network, credentials]),
    logout: (network, accountIndex) => events.push(['logout', network, accountIndex]),
    logoutAll: () => events.push(['logout-all']),
    openSettings: () => events.push(['open-settings']),
  });

  elements['login-screen'].dispatch('click', { target: elements['x-login-btn'] });
  elements['login-screen'].dispatch('click', { target: elements['b-login-btn'] });
  elements['login-screen'].dispatch('click', { target: elements['b-logout-btn'] });
  elements['login-screen'].dispatch('click', { target: elements.lenter });
  const removeButton = createElement();
  removeButton.dataset = { accountAction: 'logout-x', accountIndex: '1' };
  elements['login-screen'].dispatch('click', { target: removeButton });
  const logoutAllButton = createElement();
  logoutAllButton.dataset = { accountAction: 'logout-all' };
  elements.amenu.dispatch('click', { target: logoutAllButton });

  assert.deepEqual(plain(events), [
    ['login', 'x', { displayName: 'alice' }],
    ['login', 'b', { handle: 'bob.test', password: 'app-password' }],
    ['logout', 'b', null],
    ['enter'],
    ['logout', 'x', 1],
    ['logout-all'],
  ]);

  view.render({
    xAccounts: [{ username: '@alice', initials: 'AL', bg: '#123456' }],
    blueskyAccount: {
      handle: 'bob.test', displayName: 'Bob', initials: 'BO', bg: '#654321', avatar: null,
    },
    canEnter: true,
    connectedLabel: 'X(1) + Bluesky connected',
    busy: false,
    error: null,
  });
  assert.match(elements['x-status'].innerHTML, /data-account-action="logout-x"/);
  assert.match(elements['nav-chips'].innerHTML, /@alice/);
  assert.match(elements['amenu-items'].innerHTML, /bob\.test/);
  assert.doesNotMatch(
    `${elements['x-status'].innerHTML}${elements['nav-chips'].innerHTML}${elements['sb-avs'].innerHTML}${elements['amenu-items'].innerHTML}`,
    /\sonclick=/,
  );

  elements.amenu.classList.add('open');
  view.setSettingsOpen(true);
  assert.equal(elements.amenu.classList.contains('open'), false);
  assert.equal(elements['login-screen'].classList.contains('hidden'), false);
});

test('starts from persisted accounts and publishes one Account Session snapshot', async () => {
  const renders = [];
  let handlers;
  const runtime = loadModule().createAccountSessionRuntime({
    state: createStateAdapter({
      xs: [{ username: '@alice', partition: 'persist:x-0' }],
      activeX: 0,
      b: { handle: 'bob.test', did: 'did:plc:bob' },
      composePreferences: {},
    }),
    view: {
      connect: nextHandlers => { handlers = nextHandlers; },
      render: snapshot => renders.push(plain(snapshot)),
    },
  });

  const snapshot = await runtime.start();

  assert.equal(typeof handlers.login, 'function');
  assert.deepEqual(plain(snapshot.xAccounts), [
    { username: '@alice', partition: 'persist:x-0' },
  ]);
  assert.equal(snapshot.blueskyAccount.handle, 'bob.test');
  assert.equal(snapshot.canEnter, true);
  assert.equal(snapshot.connectedLabel, 'X(1) + Bluesky connected');
  assert.equal(snapshot.busy, false);
  assert.equal(snapshot.error, null);
  assert.deepEqual(renders, [plain(snapshot)]);

  runtime.refresh();
  assert.equal(renders.length, 2);
});

test('start synchronizes persisted X sessions before it becomes ready', async () => {
  const events = [];
  const runtime = loadModule().createAccountSessionRuntime({
    state: createStateAdapter({
      xs: [{ username: '@alice', partition: 'persist:x-0' }],
      activeX: 0,
      b: null,
    }),
    xSession: {
      sync: async accounts => events.push(['sync', accounts.map(account => account.partition)]),
    },
    view: {
      connect: () => events.push(['connect']),
      render: () => events.push(['render']),
    },
  });

  const snapshot = await runtime.start();

  assert.equal(snapshot.xAccounts.length, 1);
  assert.deepEqual(plain(events), [
    ['connect'],
    ['render'],
    ['sync', ['persist:x-0']],
  ]);
});

test('adds an X account through one ordered session lifecycle', async () => {
  const events = [];
  const stateAdapter = createStateAdapter({
    xs: [{ username: '@first', partition: 'persist:x-0' }],
    activeX: 0,
    b: null,
    composePreferences: { crossPostFromX: true },
  });
  const runtime = loadModule().createAccountSessionRuntime({
    state: {
      get: stateAdapter.get,
      commit(nextState) {
        events.push(['commit', nextState.xs.map(account => account.partition)]);
        return stateAdapter.commit(nextState);
      },
    },
    xSession: {
      initializeTheme: async partition => events.push(['theme', partition]),
      sync: async accounts => events.push(['sync', accounts.map(account => account.partition)]),
    },
    getAvatarBackground: index => `background-${index}`,
    view: {
      clearCredentials: network => events.push(['clear-credentials', network]),
      render() {},
    },
    intents: {
      accountsChanged: detail => events.push(['changed', detail.network, detail.kind]),
    },
  });
  await runtime.start();
  events.length = 0;

  const outcome = await runtime.login('x', { displayName: '  @second  ' });

  assert.equal(outcome.status, 'authenticated');
  assert.deepEqual(plain(outcome.account), {
    username: '@second',
    initials: 'SE',
    bg: 'background-1',
    partition: 'persist:x-1',
    loginPending: true,
  });
  assert.deepEqual(plain(events), [
    ['theme', 'persist:x-1'],
    ['commit', ['persist:x-0', 'persist:x-1']],
    ['sync', ['persist:x-0', 'persist:x-1']],
    ['clear-credentials', 'x'],
    ['changed', 'x', 'login'],
  ]);
  assert.equal(stateAdapter.get().activeX, 1);
  assert.equal(stateAdapter.get().composePreferences.crossPostFromX, true);
  assert.equal(runtime.getSnapshot().busy, false);
});

test('rejects missing and duplicate X display names before touching the session', async () => {
  const sessionCalls = [];
  const runtime = loadModule().createAccountSessionRuntime({
    state: createStateAdapter({
      xs: [{ username: '@alice', partition: 'persist:x-0' }],
      activeX: 0,
      b: null,
    }),
    xSession: {
      initializeTheme: partition => sessionCalls.push(['theme', partition]),
      sync: accounts => sessionCalls.push(['sync', accounts.length]),
    },
    view: { render() {} },
  });
  await runtime.start();
  sessionCalls.length = 0;

  const missing = await runtime.login('x', { displayName: '   ' });
  const duplicate = await runtime.login('x', { displayName: '@alice' });

  assert.equal(missing.status, 'rejected');
  assert.equal(missing.reason, 'display-name-required');
  assert.equal(duplicate.status, 'rejected');
  assert.equal(duplicate.reason, 'duplicate-account');
  assert.deepEqual(sessionCalls, []);
  assert.deepEqual(plain(runtime.getSnapshot().error), {
    network: 'x',
    message: 'This account is already registered',
  });
});

test('keeps X theme initialization failures non-fatal', async () => {
  const stateAdapter = createStateAdapter({ xs: [], activeX: 0, b: null });
  const runtime = loadModule().createAccountSessionRuntime({
    state: stateAdapter,
    xSession: {
      initializeTheme: async () => { throw new Error('theme unavailable'); },
      sync() {},
    },
    view: { render() {} },
  });
  await runtime.start();

  const outcome = await runtime.login('x', { displayName: 'alice' });

  assert.equal(outcome.status, 'authenticated');
  assert.equal(stateAdapter.get().xs[0].username, '@alice');
});

test('ignores overlapping mutations and mutations after disposal', async () => {
  let releaseTheme;
  const themeReady = new Promise(resolve => { releaseTheme = resolve; });
  const stateAdapter = createStateAdapter({ xs: [], activeX: 0, b: null });
  const runtime = loadModule().createAccountSessionRuntime({
    state: stateAdapter,
    xSession: {
      initializeTheme: () => themeReady,
      sync() {},
    },
    view: { dispose() {}, render() {} },
  });
  await runtime.start();

  const firstLogin = runtime.login('x', { displayName: 'alice' });
  const overlappingLogin = await runtime.login('x', { displayName: 'bob' });
  const overlappingLogout = await runtime.logoutAll();
  releaseTheme();
  await firstLogin;
  runtime.dispose();
  const disposedLogin = await runtime.login('x', { displayName: 'carol' });

  assert.deepEqual(plain(overlappingLogin), { status: 'ignored', detail: 'busy' });
  assert.deepEqual(plain(overlappingLogout), { status: 'ignored', detail: 'busy' });
  assert.deepEqual(plain(disposedLogin), { status: 'ignored', detail: 'disposed' });
  assert.deepEqual(stateAdapter.get().xs.map(account => account.username), ['@alice']);
});

test('removes an X account only after confirmation and resynchronizes sessions', async () => {
  const events = [];
  const stateAdapter = createStateAdapter({
    xs: [
      { username: '@first', partition: 'persist:x-0' },
      { username: '@second', partition: 'persist:x-1' },
      { username: '@third', partition: 'persist:x-2' },
    ],
    activeX: 1,
    b: null,
    composePreferences: {},
  });
  const runtime = loadModule().createAccountSessionRuntime({
    state: {
      get: stateAdapter.get,
      commit(nextState) {
        events.push(['commit', nextState.activeX]);
        return stateAdapter.commit(nextState);
      },
    },
    xSession: {
      clear: async partition => events.push(['clear', partition]),
      sync: async accounts => events.push(['sync', accounts.map(account => account.username)]),
    },
    view: { render() {} },
    intents: {
      confirmLogout: account => {
        events.push(['confirm', account.username]);
        return true;
      },
      accountsChanged: detail => events.push(['changed', detail.network, detail.kind]),
    },
  });
  await runtime.start();
  events.length = 0;

  const outcome = await runtime.logout('x', 0);

  assert.equal(outcome.status, 'logged-out');
  assert.deepEqual(plain(events), [
    ['confirm', '@first'],
    ['clear', 'persist:x-0'],
    ['commit', 0],
    ['sync', ['@second', '@third']],
    ['changed', 'x', 'logout'],
  ]);
  assert.deepEqual(plain(stateAdapter.get().xs), [
    { username: '@second', partition: 'persist:x-1' },
    { username: '@third', partition: 'persist:x-2' },
  ]);
});

test('authenticates Bluesky and commits only its public Network Account', async () => {
  const events = [];
  const stateAdapter = createStateAdapter({
    xs: [],
    activeX: 0,
    b: null,
    composePreferences: {},
  });
  const runtime = loadModule().createAccountSessionRuntime({
    state: stateAdapter,
    bluesky: {
      async login(handle, password) {
        events.push(['login', handle, password]);
        return {
          handle: 'alice.test',
          did: 'did:plc:alice',
          displayName: 'Alice',
          avatar: 'https://cdn.test/alice.jpg',
        };
      },
    },
    getBlueskyBackground: handle => `background:${handle}`,
    view: {
      clearCredentials: network => events.push(['clear-credentials', network]),
      render() {},
    },
    intents: {
      accountsChanged: detail => events.push(['changed', detail.network, detail.kind]),
    },
  });
  await runtime.start();

  const outcome = await runtime.login('b', {
    handle: ' alice.test ',
    password: 'app-password',
  });

  assert.equal(outcome.status, 'authenticated');
  assert.deepEqual(plain(stateAdapter.get().b), {
    handle: 'alice.test',
    did: 'did:plc:alice',
    displayName: 'Alice',
    avatar: 'https://cdn.test/alice.jpg',
    initials: 'AL',
    bg: 'background:alice.test',
  });
  assert.equal(JSON.stringify(stateAdapter.get()).includes('app-password'), false);
  assert.deepEqual(events, [
    ['login', 'alice.test', 'app-password'],
    ['clear-credentials', 'b'],
    ['changed', 'b', 'login'],
  ]);
});

test('logs out Bluesky while preserving X accounts and preferences', async () => {
  const events = [];
  const stateAdapter = createStateAdapter({
    xs: [{ username: '@alice', partition: 'persist:x-0' }],
    activeX: 0,
    b: { handle: 'bob.test', did: 'did:plc:bob' },
    composePreferences: { crossPostFromX: true },
  });
  const runtime = loadModule().createAccountSessionRuntime({
    state: stateAdapter,
    bluesky: {
      clearSession: async () => events.push(['clear-vault']),
    },
    view: { render() {} },
    intents: {
      accountsChanged: detail => events.push([detail.network, detail.kind]),
    },
  });
  await runtime.start();

  const outcome = await runtime.logout('b');

  assert.equal(outcome.status, 'logged-out');
  assert.equal(stateAdapter.get().b, null);
  assert.equal(stateAdapter.get().xs[0].username, '@alice');
  assert.equal(stateAdapter.get().composePreferences.crossPostFromX, true);
  assert.deepEqual(events, [['clear-vault'], ['b', 'logout']]);
});

test('logs out every account and requests host workspace cleanup', async () => {
  const events = [];
  const stateAdapter = createStateAdapter({
    xs: [{ username: '@alice', partition: 'persist:x-0' }],
    activeX: 0,
    b: { handle: 'bob.test', did: 'did:plc:bob' },
    composePreferences: { crossPostFromX: true, crossPostFromBluesky: false },
  });
  const runtime = loadModule().createAccountSessionRuntime({
    state: stateAdapter,
    createDefaultState: () => ({
      xs: [], activeX: 0, b: null,
      composePreferences: { crossPostFromX: false, crossPostFromBluesky: false },
    }),
    xSession: {
      clearAll: async () => events.push('clear-all-sessions'),
      sync: async accounts => events.push(['sync', accounts.length]),
    },
    bluesky: {
      clearSession: async () => events.push('clear-vault'),
    },
    view: { render() {} },
    intents: {
      confirmLogoutAll: () => {
        events.push('confirm');
        return true;
      },
      workspaceResetRequested: async () => events.push('reset-workspace'),
      accountsChanged: detail => events.push(['changed', detail.network, detail.kind]),
    },
  });
  await runtime.start();
  events.length = 0;

  const outcome = await runtime.logoutAll();

  assert.equal(outcome.status, 'logged-out');
  assert.deepEqual(plain(stateAdapter.get()), {
    xs: [], activeX: 0, b: null,
    composePreferences: { crossPostFromX: true, crossPostFromBluesky: false },
  });
  assert.deepEqual(events, [
    'confirm',
    'clear-all-sessions',
    'clear-vault',
    ['sync', 0],
    'reset-workspace',
    ['changed', 'all', 'logout'],
  ]);
});

test('owns settings visibility and disposes its View connection', async () => {
  const events = [];
  let handlers;
  const runtime = loadModule().createAccountSessionRuntime({
    state: createStateAdapter({ xs: [], activeX: 0, b: null }),
    view: {
      connect: nextHandlers => {
        handlers = nextHandlers;
        events.push(['connect', Boolean(nextHandlers)]);
      },
      dispose: () => events.push(['dispose']),
      render: () => events.push(['render']),
      setSettingsOpen: open => events.push(['settings', open]),
    },
    intents: { enterRequested: () => events.push(['enter-requested']) },
  });
  await runtime.start();

  const opened = runtime.openSettings();
  await handlers.enter();
  const disposed = runtime.dispose();
  const reopen = runtime.openSettings();

  assert.equal(opened.status, 'opened');
  assert.equal(disposed.status, 'disposed');
  assert.deepEqual(plain(reopen), { status: 'ignored', detail: 'disposed' });
  assert.deepEqual(events.slice(-6), [
    ['settings', true],
    ['render'],
    ['settings', false],
    ['enter-requested'],
    ['dispose'],
    ['connect', false],
  ]);
});
