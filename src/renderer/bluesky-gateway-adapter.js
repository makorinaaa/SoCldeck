(function (global) {
  const OPERATIONS = [
    'getTimeline', 'getFeed', 'searchPosts', 'listNotifications',
    'markNotificationsSeen', 'getProfile', 'follow', 'unfollow',
    'getThread', 'like', 'unlike', 'repost', 'unrepost',
    'getUnreadCount', 'searchActors', 'resolveHandle',
    'createPostRecord', 'uploadBlob', 'uploadVideo',
  ];

  function unwrapOperationResult(result) {
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') return result;
    if (result.ok) return result.data;
    const detail = result.error || {};
    const error = new Error(detail.message || 'Bluesky operation failed');
    error.name = detail.name === 'AtprotoError' ? 'AtprotoError' : 'Error';
    if (Number.isInteger(detail.status)) error.status = detail.status;
    if (typeof detail.code === 'string') error.code = detail.code;
    throw error;
  }

  function createBlueskyGatewayAdapter({ invoke, login, clearSession } = {}) {
    if (typeof invoke !== 'function') {
      throw new Error('Bluesky Gateway adapter requires a host invocation capability');
    }
    const adapter = {};
    OPERATIONS.forEach(operation => {
      adapter[operation] = (payload = {}) => Promise.resolve(invoke(operation, payload))
        .then(unwrapOperationResult);
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
