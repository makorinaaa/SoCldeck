const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createDesktopNotificationService,
  resolveWindowsNotificationIdentity,
  sanitizeDesktopNotification,
} = require('../src/main/desktop-notification-service');

test('uses the packaged app id in production and the Electron path in development', () => {
  assert.equal(resolveWindowsNotificationIdentity({
    appId: 'com.socialdeck.app',
    execPath: 'C:\\SocialDeck\\SocialDeck.exe',
    isPackaged: true,
  }), 'com.socialdeck.app');
  assert.equal(resolveWindowsNotificationIdentity({
    appId: 'com.socialdeck.app',
    execPath: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
    isPackaged: false,
  }), 'C:\\repo\\node_modules\\electron\\dist\\electron.exe');
});

test('configures the Windows notification identity before creating a window', () => {
  const projectRoot = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(projectRoot, 'src', 'main.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const setIdentity = source.indexOf('app.setAppUserModelId(resolveWindowsNotificationIdentity({');
  const createWindow = source.indexOf('app.whenReady().then');

  assert.match(source, new RegExp(`const APP_USER_MODEL_ID = ['"]${pkg.build.appId}['"]`));
  assert.ok(setIdentity >= 0);
  assert.ok(setIdentity < createWindow);
});

test('sanitizes bounded desktop notification payloads', () => {
  assert.deepEqual(sanitizeDesktopNotification({
    key: ' b:reply:1 ',
    title: ` Alice ${'x'.repeat(200)} `,
    body: ` Body ${'y'.repeat(500)} `,
  }), {
    key: 'b:reply:1',
    title: `Alice ${'x'.repeat(114)}`,
    body: `Body ${'y'.repeat(235)}`,
  });
  assert.equal(sanitizeDesktopNotification({ key: '', title: 'Title' }), null);
  assert.equal(sanitizeDesktopNotification({ key: 'bad key', title: 'Title' }), null);
  assert.equal(sanitizeDesktopNotification({ key: 'b:1', title: '' }), null);
});

test('shows a native notification and focuses its owning window on activation', () => {
  const events = [];
  const instances = [];
  class FakeNotification {
    static isSupported() { return true; }
    constructor(options) {
      this.options = options;
      this.listeners = {};
      instances.push(this);
    }
    on(name, listener) { this.listeners[name] = listener; }
    show() { events.push('show'); }
  }
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => events.push('restore'),
    show: () => events.push('window-show'),
    focus: () => events.push('focus'),
    webContents: { send: (...args) => events.push(args) },
  };
  const service = createDesktopNotificationService({
    NotificationClass: FakeNotification,
    getWindow: () => window,
  });

  const result = service.show({ key: 'x:0:post', title: 'Alice replied', body: 'Hello' });
  instances[0].listeners.click();

  assert.equal(result, true);
  assert.deepEqual(instances[0].options, { title: 'Alice replied', body: 'Hello' });
  assert.deepEqual(events, [
    'show',
    'restore',
    'window-show',
    'focus',
    ['desktop-notification-activated', 'x:0:post'],
  ]);
});

test('shows consecutive native notifications independently', () => {
  const instances = [];
  class FakeNotification {
    static isSupported() { return true; }
    constructor(options) {
      this.options = options;
      this.listeners = {};
      instances.push(this);
    }
    on(name, listener) { this.listeners[name] = listener; }
    show() { this.shown = true; }
  }
  const service = createDesktopNotificationService({
    NotificationClass: FakeNotification,
    getWindow: () => null,
  });

  assert.equal(service.show({ key: 'x:first', title: 'First' }), true);
  assert.equal(service.show({ key: 'x:second', title: 'Second' }), true);
  assert.equal(instances.length, 2);
  assert.equal(instances[0].shown, true);
  assert.equal(instances[1].shown, true);
});

test('releases retained native notifications after the activation window', () => {
  const scheduled = [];
  const cleared = [];
  class FakeNotification {
    static isSupported() { return true; }
    constructor() { this.listeners = {}; }
    on(name, listener) { this.listeners[name] = listener; }
    show() {}
  }
  const service = createDesktopNotificationService({
    NotificationClass: FakeNotification,
    getWindow: () => null,
    retentionMs: 10 * 60 * 1000,
    setTimeoutFn: (callback, delay) => {
      scheduled.push({ callback, delay });
      return 7;
    },
    clearTimeoutFn: timer => cleared.push(timer),
  });

  service.show({ key: 'x:retained', title: 'Retained notification' });

  assert.equal(service.getActiveCount(), 1);
  assert.equal(scheduled[0].delay, 10 * 60 * 1000);
  scheduled[0].callback();
  assert.equal(service.getActiveCount(), 0);
  assert.deepEqual(cleared, []);
});

test('declines unsupported notifications and invalid payloads', () => {
  class UnsupportedNotification {
    static isSupported() { return false; }
  }
  const service = createDesktopNotificationService({
    NotificationClass: UnsupportedNotification,
    getWindow: () => null,
  });

  assert.equal(service.show({ key: 'b:1', title: 'Title' }), false);
  assert.equal(service.show({ key: '', title: 'Title' }), false);
});
