(function (global) {
  function createNotificationRuntime({
    documentRef = global.document,
    setIntervalImpl = global.setInterval,
    clearIntervalImpl = global.clearInterval,
    intervalMs = 60000,
  } = {}) {
    let unreadCount = 0;
    let pollTimer = null;

    function setUnreadCount(count) {
      unreadCount = count || 0;
      const badge = documentRef.getElementById('bsky-notif-badge');
      if (badge) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = unreadCount > 0 ? 'flex' : 'none';
      }

      const btn = documentRef.getElementById('sb-notif-b');
      if (btn) btn.style.color = unreadCount > 0 ? 'var(--red)' : '';
      return unreadCount;
    }

    function clearUnread() {
      setUnreadCount(0);
    }

    function startPoll(fetchCount) {
      if (pollTimer) return;
      const tick = async () => {
        const count = await fetchCount();
        setUnreadCount(count);
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
      clearUnread,
      startPoll,
      stopPoll,
    };
  }

  global.SocialDeckNotificationRuntime = {
    createNotificationRuntime,
  };
})(window);
