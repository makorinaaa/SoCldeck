(function (global) {
  const BSKY = 'https://bsky.social/xrpc';

  async function apiPost(endpoint, body, token = null, fetchImpl = global.fetch) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(`${BSKY}/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || e.error || `${endpoint} failed`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  async function apiGet(endpoint, params = {}, token = null, fetchImpl = global.fetch) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const q = new URLSearchParams(params).toString();
    const res = await fetchImpl(`${BSKY}/${endpoint}${q ? '?' + q : ''}`, { headers });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || e.error || `${endpoint} failed`);
    }
    return res.json();
  }

  function createBskyClient({ fetchImpl = global.fetch } = {}) {
    const post = (endpoint, body, token = null) => apiPost(endpoint, body, token, fetchImpl);
    const get = (endpoint, params = {}, token = null) => apiGet(endpoint, params, token, fetchImpl);

    const client = {
      apiPost: post,
      apiGet: get,
      login: (id, pw) => post('com.atproto.server.createSession', { identifier: id, password: pw }),
      refresh: (rt) => post('com.atproto.server.refreshSession', {}, rt),
      timeline: (jwt, limit = 40, cursor = null) => get('app.bsky.feed.getTimeline', cursor ? { limit, cursor } : { limit }, jwt),
      feed: (jwt, feed, limit = 40, cursor = null) => get('app.bsky.feed.getFeed', cursor ? { feed, limit, cursor } : { feed, limit }, jwt),
      notifications: (jwt, limit = 30) => get('app.bsky.notification.listNotifications', { limit }, jwt),
      search: (jwt, q, limit = 30) => get('app.bsky.feed.searchPosts', { q, limit }, jwt),
      searchActors: (jwt, q, limit = 8) => get('app.bsky.actor.searchActors', { q, limit }, jwt),
      getProfile: (jwt, actor) => get('app.bsky.actor.getProfile', { actor }, jwt),
      like: (jwt, did, uri, cid) => post('com.atproto.repo.createRecord', { repo: did, collection: 'app.bsky.feed.like', record: { $type: 'app.bsky.feed.like', subject: { uri, cid }, createdAt: new Date().toISOString() } }, jwt),
      unlike: (jwt, did, likeUri) => post('com.atproto.repo.deleteRecord', { repo: did, collection: 'app.bsky.feed.like', rkey: likeUri.split('/').pop() }, jwt),
      repost: (jwt, did, uri, cid) => post('com.atproto.repo.createRecord', { repo: did, collection: 'app.bsky.feed.repost', record: { $type: 'app.bsky.feed.repost', subject: { uri, cid }, createdAt: new Date().toISOString() } }, jwt),
      unrepost: (jwt, did, repostUri) => post('com.atproto.repo.deleteRecord', { repo: did, collection: 'app.bsky.feed.repost', rkey: repostUri.split('/').pop() }, jwt),
      post: (jwt, did, text, replyRef = null) => {
        const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString() };
        if (replyRef) record.reply = replyRef;
        return post('com.atproto.repo.createRecord', { repo: did, collection: 'app.bsky.feed.post', record }, jwt);
      },
      follow: (jwt, did, targetDid) => post('com.atproto.repo.createRecord', { repo: did, collection: 'app.bsky.graph.follow', record: { $type: 'app.bsky.graph.follow', subject: targetDid, createdAt: new Date().toISOString() } }, jwt),
      unfollow: (jwt, did, followUri) => post('com.atproto.repo.deleteRecord', { repo: did, collection: 'app.bsky.graph.follow', rkey: followUri.split('/').pop() }, jwt),
      getRelationships: (jwt, actor, others) => get('app.bsky.graph.getRelationships', { actor, others }, jwt),
      quotePost: (jwt, did, text, quotedUri, quotedCid, embed) => {
        const record = {
          $type: 'app.bsky.feed.post',
          text,
          createdAt: new Date().toISOString(),
          embed: embed
            ? { $type: 'app.bsky.embed.recordWithMedia', record: { $type: 'app.bsky.embed.record', record: { uri: quotedUri, cid: quotedCid } }, media: embed }
            : { $type: 'app.bsky.embed.record', record: { uri: quotedUri, cid: quotedCid } },
        };
        return post('com.atproto.repo.createRecord', { repo: did, collection: 'app.bsky.feed.post', record }, jwt);
      },
      getThread: (jwt, uri, depth = 6) => get('app.bsky.feed.getPostThread', { uri, depth }, jwt),
      getPreferences: (jwt) => get('app.bsky.actor.getPreferences', {}, jwt),
      updateSeen: (jwt, seenAt) => post('app.bsky.notification.updateSeen', { seenAt }, jwt),
    };

    client.getSavedFeeds = async (jwt) => {
      const prefs = await client.getPreferences(jwt);
      const saved = (prefs.preferences || []).find(p => p.$type === 'app.bsky.actor.defs#savedFeedsPrefV2');
      return saved?.items || [];
    };

    return client;
  }

  function createAuthenticatedBlueskyAdapter({ client, getAccount, updateAccount } = {}) {
    if (!client || typeof getAccount !== 'function' || typeof updateAccount !== 'function') {
      throw new Error('Authenticated Bluesky adapter requires account access');
    }
    let refreshPromise = null;

    function requiresRefresh(error) {
      const message = String(error?.message || '');
      return /expired|token|unauthorized/i.test(message);
    }

    async function refreshAccount() {
      if (refreshPromise) return refreshPromise;
      const account = getAccount();
      if (!account?.refreshJwt) throw new Error('Bluesky refresh token is unavailable');
      refreshPromise = Promise.resolve(client.refresh(account.refreshJwt)).then(session => {
        updateAccount(session);
        return getAccount();
      });
      try {
        return await refreshPromise;
      } finally {
        refreshPromise = null;
      }
    }

    async function call(operation) {
      const account = getAccount();
      if (!account?.accessJwt) throw new Error('Bluesky account is unavailable');
      try {
        return await operation(account);
      } catch (error) {
        if (!requiresRefresh(error)) throw error;
        return operation(await refreshAccount());
      }
    }

    return {
      getTimeline: ({ limit = 40, cursor = null } = {}) => call(account => (
        client.timeline(account.accessJwt, limit, cursor)
      )),
      getFeed: ({ feedUri, limit = 40, cursor = null }) => call(account => (
        client.feed(account.accessJwt, feedUri, limit, cursor)
      )),
      searchPosts: ({ query, limit = 40 }) => call(account => (
        client.search(account.accessJwt, query, limit)
      )),
      listNotifications: ({ limit = 40 } = {}) => call(account => (
        client.notifications(account.accessJwt, limit)
      )),
      markNotificationsSeen: ({ seenAt }) => call(account => (
        client.updateSeen(account.accessJwt, seenAt)
      )),
      getProfile: ({ actor }) => call(account => (
        client.getProfile(account.accessJwt, actor)
      )),
      follow: ({ targetDid }) => call(account => (
        client.follow(account.accessJwt, account.did, targetDid)
      )),
      unfollow: ({ followUri }) => call(account => (
        client.unfollow(account.accessJwt, account.did, followUri)
      )),
      getThread: ({ uri, depth = 6 }) => call(account => (
        client.getThread(account.accessJwt, uri, depth)
      )),
      like: ({ uri, cid }) => call(account => (
        client.like(account.accessJwt, account.did, uri, cid)
      )),
      unlike: ({ likeUri }) => call(account => (
        client.unlike(account.accessJwt, account.did, likeUri)
      )),
      repost: ({ uri, cid }) => call(account => (
        client.repost(account.accessJwt, account.did, uri, cid)
      )),
      unrepost: ({ repostUri }) => call(account => (
        client.unrepost(account.accessJwt, account.did, repostUri)
      )),
    };
  }

  global.SocialDeckBskyClient = {
    BSKY,
    createAuthenticatedBlueskyAdapter,
    createBskyClient,
  };
})(window);
