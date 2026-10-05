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

  const AVATAR_PREFIX = 'https://cdn.bsky.app/img/avatar/';
  const AVATAR_THUMBNAIL_PREFIX = 'https://cdn.bsky.app/img/avatar_thumbnail/';
  const MAX_AVATAR_DEPTH = 24;

  // Bluesky's avatar URLs point at a 1000px image, but SocialDeck draws avatars at 28-42px.
  // The CDN's thumbnail preset serves the same image at 128px, which saves the download
  // and roughly 4 MB of decoded memory per avatar on screen.
  function useAvatarThumbnails(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > MAX_AVATAR_DEPTH) return value;
    if (Array.isArray(value)) {
      value.forEach(item => useAvatarThumbnails(item, depth + 1));
      return value;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'avatar' && typeof item === 'string' && item.startsWith(AVATAR_PREFIX)) {
        value[key] = AVATAR_THUMBNAIL_PREFIX + item.slice(AVATAR_PREFIX.length);
      } else if (item && typeof item === 'object') {
        useAvatarThumbnails(item, depth + 1);
      }
    }
    return value;
  }

  function createBlueskyGatewayAdapter({ invoke, login, clearSession } = {}) {
    if (typeof invoke !== 'function') {
      throw new Error('Bluesky Gateway adapter requires a host invocation capability');
    }
    const adapter = {};
    OPERATIONS.forEach(operation => {
      adapter[operation] = (payload = {}) => Promise.resolve(invoke(operation, payload))
        .then(unwrapOperationResult)
        .then(result => useAvatarThumbnails(result));
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

  global.SocialDeckBlueskyGatewayAdapter = { createBlueskyGatewayAdapter, useAvatarThumbnails };
})(window);
