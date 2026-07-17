const { AtprotoError } = require('./bluesky-gateway');

const DEFAULT_SERVICE = 'https://bsky.social/xrpc';

async function parseResponse(response, endpoint) {
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch {}
  }
  if (!response.ok) {
    throw new AtprotoError(body.message || body.error || `${endpoint} failed`, {
      status: response.status,
      code: body.error || '',
    });
  }
  return body;
}

function createAtprotoClient({ fetchImpl = global.fetch, service = DEFAULT_SERVICE } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('AT Protocol client requires fetch');
  if (service !== DEFAULT_SERVICE) throw new Error('Unsupported AT Protocol service');

  async function get(endpoint, params, token) {
    const query = new URLSearchParams(params).toString();
    const response = await fetchImpl(`${service}/${endpoint}${query ? `?${query}` : ''}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return parseResponse(response, endpoint);
  }

  async function post(endpoint, body, token) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const options = {
      method: 'POST',
      headers,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetchImpl(`${service}/${endpoint}`, options);
    return parseResponse(response, endpoint);
  }

  function deleteRecord(token, did, collection, uri) {
    const rkey = String(uri || '').split('/').pop();
    return post('com.atproto.repo.deleteRecord', { repo: did, collection, rkey }, token);
  }

  return {
    login: (identifier, password) => post(
      'com.atproto.server.createSession',
      { identifier, password },
      null,
    ),
    refresh: refreshJwt => post('com.atproto.server.refreshSession', undefined, refreshJwt),
    timeline: (jwt, limit, cursor) => get(
      'app.bsky.feed.getTimeline',
      cursor ? { limit, cursor } : { limit },
      jwt,
    ),
    feed: (jwt, feed, limit, cursor) => get(
      'app.bsky.feed.getFeed',
      cursor ? { feed, limit, cursor } : { feed, limit },
      jwt,
    ),
    search: (jwt, query, limit) => get('app.bsky.feed.searchPosts', { q: query, limit }, jwt),
    notifications: (jwt, limit) => get('app.bsky.notification.listNotifications', { limit }, jwt),
    updateSeen: (jwt, seenAt) => post('app.bsky.notification.updateSeen', { seenAt }, jwt),
    getUnreadCount: jwt => get('app.bsky.notification.getUnreadCount', {}, jwt),
    getProfile: (jwt, actor) => get('app.bsky.actor.getProfile', { actor }, jwt),
    searchActors: (jwt, query, limit) => get('app.bsky.actor.searchActors', { q: query, limit }, jwt),
    resolveHandle: (jwt, handle) => get('com.atproto.identity.resolveHandle', { handle }, jwt),
    getThread: (jwt, uri, depth) => get('app.bsky.feed.getPostThread', { uri, depth }, jwt),
    follow: (jwt, did, targetDid) => post('com.atproto.repo.createRecord', {
      repo: did,
      collection: 'app.bsky.graph.follow',
      record: {
        $type: 'app.bsky.graph.follow',
        subject: targetDid,
        createdAt: new Date().toISOString(),
      },
    }, jwt),
    unfollow: (jwt, did, followUri) => deleteRecord(
      jwt,
      did,
      'app.bsky.graph.follow',
      followUri,
    ),
    like: (jwt, did, uri, cid) => post('com.atproto.repo.createRecord', {
      repo: did,
      collection: 'app.bsky.feed.like',
      record: {
        $type: 'app.bsky.feed.like',
        subject: { uri, cid },
        createdAt: new Date().toISOString(),
      },
    }, jwt),
    unlike: (jwt, did, likeUri) => deleteRecord(jwt, did, 'app.bsky.feed.like', likeUri),
    repost: (jwt, did, uri, cid) => post('com.atproto.repo.createRecord', {
      repo: did,
      collection: 'app.bsky.feed.repost',
      record: {
        $type: 'app.bsky.feed.repost',
        subject: { uri, cid },
        createdAt: new Date().toISOString(),
      },
    }, jwt),
    unrepost: (jwt, did, repostUri) => deleteRecord(jwt, did, 'app.bsky.feed.repost', repostUri),
    createRecord: (jwt, did, record) => post('com.atproto.repo.createRecord', {
      repo: did,
      collection: 'app.bsky.feed.post',
      record,
    }, jwt),
    async uploadBlob(jwt, mimeType, bytes) {
      const response = await fetchImpl(`${service}/com.atproto.repo.uploadBlob`, {
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          Authorization: `Bearer ${jwt}`,
        },
        body: bytes,
      });
      return parseResponse(response, 'com.atproto.repo.uploadBlob');
    },
  };
}

module.exports = {
  DEFAULT_SERVICE,
  createAtprotoClient,
};
