const { normalizeCapturedResponse, timelineOperation } = require('./x-timeline-normalizer');

const MAX_BODY_BYTES = 8 * 1024 * 1024;

// The hidden pages only feed data to SocialDeck, which loads the media itself. Blocking it
// there saves the decoded images, video buffers and bandwidth of a second copy.
const HIDDEN_PAGE_BLOCKED_URLS = [
  '*://pbs.twimg.com/*',
  '*://video.twimg.com/*',
  '*://ton.twimg.com/*',
  '*://abs-0.twimg.com/emoji/*',
];

// X sends GraphQL variables in the query (GET) or the JSON body (POST). A cursor means
// the request continues a timeline instead of fetching its first page; seenTweetIds means
// the server may leave out posts the page already shows. Either way the response is not
// the complete first page.
function requestKind(request = {}) {
  const read = text => {
    try {
      return JSON.parse(text || '{}');
    } catch {
      return {};
    }
  };
  let variables = {};
  try {
    variables = read(new URL(request.url).searchParams.get('variables'));
  } catch {}
  if (!variables.cursor && request.postData) variables = read(request.postData).variables || {};
  return {
    cursor: typeof variables.cursor === 'string' ? variables.cursor : '',
    partial: Array.isArray(variables.seenTweetIds) && variables.seenTweetIds.length > 0,
  };
}

function requestCursor(request = {}) {
  return requestKind(request).cursor;
}

// Reads the timeline responses that X's own web client fetches inside a hidden
// WebView. Only the Network domain is enabled, so nothing is injected into the page
// and no extra requests are sent to X.
function createXTimelineTap({ resolveContents, logger = console } = {}) {
  const taps = new Map();

  // Posting with media needs X's media hosts: the composer previews uploads from them.
  async function setMediaBlocked(webContentsId, blocked) {
    const tap = taps.get(webContentsId);
    if (!tap) return false;
    try {
      await tap.contents.debugger.sendCommand('Network.setBlockedURLs', { urls: blocked ? HIDDEN_PAGE_BLOCKED_URLS : [] });
      return true;
    } catch {
      return false;
    }
  }

  function detach(webContentsId) {
    const tap = taps.get(webContentsId);
    if (!tap) return false;
    taps.delete(webContentsId);
    const { contents, onMessage, onDetach, onDestroyed } = tap;
    try { contents.debugger.removeListener('message', onMessage); } catch {}
    try { contents.debugger.removeListener('detach', onDetach); } catch {}
    try { contents.removeListener('destroyed', onDestroyed); } catch {}
    try { if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach(); } catch {}
    return true;
  }

  async function readBody(tap, requestId, { operation, url }) {
    try {
      const { body, base64Encoded } = await tap.contents.debugger.sendCommand('Network.getResponseBody', { requestId });
      if (typeof body !== 'string' || body.length > MAX_BODY_BYTES) return;
      const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
      const timeline = normalizeCapturedResponse(JSON.parse(text), operation, url);
      const kind = tap.cursors.get(requestId) || { cursor: '', partial: true };
      if (timeline) tap.onTimeline({ ...timeline, requestCursor: kind.cursor, firstPage: !kind.cursor && !kind.partial });
    } catch (error) {
      logger.warn('[XTimelineTap] Could not read timeline response', operation, error?.message || error);
    } finally {
      tap.cursors.delete(requestId);
    }
  }

  // Resolves once capturing is active, so the caller can load X right after.
  async function attach(webContentsId, onTimeline) {
    if (taps.has(webContentsId)) {
      taps.get(webContentsId).onTimeline = onTimeline;
      return true;
    }
    const contents = resolveContents(webContentsId);
    if (!contents || contents.isDestroyed()) return false;
    if (contents.debugger.isAttached()) return false;
    try {
      contents.debugger.attach('1.3');
    } catch (error) {
      logger.warn('[XTimelineTap] Debugger attach failed', error?.message || error);
      return false;
    }

    const pending = new Map();
    const tap = { contents, onTimeline, cursors: new Map() };
    tap.onMessage = (_, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        if (timelineOperation(params?.request?.url)) {
          if (tap.cursors.size >= 100) tap.cursors.delete(tap.cursors.keys().next().value);
          tap.cursors.set(params.requestId, requestKind(params.request));
        }
      } else if (method === 'Network.responseReceived') {
        const operation = timelineOperation(params?.response?.url);
        if (operation && params.response.status === 200) {
          pending.set(params.requestId, { operation, url: params.response.url });
        }
      } else if (method === 'Network.loadingFinished') {
        const response = pending.get(params?.requestId);
        if (!response) return;
        pending.delete(params.requestId);
        readBody(tap, params.requestId, response);
      } else if (method === 'Network.loadingFailed') {
        pending.delete(params?.requestId);
        tap.cursors.delete(params?.requestId);
      }
    };
    tap.onDetach = () => detach(webContentsId);
    tap.onDestroyed = () => detach(webContentsId);
    contents.debugger.on('message', tap.onMessage);
    contents.debugger.on('detach', tap.onDetach);
    contents.once('destroyed', tap.onDestroyed);
    taps.set(webContentsId, tap);

    // Chromium buffers every response body (images too) up to these limits; keep the
    // total small since only a few JSON responses are ever read.
    try {
      await contents.debugger.sendCommand('Network.enable', {
        maxTotalBufferSize: 16 * 1024 * 1024,
        maxResourceBufferSize: MAX_BODY_BYTES,
      });
    } catch (error) {
      logger.warn('[XTimelineTap] Network.enable failed', error?.message || error);
      detach(webContentsId);
      return false;
    }
    // Media blocking only saves resources; capturing works without it.
    await contents.debugger.sendCommand('Network.setBlockedURLs', { urls: HIDDEN_PAGE_BLOCKED_URLS })
      .catch(error => logger.warn('[XTimelineTap] Media blocking unavailable', error?.message || error));
    return true;
  }

  return {
    attach,
    detach,
    isAttached: webContentsId => taps.has(webContentsId),
    setMediaBlocked,
  };
}

module.exports = { HIDDEN_PAGE_BLOCKED_URLS, createXTimelineTap, requestCursor, requestKind };
