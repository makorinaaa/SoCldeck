const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  isAllowedWebviewAttachment,
  isAllowedWebviewUrl,
  isTrustedRendererUrl,
  registerTrustedIpcHandler,
  secureApplicationWebContents,
  secureWebviewContents,
} = require('../src/main/electron-trust-policy');

function createWebContentsHarness() {
  const listeners = new Map();
  let windowOpenHandler = null;
  return {
    contents: {
      on(event, handler) { listeners.set(event, handler); },
      setWindowOpenHandler(handler) { windowOpenHandler = handler; },
    },
    emit(event, ...args) { return listeners.get(event)?.(...args); },
    openWindow(url) { return windowOpenHandler?.({ url }); },
  };
}

function createNavigationEvent() {
  return {
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

const indexPath = path.join(__dirname, '..', 'src', 'index.html');
const webviewPreloadPath = path.join(__dirname, '..', 'src', 'webview-preload.js');
const indexUrl = pathToFileURL(indexPath).toString();

test('trusts only the local SocialDeck renderer document', () => {
  assert.equal(isTrustedRendererUrl(indexUrl, indexPath), true);
  assert.equal(isTrustedRendererUrl(`${indexUrl}?widget=1#top`, indexPath), true);
  assert.equal(isTrustedRendererUrl('https://x.com/home', indexPath), false);
  assert.equal(
    isTrustedRendererUrl(pathToFileURL(path.join(path.dirname(indexPath), 'preload.js')).toString(), indexPath),
    false,
  );
});

test('allows only supported WebView origins over HTTPS', () => {
  for (const url of [
    'about:blank',
    'https://x.com/home',
    'https://mobile.twitter.com/notifications',
    'https://bsky.app/profile/alice.test',
  ]) {
    assert.equal(isAllowedWebviewUrl(url), true, url);
  }

  for (const url of [
    'http://x.com/home',
    'https://x.com.example.com/home',
    'https://bsky.social/profile/alice.test',
    'data:text/html,hello',
    'file:///tmp/index.html',
  ]) {
    assert.equal(isAllowedWebviewUrl(url), false, url);
  }
});

test('binds each WebView origin to its partition and preload policy', () => {
  const preloadUrl = pathToFileURL(webviewPreloadPath).toString();

  assert.equal(isAllowedWebviewAttachment({
    src: 'https://x.com/home',
    partition: 'persist:x-2',
    preload: preloadUrl,
  }, webviewPreloadPath), true);
  assert.equal(isAllowedWebviewAttachment({
    src: 'about:blank',
    partition: 'persist:x',
    preload: webviewPreloadPath,
  }, webviewPreloadPath), true);
  assert.equal(isAllowedWebviewAttachment({
    src: 'https://bsky.app/profile/alice.test',
    partition: 'persist:bsky',
    preload: '',
  }, webviewPreloadPath), true);

  assert.equal(isAllowedWebviewAttachment({
    src: 'https://x.com/home',
    partition: 'persist:bsky',
    preload: preloadUrl,
  }, webviewPreloadPath), false);
  assert.equal(isAllowedWebviewAttachment({
    src: 'https://x.com/home',
    partition: 'persist:x-0',
    preload: '',
  }, webviewPreloadPath), false);
  assert.equal(isAllowedWebviewAttachment({
    src: 'https://bsky.app/profile/alice.test',
    partition: 'persist:bsky',
    preload: preloadUrl,
  }, webviewPreloadPath), false);
  assert.equal(isAllowedWebviewAttachment({
    src: 'https://x.com.example.com/home',
    partition: 'persist:x-0',
    preload: preloadUrl,
  }, webviewPreloadPath), false);
});

test('protects application navigation and hardens accepted WebViews', () => {
  const harness = createWebContentsHarness();
  const opened = [];
  secureApplicationWebContents(harness.contents, {
    indexPath,
    webviewPreloadPath,
    openExternalUrl: url => opened.push(url),
  });

  const trustedNavigation = createNavigationEvent();
  harness.emit('will-navigate', trustedNavigation, `${indexUrl}?widget=1`);
  assert.equal(trustedNavigation.prevented, false);

  const remoteNavigation = createNavigationEvent();
  harness.emit('will-navigate', remoteNavigation, 'https://x.com/home');
  assert.equal(remoteNavigation.prevented, true);

  const preferences = {
    preload: pathToFileURL(webviewPreloadPath).toString(),
    nodeIntegration: true,
    contextIsolation: false,
    sandbox: false,
    webSecurity: false,
    allowRunningInsecureContent: true,
  };
  const attachment = createNavigationEvent();
  harness.emit('will-attach-webview', attachment, preferences, {
    src: 'https://x.com/home',
    partition: 'persist:x-0',
  });
  assert.equal(attachment.prevented, false);
  assert.equal(preferences.preload, webviewPreloadPath);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.allowRunningInsecureContent, false);

  const rejectedAttachment = createNavigationEvent();
  harness.emit('will-attach-webview', rejectedAttachment, {}, {
    src: 'https://evil.example/',
    partition: 'persist:x-0',
  });
  assert.equal(rejectedAttachment.prevented, true);

  assert.deepEqual(harness.openWindow('https://example.com/docs'), { action: 'deny' });
  assert.deepEqual(opened, ['https://example.com/docs']);
});

test('prevents a WebView from leaving its supported origins', () => {
  const harness = createWebContentsHarness();
  const opened = [];
  secureWebviewContents(harness.contents, { openExternalUrl: url => opened.push(url) });

  const allowed = createNavigationEvent();
  harness.emit('will-navigate', allowed, 'https://x.com/alice/status/1');
  assert.equal(allowed.prevented, false);

  const blocked = createNavigationEvent();
  harness.emit('will-navigate', blocked, 'https://example.com/article');
  assert.equal(blocked.prevented, true);
  assert.deepEqual(opened, ['https://example.com/article']);

  const redirected = createNavigationEvent();
  harness.emit('will-redirect', redirected, 'https://example.com/login');
  assert.equal(redirected.prevented, true);
  assert.deepEqual(opened, ['https://example.com/article']);
});

test('IPC handlers reject child frames and non-SocialDeck documents', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  registerTrustedIpcHandler({
    ipcMain,
    indexPath,
    channel: 'secure-operation',
    handler: (_event, value) => `accepted:${value}`,
  });

  const invoke = handlers.get('secure-operation');
  const trustedFrame = { parent: null, url: `${indexUrl}?widget=1` };
  assert.equal(await invoke({ senderFrame: trustedFrame }, 'value'), 'accepted:value');

  await assert.rejects(
    invoke({ senderFrame: { parent: trustedFrame, url: indexUrl } }, 'value'),
    /Unauthorized IPC sender/,
  );
  await assert.rejects(
    invoke({ senderFrame: { parent: null, url: 'https://x.com/home' } }, 'value'),
    /Unauthorized IPC sender/,
  );
});

test('main process registers IPC only through the trusted wrapper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.doesNotMatch(source, /ipcMain\.handle\(/);
  assert.match(source, /registerTrustedIpcHandler/);
});
