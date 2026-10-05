(function (global) {
  // Keeps the notifications X's own notification page fetched, per account. The hidden
  // notification reader is tapped like the home reader, so the notification center reads
  // X's data (with post ids) instead of the page's text.
  function createXNotificationCapture({
    tap,
    now = () => Date.now(),
    setTimeoutFn = (...args) => global.setTimeout?.(...args),
    clearTimeoutFn = (...args) => global.clearTimeout?.(...args),
    log = () => {},
    storage = global.localStorage,
    onFirstCapture = () => {},
    onItems = () => {},
  } = {}) {
    if (!tap?.attach || !tap?.onCaptured) throw new Error('X notification capture requires a timeline tap');
    const SOURCE_KEY = 'socialdeck_x_notification_source_v1';
    // After this many loads without recognizable data, an account keeps reading the page.
    const MAX_MISSES = 2;
    const MAX_ITEMS = 100;
    const partitions = new Map();
    const latest = new Map();
    const waiters = new Map();
    const misses = new Map();
    let capturedSources = {};
    try { capturedSources = JSON.parse(storage?.getItem(SOURCE_KEY) || '{}') || {}; } catch {}

    function rememberCaptured(partition) {
      if (capturedSources[partition]) return;
      capturedSources = { ...capturedSources, [partition]: true };
      try { storage?.setItem(SOURCE_KEY, JSON.stringify(capturedSources)); } catch {}
      // Identities change with the source: let the notification runtimes re-baseline once.
      onFirstCapture(partition);
    }

    // A continued page holds only newer or older notifications, not the newest list: it is
    // merged into the list a first page started (newest first, the incoming copy winning).
    function mergeItems(incoming, existing) {
      const seen = new Set();
      return [...incoming, ...existing]
        .filter(item => {
          const key = item?.id || '';
          if (!key) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => (Date.parse(b.indexedAt) || 0) - (Date.parse(a.indexedAt) || 0))
        .slice(0, MAX_ITEMS);
    }

    tap.onCaptured(payload => {
      const partition = partitions.get(payload?.webContentsId);
      if (!partition || payload.operation !== 'Notifications' || !Array.isArray(payload.notifications)) return;
      const current = latest.get(partition);
      if (payload.requestCursor && !current) return;
      const items = payload.requestCursor
        ? mergeItems(payload.notifications, current.items)
        : payload.notifications.slice(0, MAX_ITEMS);
      latest.set(partition, { at: now(), items });
      onItems(partition, items);
      misses.delete(partition);
      rememberCaptured(partition);
      log('notifications captured', payload.notifications.length);
      (waiters.get(partition) || []).splice(0).forEach(resolve => resolve());
    });

    async function attach(webContentsId, partition) {
      const attached = await Promise.resolve(tap.attach(webContentsId)).catch(() => false);
      if (attached) partitions.set(webContentsId, partition);
      return attached;
    }

    function detach(webContentsId) {
      partitions.delete(webContentsId);
    }

    // Raw items in the shape the notification center reads from the page, plus the post id.
    function toRawItems(items) {
      return items.map((item, sourceIndex) => ({
        sourceIndex,
        captured: true,
        text: item.text || '',
        postText: item.postText || '',
        reason: item.reason || null,
        targetId: item.targetId || '',
        targetUrl: item.targetUrl || '',
        profileUrl: item.profileUrl || '',
        actorName: item.actorName || '',
        actorHandle: item.actorHandle || '',
        avatar: item.avatar || '',
        indexedAt: item.indexedAt || '',
      }));
    }

    // Resolves with items captured after `since`, or null when X sent none in time.
    function wait(partition, since, timeoutMs = 5000) {
      const fresh = () => {
        const entry = latest.get(partition);
        return entry && entry.at >= since ? toRawItems(entry.items) : null;
      };
      const ready = fresh();
      if (ready) return Promise.resolve(ready);
      return new Promise(resolve => {
        const list = waiters.get(partition) || [];
        waiters.set(partition, list);
        let timer = null;
        const done = () => {
          clearTimeoutFn(timer);
          resolve(fresh());
        };
        list.push(done);
        timer = setTimeoutFn(() => {
          const index = list.indexOf(done);
          if (index >= 0) list.splice(index, 1);
          const result = fresh();
          if (!result && !hasCaptured(partition)) misses.set(partition, (misses.get(partition) || 0) + 1);
          resolve(result);
        }, timeoutMs);
      });
    }

    // Once an account's notifications came from X's data, the page text is never used again
    // for it: mixing both would give the same notification two identities.
    function hasCaptured(partition) {
      return latest.has(partition) || Boolean(capturedSources[partition]);
    }

    // 'captured': always X's data. 'page': X sent nothing recognizable, read the page.
    // 'unknown': not decided yet; wait briefly for X's data, then read the page.
    function mode(partition) {
      if (hasCaptured(partition)) return 'captured';
      return (misses.get(partition) || 0) >= MAX_MISSES ? 'page' : 'unknown';
    }

    // The captured notifications as X sent them, with their posts (native Columns draw them).
    function items(partition) {
      return latest.get(partition)?.items || null;
    }

    function last(partition) {
      const entry = latest.get(partition);
      return entry ? toRawItems(entry.items) : null;
    }

    function forget(partition = null) {
      if (partition) {
        latest.delete(partition);
        misses.delete(partition);
        const { [partition]: removed, ...rest } = capturedSources;
        capturedSources = rest;
      } else {
        latest.clear();
        misses.clear();
        capturedSources = {};
      }
      try { storage?.setItem(SOURCE_KEY, JSON.stringify(capturedSources)); } catch {}
    }

    return { attach, detach, forget, hasCaptured, items, last, mode, wait };
  }

  global.SocialDeckXNotificationCapture = { createXNotificationCapture };
})(window);
