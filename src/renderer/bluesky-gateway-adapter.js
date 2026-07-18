(function (global) {
  const OPERATIONS = [
    'getTimeline', 'getFeed', 'searchPosts', 'listNotifications',
    'markNotificationsSeen', 'getProfile', 'follow', 'unfollow',
    'getThread', 'like', 'unlike', 'repost', 'unrepost',
    'getUnreadCount', 'searchActors', 'resolveHandle',
    'createPostRecord', 'uploadBlob', 'uploadVideo',
  ];

  function createBlueskyGatewayAdapter({ invoke, login, clearSession } = {}) {
    if (typeof invoke !== 'function') {
      throw new Error('Bluesky Gateway adapter requires a host invocation capability');
    }
    const adapter = {};
    OPERATIONS.forEach(operation => {
      adapter[operation] = (payload = {}) => invoke(operation, payload);
    });
    adapter.login = (handle, password) => {
      if (typeof login !== 'function') throw new Error('Bluesky login is unavailable');
      return login({ handle: String(handle || '').trim(), password });
    };
    adapter.clearSession = () => {
      if (typeof clearSession !== 'function') return Promise.resolve(false);
      return clearSession();
    };
    return adapter;
  }

  global.SocialDeckBlueskyGatewayAdapter = { createBlueskyGatewayAdapter };
})(window);
