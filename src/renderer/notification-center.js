(function (global) {
  const POST_REASONS = new Set(['like', 'repost', 'reply', 'mention', 'quote']);

  function normalizeBskyNotification(notification) {
    const reason = String(notification?.reason || 'other');
    const uri = notification?.uri || null;
    const targetUri = ['like', 'repost'].includes(reason)
      ? (notification?.reasonSubject || null)
      : (POST_REASONS.has(reason) ? uri : null);
    return {
      id: `${reason}:${uri || notification?.indexedAt || ''}`,
      networkId: 'b',
      reason,
      isRead: notification?.isRead === true,
      indexedAt: notification?.indexedAt || '',
      author: notification?.author || {},
      targetUri,
      raw: notification,
    };
  }

  function filterNotifications(notifications, { reason = 'all', unreadOnly = false } = {}) {
    return notifications.filter(notification => {
      if (reason !== 'all' && notification.reason !== reason) return false;
      return !unreadOnly || !notification.isRead;
    });
  }

  global.SocialDeckNotificationCenter = {
    normalizeBskyNotification,
    filterNotifications,
  };
})(window);
