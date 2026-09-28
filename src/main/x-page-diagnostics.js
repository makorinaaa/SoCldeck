function operation(url) {
  try {
    const parsed = new URL(url);
    if (!['x.com', 'api.x.com', 'twitter.com', 'api.twitter.com'].includes(parsed.hostname)) return null;
    return parsed.pathname.match(/\/graphql\/[^/]+\/(TweetDetail|TweetResultByRestId|TweetResultsByRestIds)$/)?.[1] || null;
  } catch { return null; }
}

function pageKind(url) {
  try {
    const parsed = new URL(url);
    if (!['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(parsed.hostname)) return null;
    return /^\/[^/]+\/status\/\d+/.test(parsed.pathname) ? 'post' : 'other';
  } catch { return null; }
}

// Store timing and outcomes only: never URLs, request bodies, cookies, or headers.
function createXPageDiagnostics({ save, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const events = [];
  const pending = new Map();
  const sessions = new WeakSet();
  let timer = null;
  function record(event) {
    events.push({ at: new Date(now()).toISOString(), ...event });
    if (events.length > 200) events.shift();
    if (!timer) timer = setTimer(() => {
      timer = null;
      try { save({ version: 1, events: events.slice() }); } catch {}
    }, 1000);
  }
  function attachSession(session) {
    if (sessions.has(session)) return;
    sessions.add(session);
    // These observation hooks do not replace request blocking or header handling.
    session.webRequest.onSendHeaders(details => {
      const name = operation(details.url);
      if (!name) return;
      if (pending.size >= 500) pending.delete(pending.keys().next().value);
      pending.set(details.id, now());
      record({ type: 'request', view: details.webContentsId, operation: name });
    });
    function complete(details, error) {
      const name = operation(details.url);
      if (!name) return;
      const start = pending.get(details.id);
      pending.delete(details.id);
      record({ type: error ? 'network-error' : 'response', view: details.webContentsId, operation: name,
        status: details.statusCode || 0, elapsedMs: start === undefined ? null : now() - start,
        ...(error ? { error: /^net::ERR_[A-Z0-9_]+$/.test(error) ? error : 'network-error' } : {}) });
    }
    session.webRequest.onCompleted(details => complete(details));
    session.webRequest.onErrorOccurred(details => complete(details, details.error || 'network-error'));
  }
  function attachContents(contents) {
    attachSession(contents.session);
    const navigation = (_, url, mainFrame = true) => {
      const page = pageKind(url);
      if (mainFrame && page) record({ type: 'navigation', view: contents.id, page });
    };
    contents.on('did-navigate', navigation);
    contents.on('did-navigate-in-page', navigation);
    contents.on('ipc-message', (_, channel, state) => {
      if (channel !== 'x-page-diagnostic' || pageKind(contents.getURL()) !== 'post') return;
      if (!state || !['waiting', 'visible', 'stalled', 'left'].includes(state.phase)) return;
      record({ type: 'page', view: contents.id, phase: state.phase,
        elapsedMs: Math.max(0, Math.min(Number(state.elapsedMs) || 0, 3600000)) });
    });
  }
  function blocked(details) {
    const name = operation(details.url);
    if (name) record({ type: 'adblock', view: details.webContentsId, operation: name });
  }
  function flush() {
    if (timer) clearTimer(timer);
    timer = null;
    try { save({ version: 1, events: events.slice() }); } catch {}
  }
  return { attachContents, blocked, flush };
}

module.exports = { createXPageDiagnostics, operation, pageKind };
