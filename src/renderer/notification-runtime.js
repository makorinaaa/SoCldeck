(function (global) {
  function createNotificationRuntime({
    documentRef = global.document,
    setIntervalImpl = global.setInterval,
    clearIntervalImpl = global.clearInterval,
    intervalMs = 60000,
  } = {}) {
    let unreadCount = 0;
    let xUnreadCount = 0;
    let pollTimer = null;
    let polling = null;

    function setUnreadCount(count) {
      unreadCount = count || 0;
      renderBadge();
      return unreadCount;
    }

    function setXUnreadCount(count) {
      xUnreadCount = count || 0;
      renderBadge();
    }

    function renderBadge() {
      const total = unreadCount + xUnreadCount;
      const badge = documentRef.getElementById('bsky-notif-badge');
      if (badge) {
        badge.textContent = total > 99 ? '99+' : total;
        badge.style.display = total > 0 ? 'flex' : 'none';
      }

      const btn = documentRef.getElementById('sb-notif-b');
      if (btn) {
        btn.style.color = total > 0 ? 'var(--red)' : '';
        btn.title = `通知センター・未読 ${total}件（X ${xUnreadCount}件 / Bluesky ${unreadCount}件）`;
        btn.setAttribute?.('aria-label', btn.title);
      }
    }

    function clearUnread() {
      setUnreadCount(0);
    }

    function startPoll(fetchCount) {
      if (pollTimer) return;
      const tick = () => {
        if (polling) return polling;
        polling = Promise.resolve()
          .then(fetchCount)
          .then(setUnreadCount)
          .finally(() => { polling = null; });
        return polling;
      };
      tick().catch(() => {});
      pollTimer = setIntervalImpl(() => tick().catch(() => {}), intervalMs);
    }

    function stopPoll() {
      if (!pollTimer) return;
      clearIntervalImpl(pollTimer);
      pollTimer = null;
    }

    function getUnreadCount() {
      return unreadCount;
    }

    return {
      getUnreadCount,
      setUnreadCount,
      setXUnreadCount,
      renderBadge,
      clearUnread,
      startPoll,
      stopPoll,
    };
  }

  global.SocialDeckNotificationRuntime = {
    createNotificationRuntime,
  };
})(window);
