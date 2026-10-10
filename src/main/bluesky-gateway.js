const MAX_QUERY_LENGTH = 512;
const MAX_URI_LENGTH = 4_096;
const MAX_CURSOR_LENGTH = 2_048;
const MAX_RECORD_BYTES = 1_000_000;
const MAX_BLOB_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

class AtprotoError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'AtprotoError';
    this.status = status;
    this.code = code;
  }
}

function readObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Bluesky operation payload');
  }
  return value;
}

function readString(value, name, maxLength = MAX_URI_LENGTH) {
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new Error(`Invalid Bluesky ${name}`);
  }
  return value;
}

function readOptionalString(value, name, maxLength = MAX_CURSOR_LENGTH) {
  if (value === null || value === undefined || value === '') return null;
  return readString(value, name, maxLength);
}

function readFiniteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Invalid Bluesky ${name}`);
  }
  return number;
}

function readLimit(value, fallback, maximum = 100) {
  if (value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error('Invalid Bluesky result limit');
  }
  return number;
}

function readDepth(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw new Error('Invalid Bluesky thread depth');
  }
  return number;
}

function readRecord(value) {
  const record = readObject(value);
  const serialized = JSON.stringify(record);
  if (!serialized || Buffer.byteLength(serialized) > MAX_RECORD_BYTES) {
    throw new Error('Invalid Bluesky post record');
  }
  if (record.$type !== 'app.bsky.feed.post') {
    throw new Error('Invalid Bluesky post record');
  }
  return record;
}

// 投稿の rkey は TID（13文字、先頭は 2-7 か a-j）
function readOptionalPostKey(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[2-7a-j][2-7a-z]{12}$/.test(value)) {
    throw new Error('Invalid Bluesky post record key');
  }
  return value;
}

function readBlob(value) {
  const payload = readObject(value);
  if (!IMAGE_MIME_TYPES.has(payload.mimeType)) {
    throw new Error('Invalid Bluesky image type');
  }
  let bytes;
  if (Buffer.isBuffer(payload.bytes)) bytes = payload.bytes;
  else if (payload.bytes instanceof ArrayBuffer) bytes = Buffer.from(payload.bytes);
  else if (ArrayBuffer.isView(payload.bytes)) {
    bytes = Buffer.from(payload.bytes.buffer, payload.bytes.byteOffset, payload.bytes.byteLength);
  } else {
    throw new Error('Invalid Bluesky image data');
  }
  if (bytes.length === 0 || bytes.length > MAX_BLOB_BYTES) {
    throw new Error('Invalid Bluesky image data');
  }
  return { bytes, mimeType: payload.mimeType };
}

function publicIdentity(session) {
  if (!session) return null;
  return { handle: session.handle, did: session.did };
}

function requiresRefresh(error) {
  return error?.status === 401
    || /expired|token|unauthorized/i.test(`${error?.code || ''} ${error?.message || ''}`);
}

function createBlueskyGateway({ vault, client, prepareVideo } = {}) {
  if (!vault?.load || !vault?.save || !vault?.clear || !client) {
    throw new Error('Bluesky Gateway requires a Vault and AT Protocol client');
  }
  let refreshPromise = null;
  let sessionVersion = 0;
  function assertCurrent(version) {
    if (version !== sessionVersion) throw new Error('Bluesky account changed during request');
  }

  async function login(input) {
    const payload = readObject(input);
    const handle = readString(String(payload.handle || '').trim(), 'handle', 256);
    const password = readString(String(payload.password || '').trim(), 'app password', 1_024);
    let version = ++sessionVersion;
    refreshPromise = null;
    const session = await client.login(handle, password);
    assertCurrent(version);
    // Invalidate operations started with the previous account while login awaited.
    version = ++sessionVersion;
    refreshPromise = null;
    const stored = vault.save(session);
    let profile = null;
    try {
      profile = await client.getProfile(stored.accessJwt, stored.did);
    } catch {}
    assertCurrent(version);
    return {
      handle: stored.handle,
      did: stored.did,
      displayName: profile?.displayName || stored.handle,
      // Drawn at sidebar size: use the CDN's 128px preset, as the renderer adapter does.
      avatar: String(profile?.avatar || '')
        .replace(/^https:\/\/cdn\.bsky\.app\/img\/avatar\//, 'https://cdn.bsky.app/img/avatar_thumbnail/') || null,
    };
  }

  function restoreAccount() {
    return publicIdentity(vault.load());
  }

  function migrateSession(credentials) {
    sessionVersion += 1;
    refreshPromise = null;
    return publicIdentity(vault.save(credentials));
  }

  async function refreshSession(current, version) {
    assertCurrent(version);
    if (refreshPromise) return refreshPromise;
    if (!current.refreshJwt) throw new Error('Bluesky refresh token is unavailable');
    const pending = Promise.resolve(client.refresh(current.refreshJwt)).then(next => {
      assertCurrent(version);
      if (next.did !== current.did) throw new Error('Bluesky refresh account mismatch');
      return vault.save({ ...current, ...next });
    });
    refreshPromise = pending;
    try {
      return await refreshPromise;
    } finally {
      if (refreshPromise === pending) refreshPromise = null;
    }
  }

  async function authenticated(operation) {
    const version = sessionVersion;
    const account = vault.load();
    if (!account?.accessJwt) throw new Error('Bluesky Network Account is unavailable');
    try {
      const result = await operation(account);
      assertCurrent(version);
      return result;
    } catch (error) {
      if (!requiresRefresh(error)) throw error;
      const refreshed = await refreshSession(account, version);
      assertCurrent(version);
      const result = await operation(refreshed);
      assertCurrent(version);
      return result;
    }
  }

  async function execute(operation, input = {}) {
    const payload = readObject(input);
    switch (operation) {
      case 'getTimeline':
        return authenticated(account => client.timeline(
          account.accessJwt,
          readLimit(payload.limit, 40),
          readOptionalString(payload.cursor, 'cursor'),
        ));
      case 'getFeed':
        return authenticated(account => client.feed(
          account.accessJwt,
          readString(payload.feedUri, 'Feed URI'),
          readLimit(payload.limit, 40),
          readOptionalString(payload.cursor, 'cursor'),
        ));
      case 'searchPosts':
        return authenticated(account => client.search(
          account.accessJwt,
          readString(payload.query, 'search query', MAX_QUERY_LENGTH),
          readLimit(payload.limit, 40),
        ));
      case 'listNotifications':
        return authenticated(account => client.notifications(
          account.accessJwt,
          readLimit(payload.limit, 40),
          readOptionalString(payload.cursor, 'cursor'),
        ));
      case 'markNotificationsSeen':
        return authenticated(account => client.updateSeen(
          account.accessJwt,
          readString(payload.seenAt, 'seen timestamp', 64),
        ));
      case 'getProfile':
        return authenticated(account => client.getProfile(
          account.accessJwt,
          readString(payload.actor, 'actor', 512),
        ));
      case 'follow':
        return authenticated(account => client.follow(
          account.accessJwt,
          account.did,
          readString(payload.targetDid, 'target DID', 512),
        ));
      case 'unfollow':
        return authenticated(account => client.unfollow(
          account.accessJwt,
          account.did,
          readString(payload.followUri, 'follow URI'),
        ));
      case 'getThread':
        return authenticated(account => client.getThread(
          account.accessJwt,
          readString(payload.uri, 'post URI'),
          readDepth(payload.depth, 12),
          readDepth(payload.parentHeight, 12),
        ));
      case 'like':
        return authenticated(account => client.like(
          account.accessJwt,
          account.did,
          readString(payload.uri, 'post URI'),
          readString(payload.cid, 'post CID', 512),
        ));
      case 'unlike':
        return authenticated(account => client.unlike(
          account.accessJwt,
          account.did,
          readString(payload.likeUri, 'like URI'),
        ));
      case 'repost':
        return authenticated(account => client.repost(
          account.accessJwt,
          account.did,
          readString(payload.uri, 'post URI'),
          readString(payload.cid, 'post CID', 512),
        ));
      case 'unrepost':
        return authenticated(account => client.unrepost(
          account.accessJwt,
          account.did,
          readString(payload.repostUri, 'repost URI'),
        ));
      case 'getUnreadCount':
        return authenticated(account => client.getUnreadCount(account.accessJwt));
      case 'searchActors':
        return authenticated(account => client.searchActors(
          account.accessJwt,
          readString(payload.query, 'actor query', MAX_QUERY_LENGTH),
          readLimit(payload.limit, 6, 25),
        ));
      case 'resolveHandle':
        return authenticated(account => client.resolveHandle(
          account.accessJwt,
          readString(payload.handle, 'handle', 256),
        ));
      case 'createPostRecord': {
        const record = readRecord(payload.record);
        const rkey = readOptionalPostKey(payload.rkey);
        if (!rkey) {
          return authenticated(account => client.createRecord(
            account.accessJwt,
            account.did,
            record,
          ));
        }
        // 前回の送信が応答だけ失って作成済みのことがある。同じ rkey の投稿があれば、それを結果にする
        return authenticated(async account => {
          try {
            return await client.createRecord(account.accessJwt, account.did, record, rkey);
          } catch (error) {
            const existing = await client.getPostRecord(account.accessJwt, account.did, rkey)
              .catch(() => null);
            if (existing?.uri) return { uri: existing.uri, cid: existing.cid };
            throw error;
          }
        });
      }
      case 'uploadBlob': {
        const blob = readBlob(payload);
        return authenticated(account => client.uploadBlob(
          account.accessJwt,
          blob.mimeType,
          blob.bytes,
        ));
      }
      case 'uploadVideo': {
        if (typeof prepareVideo !== 'function' || typeof client.uploadVideo !== 'function') {
          throw new Error('Bluesky video upload is unavailable');
        }
        const version = sessionVersion;
        if (!vault.load()?.accessJwt) throw new Error('Bluesky Network Account is unavailable');
        const video = await prepareVideo({
          filePath: readString(payload.filePath, 'video file path', 32_768),
          name: readString(payload.name, 'video file name', 512),
          startSeconds: readFiniteNumber(payload.startSeconds, 'video start'),
          endSeconds: readFiniteNumber(payload.endSeconds, 'video end'),
          durationSeconds: readFiniteNumber(payload.durationSeconds, 'video duration'),
        });
        assertCurrent(version);
        const blob = await authenticated(account => client.uploadVideo(
          account.accessJwt,
          account.did,
          video.name,
          video.bytes,
        ));
        return { blob };
      }
      default:
        throw new Error(`Unsupported Bluesky operation: ${operation}`);
    }
  }

  return {
    clear: () => {
      sessionVersion += 1;
      refreshPromise = null;
      return vault.clear();
    },
    execute,
    login,
    migrateSession,
    restoreAccount,
  };
}

module.exports = {
  AtprotoError,
  createBlueskyGateway,
};
