const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createWebView({ id = '', partition = '', src = '' } = {}) {
  const listeners = new Map();
  return {
    id,
    partition,
    src,
    style: { display: 'flex', opacity: '' },
    dataset: { ready: 'true' },
    classList: { toggle() {} },
    scripts: [],
    loads: [],
    setAttribute(name, value) {
      this[name] = value;
    },
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    emit(name, event = {}) {
      listeners.get(name)?.(event);
    },
    executeJavaScript(script) {
      this.scripts.push(script);
      return Promise.resolve('home-clicked');
    },
    loadURL(url) {
      this.loads.push(url);
      this.src = url;
      return Promise.resolve();
    },
    reload() {
      this.reloadCount = (this.reloadCount || 0) + 1;
    },
    getURL() { return this.src; },
    canGoBack() { return false; },
    insertCSS() { return Promise.resolve(); },
    openDevTools() { this.devToolsOpened = (this.devToolsOpened || 0) + 1; },
    remove() { this.removed = true; },
  };
}

function createHarness({ loginPending = false, loginGate = null, allowDevTools = false } = {}) {
  const elements = new Map();
  const webviews = [];
  const columns = [];
  const documentRef = {
    createElement(name) {
      assert.equal(name, 'webview');
      const webview = createWebView();
      webviews.push(webview);
      return webview;
    },
    getElementById(id) { return elements.get(id) || null; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === 'webview') return webviews;
      if (selector === '.col') return columns;
      return [];
    },
  };
  const context = {
    URL,
    window: {
      URL,
      document: documentRef,
      localStorage: { getItem: () => null },
      setTimeout,
      clearTimeout,
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'x-webview-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  const runtime = context.window.SocialDeckXWebViewRuntime.createXWebViewRuntime({
    documentRef,
    storage: context.window.localStorage,
    loginGate: loginGate || {
      register: () => loginPending,
      isActive: () => false,
      observe: () => [],
      unregister: () => [],
    },
    isLoginPending: () => loginPending,
    createRefreshScript: destination => `refresh:${destination}`,
    getCanonicalUrl: id => id.includes('notif') ? 'https://x.com/notifications' : null,
    getPreloadPath: () => 'file:///preload.js',
    allowDevTools,
    setTimeoutFn: fn => { fn(); return 1; },
    clearTimeoutFn() {},
  });
  return { runtime, elements, webviews, columns };
}

test('opens X WebView DevTools only when the host explicitly allows development tools', () => {
  const blocked = createHarness();
  const blockedView = createWebView({ src: 'https://x.com/home' });
  blocked.webviews.push(blockedView);
  assert.equal(blocked.runtime.openDevTools(), false);
  assert.equal(blockedView.devToolsOpened, undefined);

  const allowed = createHarness({ allowDevTools: true });
  const allowedView = createWebView({ src: 'https://x.com/home' });
  allowed.webviews.push(allowedView);
  assert.equal(allowed.runtime.openDevTools(), true);
  assert.equal(allowedView.devToolsOpened, 1);
});

test('mounts an X Column behind the login gate and activates it when ready', () => {
  const { runtime, elements } = createHarness();
  const host = {
    insertBefore(webview) { elements.set(webview.id, webview); },
  };
  const loading = { style: {}, innerHTML: '', querySelector: () => null };
  elements.set('wvload-x-home', loading);

  const webview = runtime.mountColumn({
    id: 'x-home',
    networkId: 'x',
    partition: 'persist:x-0',
    targetUrl: 'https://x.com/home',
    host,
    preloadPath: 'file:///preload.js',
  });
  webview.emit('dom-ready');

  assert.equal(webview.partition, 'persist:x-0');
  assert.equal(webview.preload, 'file:///preload.js');
  assert.equal(webview.dataset.ready, 'true');
  assert.equal(webview.style.display, 'flex');
  assert.equal(loading.style.display, 'none');
});

test('awaits canonical notification navigation when going back', async () => {
  const { runtime, elements } = createHarness();
  const notification = createWebView({
    id: 'wv-x-notif',
    src: 'https://x.com/socialdeck/status/123',
  });
  elements.set(notification.id, notification);

  assert.equal(await runtime.back('x-notif'), true);
  assert.deepEqual(notification.loads, ['https://x.com/notifications']);
  assert.equal(notification.src, 'https://x.com/notifications');
});

test('executes Compose through the account Home Column and flushes queued refresh', async () => {
  const { runtime, webviews, elements } = createHarness();
  const home = createWebView({
    id: 'wv-x-home',
    partition: 'persist:x-0',
    src: 'https://x.com/home',
  });
  webviews.push(home);
  elements.set(home.id, home);
  elements.set('col-x-home', { dataset: { definitionId: 'x-home-new' } });
  runtime.syncAccounts([{ username: '@alice', partition: 'persist:x-0' }]);

  let release;
  const delivery = runtime.executeCompose(
    { accountId: '@alice' },
    { videoPath: null },
    async (request, context) => {
      assert.equal(context.webview, home);
      await new Promise(resolve => { release = resolve; });
      return request.accountId;
    },
  );
  await Promise.resolve();
  assert.equal(await runtime.refreshNavigation('x-home'), 'queued');
  release();
  assert.equal(await delivery, '@alice');
  assert.deepEqual(home.scripts, ['refresh:home']);
});

test('does not create a hidden notification reader while login is pending', async () => {
  const { runtime, webviews } = createHarness({ loginPending: true });
  runtime.syncAccounts([{
    username: '@alice',
    partition: 'persist:x-0',
    loginPending: true,
  }]);

  const items = await runtime.listNotifications({
    accountId: '@alice',
    host: { appendChild() { throw new Error('must not mount'); } },
    script: 'extract',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(items)), []);
  assert.equal(webviews.length, 0);
});

test('removes hidden readers that no longer match a Network Account', () => {
  const { runtime, webviews } = createHarness();
  const active = createWebView({
    id: 'x-notif-reader-0', partition: 'persist:x-0', src: 'https://x.com/notifications',
  });
  const stale = createWebView({
    id: 'x-notif-reader-1', partition: 'persist:x-1', src: 'https://x.com/notifications',
  });
  webviews.push(active, stale);

  runtime.syncAccounts([{ username: '@alice', partition: 'persist:x-0' }]);

  assert.equal(active.removed, undefined);
  assert.equal(stale.removed, true);
});

test('reuses a visible notification Column for extraction', async () => {
  const { runtime, columns, elements } = createHarness();
  const notificationWebView = createWebView({
    partition: 'persist:x-0',
    src: 'https://x.com/notifications',
  });
  notificationWebView.executeJavaScript = async script => [{ script }];
  const hiddenReader = createWebView({
    id: 'x-notif-reader-0',
    partition: 'persist:x-0',
    src: 'https://x.com/notifications',
  });
  elements.set(hiddenReader.id, hiddenReader);
  columns.push({
    dataset: { definitionId: 'x-notif-new' },
    querySelector: () => notificationWebView,
  });
  runtime.syncAccounts([{ username: '@alice', partition: 'persist:x-0' }]);

  const items = await runtime.listNotifications({
    accountId: '@alice',
    host: null,
    script: 'extract',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(items)), [{ script: 'extract' }]);
  assert.equal(hiddenReader.removed, true);
});

test('uses a hidden reader when the visible notification Column shows a post', async () => {
  const { runtime, columns, webviews } = createHarness();
  const detailWebView = createWebView({
    partition: 'persist:x-0',
    src: 'https://x.com/alice/status/123',
  });
  columns.push({
    dataset: { definitionId: 'x-notif-new' },
    querySelector: () => detailWebView,
  });
  runtime.syncAccounts([{ username: '@alice', partition: 'persist:x-0' }]);
  const host = {
    appendChild(webview) {
      webview.executeJavaScript = async script => [{ script }];
    },
  };

  const items = await runtime.listNotifications({
    accountId: '@alice',
    host,
    script: 'extract-hidden',
    retainReader: true,
  });

  assert.equal(webviews.length, 1);
  assert.equal(webviews[0].id, 'x-notif-reader-0');
  assert.equal(webviews[0].preload, 'file:///preload.js');
  assert.equal(webviews[0].webpreferences, 'backgroundThrottling=true');
  assert.equal(webviews[0].removed, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(items)), [{ script: 'extract-hidden' }]);
});

test('disposes a transient hidden notification reader after extraction', async () => {
  const { runtime, columns, webviews } = createHarness();
  columns.push({
    dataset: { definitionId: 'x-notif-new' },
    querySelector: () => createWebView({
      partition: 'persist:x-0',
      src: 'https://x.com/alice/status/123',
    }),
  });
  runtime.syncAccounts([{ username: '@alice', partition: 'persist:x-0' }]);

  const items = await runtime.listNotifications({
    accountId: '@alice',
    host: {
      appendChild(webview) {
        webview.executeJavaScript = async script => [{ script }];
      },
    },
    script: 'extract-once',
    retainReader: false,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(items)), [{ script: 'extract-once' }]);
  assert.equal(webviews[0].removed, true);
});

test('disposes every hidden notification reader without removing X Columns', () => {
  const { runtime, webviews } = createHarness();
  const column = createWebView({ id: 'wv-x-home', src: 'https://x.com/home' });
  const firstReader = createWebView({ id: 'x-notif-reader-0', src: 'https://x.com/notifications' });
  const secondReader = createWebView({ id: 'x-notif-reader-1', src: 'https://x.com/notifications' });
  webviews.push(column, firstReader, secondReader);

  assert.equal(runtime.disposeNotificationReaders(), 2);
  assert.equal(column.removed, undefined);
  assert.equal(firstReader.removed, true);
  assert.equal(secondReader.removed, true);
});

test('reports X Column and hidden notification reader counts', () => {
  const { runtime, webviews } = createHarness();
  webviews.push(
    createWebView({ id: 'wv-x-home', src: 'https://x.com/home' }),
    createWebView({ id: 'wv-x-notif', src: 'https://x.com/notifications' }),
    createWebView({ id: 'x-notif-reader-0', src: 'https://x.com/notifications' }),
    createWebView({ id: 'wv-b-profile', src: 'https://bsky.app/profile/alice.test' }),
  );

  assert.deepEqual(JSON.parse(JSON.stringify(runtime.getMemoryStats())), {
    columnWebViewCount: 2,
    notificationReaderCount: 1,
  });
});

test('uses a lightweight overlay instead of a captured page during silent reload', async () => {
  const { runtime, elements } = createHarness();
  const webview = createWebView({ id: 'wv-x-home', src: 'https://x.com/home' });
  let captures = 0;
  webview.capturePage = async () => {
    captures += 1;
    return { toDataURL: () => 'data:image/png;base64,large' };
  };
  const overlay = { style: {} };
  elements.set(webview.id, webview);
  elements.set('wvov-x-home', overlay);

  await runtime.reload('x-home');

  assert.equal(captures, 0);
  assert.equal(overlay.style.display, 'block');
  assert.equal(overlay.style.backgroundImage, '');
  assert.equal(overlay.style.backgroundColor, '#000');
});

test('opens a notification subject inside the reusable notification Column', async () => {
  const { runtime, elements } = createHarness();
  const webview = createWebView({
    id: 'wv-x-notif',
    src: 'https://x.com/notifications',
  });
  webview.executeJavaScript = async script => script === 'activate';
  elements.set(webview.id, webview);

  const result = await runtime.openNotificationTarget({
    columnId: 'x-notif',
    item: { reason: 'like', targetUrl: 'https://x.com/notifications' },
    notificationUrl: 'https://x.com/notifications',
    activationScript: 'activate',
  });

  assert.equal(result.status, 'opened');
});

test('promotes the next parked Column when the login owner is disposed', () => {
  const registerCalls = [];
  const gate = {
    register: (partition, id) => {
      registerCalls.push([partition, id]);
      return registerCalls.length > 1;
    },
    isActive: () => true,
    observe: () => [],
    unregister: () => ['notifications', 'search'],
  };
  const { runtime, elements } = createHarness({ loginGate: gate });
  const owner = createWebView({
    id: 'wv-home', partition: 'persist:x-0', src: 'https://x.com/i/flow/login',
  });
  const notifications = createWebView({
    id: 'wv-notifications', partition: 'persist:x-0', src: 'about:blank',
  });
  notifications.dataset.sdLoginParked = 'true';
  notifications.dataset.sdLoginTarget = 'https://x.com/notifications';
  elements.set(owner.id, owner);
  elements.set(notifications.id, notifications);

  runtime.disposeColumn('home');

  assert.deepEqual(registerCalls, [
    ['persist:x-0', 'notifications'],
  ]);
  assert.equal(notifications.dataset.sdLoginParked, 'false');
  assert.equal(notifications.src, 'https://x.com/notifications');
});
