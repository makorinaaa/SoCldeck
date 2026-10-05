(function (global) {
  const HOME_URL = 'https://x.com/home';
  const CAPTURE_TIMEOUT_MS = 20000;
  // Automatic reloads never run more often than this, whatever the column interval says.
  const MIN_AUTO_REFRESH_MS = 3 * 60 * 1000;
  const SOFT_REFRESH_RESULTS = new Set(['home-clicked', 'banner-clicked']);
  const LOAD_TIMEOUT_MS = 30000;
  // A long-lived x.com page slowly grows; memory cleanup reloads readers older than this.
  const READER_REFRESH_AGE_MS = 30 * 60 * 1000;
  // A timeline response this long after SocialDeck last made the page fetch came from X's
  // own polling. While X keeps polling, the automatic refresh does not click Home itself.
  const DRIVEN_RESPONSE_MS = 8000;
  const X_POLLING_WINDOW_MS = 150 * 1000;

  // One hidden x.com/home page per account (a "reader") and the timeline it captures: loading,
  // refreshing, switching tabs, loading more and the Following sort. It knows nothing about
  // Columns; it reports changes through notifyChange and newly arrived posts through notifyNewPosts.
  function createXNativeReaders({
    documentRef = global.document,
    getReaderHost = () => documentRef.getElementById('x-home-readers'),
    getPreloadPath = () => '',
    tap,
    isAuthenticated = async () => true,
    isBusy = () => false,
    createRefreshScript = null,
    intents = {},
    log = () => {},
    now = () => Date.now(),
    setTimeoutFn = global.setTimeout,
    clearTimeoutFn = global.clearTimeout,
    notifyChange = () => {},
    notifyNewPosts = () => {},
  } = {}) {
    const { MAX_POSTS, mergePosts, placeOnTop, reconcileFirstPage, sortValue } = global.SocialDeckXNativePosts;
    const scripts = global.SocialDeckXNativePageScripts;
    const readers = new Map();

    function findByWebContentsId(webContentsId) {
      if (webContentsId == null) return null;
      return [...readers.values()].find(reader => reader.webContentsId === webContentsId) || null;
    }

    // A timeline response from a reader's page.
    function handleCapture(payload) {
      const reader = findByWebContentsId(payload?.webContentsId);
      if (!reader || !Array.isArray(payload.posts)) return false;
      if (reader.switching) {
        if (payload.operation !== 'CreateTweet' && payload.firstPage) verifySwitchCapture(reader, payload);
        return true;
      }
      // The page's selected tab decides which list a response belongs to; the operation
      // name is only a fallback until the tab is known.
      processCapture(reader, { ...payload, timeline: reader.pageTab || payload.timeline });
      if (payload.firstPage && !reader.pageTab) learnPageTab(reader);
      return true;
    }

    function processCapture(reader, payload, { replace = false } = {}) {
      if (replace || (reader.sorting && payload.firstPage && payload.timeline === 'following' && payload.operation !== 'CreateTweet')) {
        reader.sorting = false;
        clearTimeoutFn(reader.sortingTimer);
        reader.posts = [];
      }
      const incoming = payload.operation === 'CreateTweet'
        ? placeOnTop(payload.posts.filter(post => !reader.posts.some(shown => shown.id === post.id)), reader.posts)
        : payload.posts;
      const shownBefore = new Set(reader.posts.map(post => post.id));
      const previousTop = reader.posts.reduce((max, post) => (post.local ? max : (sortValue(post) > max ? sortValue(post) : max)), 0n);
      const isFirstPage = payload.operation !== 'CreateTweet' && payload.firstPage === true;
      intents.postsSeen?.(reader.partition, payload.posts);
      if (payload.operation !== 'CreateTweet' && now() - (reader.lastDrivenAt || 0) > DRIVEN_RESPONSE_MS) {
        reader.lastPolledAt = now();
        log('x polled', payload.operation, payload.posts.length);
      }
      log('captured', payload.operation, payload.timeline, payload.posts.length, isFirstPage ? 'first page' : 'partial');
      const base = isFirstPage ? reconcileFirstPage(reader.posts, payload.posts, payload.timeline) : reader.posts;
      reader.posts = mergePosts(base, incoming);
      reader.timeline = payload.timeline || reader.timeline;
      reader.status = 'ready';
      reader.loadingMore = false;
      const waiters = reader.waiters.splice(0);
      waiters.forEach(resolve => resolve({ status: 'succeeded', detail: 'captured' }));
      notifyChange(reader);
      if (shownBefore.size && !replace && payload.operation !== 'CreateTweet') {
        const arrived = reader.posts.filter(post => !shownBefore.has(post.id) && !post.local && sortValue(post) > previousTop);
        if (arrived.length) notifyNewPosts(reader, arrived);
      }
      if (isFirstPage && reader.timeline === 'following' && !reader.sortChecked && !reader.switching) {
        ensureRecentSort(reader);
      }
    }

    async function readPageTab(reader) {
      const tab = await reader.webview.executeJavaScript(scripts.createReadTabScript()).catch(() => null);
      return tab === 'following' || tab === 'for-you' ? tab : null;
    }

    async function learnPageTab(reader) {
      const tab = await readPageTab(reader);
      if (!tab || reader.pageTab || reader.switching) return;
      reader.pageTab = tab;
      if (reader.timeline !== tab) {
        reader.timeline = tab;
        notifyChange(reader);
        if (tab === 'following' && !reader.sortChecked) ensureRecentSort(reader);
      }
    }

    // While switching, a first page counts only if X's page really shows the chosen tab.
    async function verifySwitchCapture(reader, payload) {
      const target = reader.switching;
      const tab = (await readPageTab(reader)) || payload.timeline;
      if (reader.switching !== target) return;
      log('switch capture', payload.operation, tab);
      if (tab === target) {
        reader.pageTab = target;
        processCapture(reader, { ...payload, timeline: target }, { replace: true });
        return;
      }
      // The reload reopened the other tab: X did not keep the click, so select it again.
      if (!reader.reselected) {
        reader.reselected = true;
        reader.webview.executeJavaScript(scripts.createSelectTabScript(target)).catch(() => {});
      }
    }

    // Following defaults to Recent. X remembers the choice, so this runs once per reader
    // start and after switching to Following.
    async function ensureRecentSort(reader) {
      if (isBusy()) return;
      reader.sortChecked = true;
      markDriven(reader);
      const result = await reader.webview.executeJavaScript(scripts.createFollowingRecentScript()).catch(() => 'failed');
      log('following sort', result);
      if (result !== 'selected') return;
      reader.sorting = true;
      clearTimeoutFn(reader.sortingTimer);
      reader.sortingTimer = setTimeoutFn(() => { reader.sorting = false; }, CAPTURE_TIMEOUT_MS);
    }

    function setStatus(reader, status, message = '') {
      reader.status = status;
      reader.message = message;
      if (status !== 'ready') {
        reader.waiters.splice(0).forEach(resolve => resolve({ status: 'failed', detail: status, error: new Error(message) }));
      }
      notifyChange(reader);
    }

    function create(partition) {
      const host = getReaderHost();
      if (!host) return null;
      const webview = documentRef.createElement('webview');
      webview.id = `x-home-reader-${partition.replace(/[^a-z0-9-]/gi, '_')}`;
      webview.setAttribute('partition', partition);
      webview.setAttribute('webpreferences', 'backgroundThrottling=false');
      const preloadPath = getPreloadPath();
      if (preloadPath) webview.setAttribute('preload', preloadPath);
      const reader = {
        partition,
        webview,
        webContentsId: null,
        posts: [],
        timeline: null,
        status: 'loading',
        message: '',
        loadingMore: false,
        lastLoadAt: now(),
        waiters: [],
        switching: null,
        pageTab: null,
      };

      const onNavigate = event => {
        if (scripts.isLoginUrl(event?.url)) setStatus(reader, 'login', 'このアカウントで X にログインしてください');
      };
      webview.addEventListener('did-navigate', onNavigate);
      webview.addEventListener('did-navigate-in-page', onNavigate);
      webview.addEventListener('did-fail-load', event => {
        if (event?.errorCode === -3 || event?.isMainFrame === false) return;
        setStatus(reader, 'error', 'X を読み込めませんでした');
      });
      webview.addEventListener('dom-ready', async () => {
        if (reader.webContentsId !== null) return;
        reader.webContentsId = webview.getWebContentsId();
        const attached = await tap.attach(reader.webContentsId).catch(() => false);
        if (!attached) {
          setStatus(reader, 'error', 'タイムラインの取得を開始できませんでした');
          return;
        }
        if (!await Promise.resolve(isAuthenticated(partition)).catch(() => true)) {
          setStatus(reader, 'login', 'このアカウントで X にログインしてください');
          return;
        }
        loadHome(reader);
      });
      webview.src = 'about:blank';
      host.appendChild(webview);
      readers.set(partition, reader);
      return reader;
    }

    function ensure(partition) {
      return readers.get(partition) || create(partition);
    }

    function markDriven(reader) {
      reader.lastDrivenAt = now();
    }

    // Loads X's home in the reader; if no timeline arrives the Column stops spinning and
    // offers the refresh button instead of waiting forever.
    function loadHome(reader) {
      reader.lastLoadAt = now();
      markDriven(reader);
      reader.webview.loadURL(HOME_URL).catch(() => {});
      clearTimeoutFn(reader.loadWatchdog);
      reader.loadWatchdog = setTimeoutFn(() => {
        if (readers.get(reader.partition) === reader && reader.status === 'loading') {
          setStatus(reader, 'error', 'タイムラインを読み込めませんでした。更新ボタンで再試行してください');
        }
      }, LOAD_TIMEOUT_MS);
    }

    // After signing in on X: the reader starts over with the new session.
    function restart(partition) {
      const reader = readers.get(partition);
      if (!reader) return;
      setStatus(reader, 'loading');
      loadHome(reader);
    }

    function dispose(partition) {
      const reader = readers.get(partition);
      if (!reader) return;
      clearTimeoutFn(reader.loadWatchdog);
      clearTimeoutFn(reader.sortingTimer);
      readers.delete(partition);
      reader.waiters.splice(0).forEach(resolve => resolve({ status: 'deferred', detail: 'disposed' }));
      if (reader.webContentsId !== null) tap.detach?.(reader.webContentsId)?.catch?.(() => {});
      reader.webview.remove();
    }

    function waitForCapture(reader, timeoutMs = CAPTURE_TIMEOUT_MS) {
      let cancel = () => {};
      const promise = new Promise(resolve => {
        let timer = null;
        const done = result => {
          clearTimeoutFn(timer);
          resolve(result);
        };
        const remove = () => {
          const index = reader.waiters.indexOf(done);
          if (index >= 0) reader.waiters.splice(index, 1);
        };
        timer = setTimeoutFn(() => {
          remove();
          resolve({ status: 'deferred', detail: 'no-timeline-response' });
        }, timeoutMs);
        cancel = () => {
          clearTimeoutFn(timer);
          remove();
        };
        reader.waiters.push(done);
      });
      promise.cancel = cancel;
      return promise;
    }

    async function refresh(partition, { force = false, reload = false, label = partition } = {}) {
      const reader = readers.get(partition);
      if (!reader) return { status: 'deferred', detail: 'unavailable' };
      if (reader.webContentsId === null) return { status: 'deferred', detail: 'starting' };
      // Several columns may share one reader: join an in-flight reload instead of reloading again.
      if (reader.waiters.length) return waitForCapture(reader);
      if (isBusy()) return { status: 'deferred', detail: 'posting' };
      if (!force && documentRef.hidden) return { status: 'deferred', detail: 'hidden' };

      // Like a WebView Home Column, ask X for new posts by clicking Home: one light request.
      // The refresh button instead reloads the page so X sends a fresh first page.
      if (!force && reader.lastPolledAt && now() - reader.lastPolledAt < X_POLLING_WINDOW_MS) {
        return { status: 'succeeded', detail: 'x-polling' };
      }
      if (!reload && reader.status === 'ready' && createRefreshScript) {
        markDriven(reader);
        const captured = waitForCapture(reader);
        let result = 'failed';
        try {
          // X skips the refresh unless the page is at the top: scroll and refresh in one call.
          result = await reader.webview.executeJavaScript(`(window.scrollTo(0, 0), ${createRefreshScript('home', { allowForYou: true })})`);
        } catch {}
        log('soft refresh', label, result);
        if (SOFT_REFRESH_RESULTS.has(result)) return captured;
        captured.cancel();
      }

      if (!force && now() - reader.lastLoadAt < MIN_AUTO_REFRESH_MS) {
        return { status: 'deferred', detail: 'throttled' };
      }
      log('reload', label);
      reader.lastLoadAt = now();
      const captured = waitForCapture(reader);
      if (reader.status !== 'ready') setStatus(reader, 'loading');
      loadHome(reader);
      return captured;
    }

    // Switches the account's home between For you and Following by clicking X's own tab.
    // X remembers the tab, so the choice survives restarts.
    async function switchTimeline(partition, timeline) {
      const reader = readers.get(partition);
      if (!reader || reader.webContentsId === null || reader.switching || isBusy()) return false;
      if (!['for-you', 'following'].includes(timeline) || reader.timeline === timeline) return false;
      reader.switching = timeline;
      reader.reselected = false;
      notifyChange(reader);
      // Clicking only changes X's remembered tab: X may show that tab from its cache without
      // a request. Reloading right after makes X fetch the chosen tab's first page.
      markDriven(reader);
      const result = await reader.webview.executeJavaScript(scripts.createSelectTabScript(timeline)).catch(() => 'failed');
      log('switch timeline', timeline, result);
      let succeeded = false;
      if (result === 'clicked' || result === 'already') {
        reader.pageTab = null;
        const captured = waitForCapture(reader);
        loadHome(reader);
        succeeded = (await captured).status === 'succeeded' && reader.timeline === timeline;
      }
      reader.switching = null;
      notifyChange(reader);
      if (succeeded && timeline === 'following') ensureRecentSort(reader);
      if (!succeeded) {
        intents.onOutcome?.({ kind: 'timeline', status: 'failed', error: new Error(result === 'clicked' || result === 'already'
          ? 'X からタイムラインを受け取れませんでした。更新ボタンで再試行してください'
          : 'X のタブを切り替えられませんでした') });
      }
      return succeeded;
    }

    async function loadMore(partition) {
      const reader = readers.get(partition);
      if (!reader || reader.loadingMore || reader.webContentsId === null || isBusy()) return false;
      reader.loadingMore = true;
      notifyChange(reader);
      markDriven(reader);
      const captured = waitForCapture(reader);
      try {
        await reader.webview.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight); true');
      } catch {}
      const result = await captured;
      if (reader.loadingMore) {
        reader.loadingMore = false;
        notifyChange(reader);
      }
      return result.status === 'succeeded';
    }

    // The hidden home page's notification badge tells whether X has new notifications, so
    // the notification page only needs loading when the count changes.
    async function readNotificationBadge(partition) {
      const reader = readers.get(partition);
      if (!reader || reader.status !== 'ready' || reader.webContentsId === null) return null;
      const count = await reader.webview.executeJavaScript(scripts.createNotificationBadgeScript()).catch(() => null);
      return Number.isInteger(count) && count >= 0 ? count : null;
    }

    // Memory cleanup: trims long lists and resets pages that have been open a long time.
    function trim() {
      let reloaded = 0;
      readers.forEach(reader => {
        if (reader.posts.length > MAX_POSTS) reader.posts = reader.posts.slice(0, MAX_POSTS);
        const idle = !reader.switching && !reader.loadingMore && !reader.waiters.length && !isBusy();
        if (idle && reader.status === 'ready' && reader.webContentsId !== null
          && now() - reader.lastLoadAt >= READER_REFRESH_AGE_MS && !documentRef.hidden) {
          loadHome(reader);
          reloaded += 1;
        }
      });
      return reloaded;
    }

    return {
      all: () => [...readers.values()],
      count: () => readers.size,
      dispose,
      ensure,
      get: partition => readers.get(partition),
      handleCapture,
      loadMore,
      readNotificationBadge,
      refresh,
      restart,
      switchTimeline,
      trim,
    };
  }

  global.SocialDeckXNativeReaders = { createXNativeReaders };
})(window);
