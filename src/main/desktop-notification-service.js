function boundedText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function sanitizeDesktopNotification(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const key = boundedText(payload.key, 300);
  const title = boundedText(payload.title, 120);
  const body = boundedText(payload.body, 240);
  if (!key || !title || !/^[A-Za-z0-9:._/@?=&%+-]+$/.test(key)) return null;
  return { key, title, body };
}

function resolveWindowsNotificationIdentity({ appId, execPath, isPackaged } = {}) {
  const identity = isPackaged ? appId : execPath;
  return String(identity || '').trim();
}

function createDesktopNotificationService({
  NotificationClass,
  getWindow = () => null,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  retentionMs = 10 * 60 * 1000,
} = {}) {
  const activeNotifications = new Set();
  const retentionTimers = new Map();

  function release(nativeNotification, clearTimer = true) {
    activeNotifications.delete(nativeNotification);
    const timer = retentionTimers.get(nativeNotification);
    retentionTimers.delete(nativeNotification);
    if (clearTimer && timer != null) clearTimeoutFn(timer);
  }

  function show(payload) {
    const notification = sanitizeDesktopNotification(payload);
    if (!notification || !NotificationClass?.isSupported?.()) return false;

    const nativeNotification = new NotificationClass({
      title: notification.title,
      body: notification.body,
    });
    activeNotifications.add(nativeNotification);
    nativeNotification.on('click', () => {
      release(nativeNotification);
      const window = getWindow();
      if (!window || window.isDestroyed?.()) return;
      if (window.isMinimized?.()) window.restore?.();
      window.show?.();
      window.focus?.();
      window.webContents?.send?.('desktop-notification-activated', notification.key);
    });
    nativeNotification.on('close', () => release(nativeNotification));
    const timer = setTimeoutFn(() => release(nativeNotification, false), retentionMs);
    timer?.unref?.();
    retentionTimers.set(nativeNotification, timer);
    nativeNotification.show();
    return true;
  }

  return {
    getActiveCount: () => activeNotifications.size,
    show,
  };
}

module.exports = {
  createDesktopNotificationService,
  resolveWindowsNotificationIdentity,
  sanitizeDesktopNotification,
};
