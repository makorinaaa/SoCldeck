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

function createDesktopNotificationService({ NotificationClass, getWindow = () => null } = {}) {
  const activeNotifications = new Set();

  function show(payload) {
    const notification = sanitizeDesktopNotification(payload);
    if (!notification || !NotificationClass?.isSupported?.()) return false;

    const nativeNotification = new NotificationClass({
      title: notification.title,
      body: notification.body,
    });
    activeNotifications.add(nativeNotification);
    nativeNotification.on('click', () => {
      activeNotifications.delete(nativeNotification);
      const window = getWindow();
      if (!window || window.isDestroyed?.()) return;
      if (window.isMinimized?.()) window.restore?.();
      window.show?.();
      window.focus?.();
      window.webContents?.send?.('desktop-notification-activated', notification.key);
    });
    nativeNotification.on('close', () => activeNotifications.delete(nativeNotification));
    nativeNotification.show();
    return true;
  }

  return { show };
}

module.exports = {
  createDesktopNotificationService,
  sanitizeDesktopNotification,
};
