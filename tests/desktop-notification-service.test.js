const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDesktopNotificationService,
  sanitizeDesktopNotification,
} = require('../src/main/desktop-notification-service');

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
