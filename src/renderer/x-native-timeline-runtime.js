(function (global) {
  // Native X Home Columns. This module owns the hidden home page per account (the reader),
  // what it captures, and the Columns that show it. Post lists, page scripts, Column drawing,
  // the post detail view and reactions live in their own x-native-* modules.
  const HOME_URL = 'https://x.com/home';
  const CAPTURE_TIMEOUT_MS = 20000;
  // Automatic reloads never run more often than this, whatever the column interval says.
  const MIN_AUTO_REFRESH_MS = 3 * 60 * 1000;
  const SOFT_REFRESH_RESULTS = new Set(['home-clicked', 'banner-clicked']);
  const LOAD_TIMEOUT_MS = 30000;
  // A long-lived x.com page slowly grows; memory cleanup reloads readers older than this.
  const READER_REFRESH_AGE_MS = 30 * 60 * 1000;
  // Earlier builds kept the newest posts in storage to show at startup; those are removed.
  const LEGACY_SNAPSHOT_KEY_PREFIX = 'socialdeck_x_native_snapshot_';
  // Columns load more on their own when scrolled this close to the end.
  const AUTO_LOAD_MORE_PX = 800;
  // Below this scroll offset a Column counts as "at the top" for the new-post badge.
  const AT_TOP_PX = 40;
  // A timeline response this long after SocialDeck last made the page fetch came from X's
  // own polling. While X keeps polling, the automatic refresh does not click Home itself.
  const DRIVEN_RESPONSE_MS = 8000;
  const X_POLLING_WINDOW_MS = 150 * 1000;
  const BADGE_AT_TOP_MS = 5000;

  function createXNativeTimelineRuntime({
    documentRef = global.document,
    getReaderHost = () => documentRef.getElementById('x-home-readers'),
    getPreloadPath = () => '',
    tap,
    renderPost,
    renderThread = null,
    statusRuntime = null,
    icons = {},
    relTime = () => '',
    blocksPost = () => false,
    intents = {},
    setTimeoutFn = global.setTimeout,
    clearTimeoutFn = global.clearTimeout,
    now = () => Date.now(),
    isBusy = () => false,
    createRefreshScript = null,
    getAccountId = async () => null,
    confirmAction = () => true,
    log = () => {},
    isAuthenticated = async () => true,
    storage = global.localStorage,
    createToggleScript = null,
    requestFrame = callback => (global.requestAnimationFrame ? global.requestAnimationFrame(callback) : callback()),
    createElementFromHtml,
  } = {}) {
    if (!tap?.attach || !tap?.onCaptured) throw new Error('X native timeline requires a timeline tap');
    if (typeof renderPost !== 'function') throw new Error('X native timeline requires a post renderer');
    const { MAX_POSTS, mergePosts, placeOnTop, reconcileFirstPage, sortValue, toMuteShape } = global.SocialDeckXNativePosts;
    const scripts = global.SocialDeckXNativePageScripts;
    const { baseSubtitleOf, createXNativeColumnView } = global.SocialDeckXNativeColumnView;

    const readers = new Map();
    const columns = new Map();
    const accountIds = new Map();
    removeLegacySnapshots();

    const reactions = global.SocialDeckXNativeReactions.createXNativeReactions({
      documentRef,
      statusRuntime,
      icons,
      intents,
      log,
      confirmAction,
      isBusy,
      createToggleScript,
      getReader: partition => readers.get(partition),
      updatePost,
      removePost,
      renderPartition,
      rerenderEverything,
    });
    const detail = global.SocialDeckXNativeDetail.createXNativeDetail({
      documentRef,
      statusRuntime,
      renderPost,
      renderThread,
      postOptions,
      handleInteractive,
      isMenuOpen: () => reactions.isMenuOpen(),
      updatePost,
      renderPartition,
      intents,
      log,
      setTimeoutFn,
      clearTimeoutFn,
    });
    const view = createXNativeColumnView({
      documentRef,
      renderPost,
      relTime,
      getPendingReaction: (kind, id, partition) => reactions.getPendingReaction(kind, id, partition),
      ...(createElementFromHtml ? { createElementFromHtml } : {}),
    });

    // The home timeline leaves out replies to other people, including this account's own
    // replies to others. Threads (replies to oneself) and replies to this account stay;
    // conversations remain available in the post detail view.
    function isReplyToOthers(post, partition) {
      if (!post?.replyTo) return false;
      const authorId = post.author?.id;
      if (post.replyToId) return post.replyToId !== authorId && post.replyToId !== accountIds.get(partition);
      return String(post.replyTo).toLowerCase() !== String(post.author?.handle || '').toLowerCase();
    }

    function showsInTimeline(post, partition) {
      return !isReplyToOthers(post, partition) && !blocksPost(toMuteShape(post));
    }

    // The account's own posts (and only those) can be deleted from SocialDeck.
    function postOptions(post, partition) {
      // The author decides: a post shown because someone else reposted it is still deletable.
      const own = Boolean(post?.author?.id) && accountIds.get(partition) === post.author.id;
      return { partition, own, deleting: reactions.isDeleting(partition, post?.id) };
    }

    function loadAccountId(partition) {
      if (accountIds.has(partition)) return;
      accountIds.set(partition, null);
      Promise.resolve(getAccountId(partition)).then(id => {
        if (!id) {
          accountIds.delete(partition);
          return;
        }
        accountIds.set(partition, String(id));
        renderPartition(partition);
      }).catch(() => accountIds.delete(partition));
    }

    tap.onCaptured(payload => {
      const statusPartition = statusRuntime?.partitionOf(payload?.webContentsId);
      if (statusPartition) {
        detail.handleStatusCapture(statusPartition, payload);
        return;
      }
      if (payload?.webContentsId == null) return;
      const reader = [...readers.values()].find(item => item.webContentsId === payload.webContentsId);
      if (!reader || !Array.isArray(payload.posts)) return;
      if (reader.switching) {
        if (payload.operation === 'CreateTweet' || !payload.firstPage) return;
        verifySwitchCapture(reader, payload);
        return;
      }
      // The page's selected tab decides which list a response belongs to; the operation
      // name is only a fallback until the tab is known.
      processCapture(reader, { ...payload, timeline: reader.pageTab || payload.timeline });
      if (payload.firstPage && !reader.pageTab) learnPageTab(reader);
    });

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
      renderReader(reader);
      if (shownBefore.size && !replace && payload.operation !== 'CreateTweet') {
        const arrived = reader.posts.filter(post => !shownBefore.has(post.id) && !post.local
          && sortValue(post) > previousTop && showsInTimeline(post, reader.partition));
        if (arrived.length) announceNewPosts(reader, arrived.length);
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
        renderReader(reader);
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

    // Following defaults to Recent. X remembers the choice, so this runs once per Column
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

    // Shows "+N" on the Column header. While the reader is scrolled down the count adds up
    // and stays until they return to the top; at the top it fades like Bluesky's.
    function announceNewPosts(reader, count) {
      columnsFor(reader).forEach(column => {
        if (!column.badge) return;
        const atTop = (column.host.scrollTop || 0) < AT_TOP_PX;
        column.unseen = (atTop ? 0 : column.unseen || 0) + count;
        column.badge.textContent = `+${column.unseen}`;
        column.badge.title = atTop ? '新着ポスト' : '新着ポスト（クリックで先頭へ）';
        column.badge.style.display = '';
        clearTimeoutFn(column.badgeTimer);
        if (atTop) column.badgeTimer = setTimeoutFn(() => clearBadge(column), BADGE_AT_TOP_MS);
      });
    }

    function clearBadge(column) {
      clearTimeoutFn(column.badgeTimer);
      column.unseen = 0;
      if (column.badge) column.badge.style.display = 'none';
    }

    function columnsFor(reader) {
      return [...columns.values()].filter(column => column.partition === reader.partition);
    }

    function setStatus(reader, status, message = '') {
      reader.status = status;
      reader.message = message;
      if (status !== 'ready') {
        reader.waiters.splice(0).forEach(resolve => resolve({ status: 'failed', detail: status, error: new Error(message) }));
      }
      renderReader(reader);
    }

    // Removes posts saved by earlier builds for the startup preview.
    function removeLegacySnapshots() {
      try {
        const keys = [];
        for (let index = 0; index < (storage?.length || 0); index += 1) {
          const key = storage.key(index);
          if (key?.startsWith(LEGACY_SNAPSHOT_KEY_PREFIX)) keys.push(key);
        }
        keys.forEach(key => storage.removeItem(key));
      } catch {}
    }

    function createReader(partition) {
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

    function disposeReader(reader) {
      clearTimeoutFn(reader.loadWatchdog);
      clearTimeoutFn(reader.sortingTimer);
      readers.delete(reader.partition);
      reader.waiters.splice(0).forEach(resolve => resolve({ status: 'deferred', detail: 'disposed' }));
      if (reader.webContentsId !== null) tap.detach?.(reader.webContentsId)?.catch?.(() => {});
      reader.webview.remove();
    }

    function renderColumn(column, reader) {
      view.render(column, {
        reader,
        visible: reader.switching ? [] : reader.posts.filter(post => showsInTimeline(post, column.partition)),
        optionsFor: post => postOptions(post, column.partition),
      });
    }

    function renderReader(reader) {
      columnsFor(reader).forEach(column => renderColumn(column, reader));
    }

    // Viewer state (liked / reposted) differs per account, so posts are looked up per account.
    function findPost(id, partition) {
      if (!id) return null;
      const candidates = [...(readers.get(partition)?.posts || []), ...detail.postsOf(partition)];
      for (const post of candidates) {
        if (post?.id === id) return post;
        if (post?.quoted?.id === id) return post.quoted;
      }
      return null;
    }

    function updatePost(id, update, partition) {
      const apply = post => {
        if (!post) return post;
        const next = post.id === id ? { ...post, ...update(post) } : post;
        return next.quoted?.id === id ? { ...next, quoted: { ...next.quoted, ...update(next.quoted) } } : next;
      };
      const reader = readers.get(partition);
      if (reader) reader.posts = reader.posts.map(apply);
      detail.applyUpdate(apply, partition);
    }

    // A deleted post is gone for every account, so it leaves every Column, the open detail
    // view and the cached status pages, not only those of the account that deleted it.
    function removePost(id) {
      readers.forEach(reader => { reader.posts = reader.posts.filter(post => post?.id !== id); });
      detail.removePost(id);
    }

    function rerenderEverything() {
      readers.forEach(renderReader);
      detail.render();
    }

    // Reactions, deletions and status pages only touch one account's posts.
    function renderPartition(partition) {
      const reader = readers.get(partition);
      if (reader) renderReader(reader);
      if (detail.isOpenFor(partition)) detail.render();
    }

    function handleInteractive(event, partition) {
      const target = event.target;
      if (target?.closest?.('a[href]')) return true;
      const actionButton = target?.closest?.('[data-x-action]');
      if (actionButton) {
        event.preventDefault();
        event.stopPropagation();
        const post = findPost(actionButton.closest?.('[data-x-id]')?.dataset.xId, partition);
        if (!post) return true;
        const action = actionButton.dataset.xAction;
        if (action === 'reply') {
          intents.reply?.({ id: post.id, url: post.url, handle: post.author?.handle || '', partition });
        } else if (action === 'like') {
          reactions.toggle('like', post, partition);
        } else if (action === 'repost') {
          reactions.openRepostMenu(actionButton, post, partition);
        } else if (action === 'more') {
          reactions.openMoreMenu(actionButton, post, partition);
        }
        return true;
      }
      const image = target?.closest?.('img[data-x-image-index]');
      if (image) {
        event.preventDefault();
        event.stopPropagation();
        try {
          const urls = JSON.parse(image.closest('.p-imgs')?.dataset.urls || '[]');
          if (urls.length) intents.openImages?.({ urls, startIndex: Number(image.dataset.xImageIndex) || 0 });
        } catch {}
        return true;
      }
      if (target?.closest?.('video')) return true;
      const quote = target?.closest?.('.p-quote[data-x-url]');
      const holder = quote || target?.closest?.('[data-x-id]');
      if (holder) {
        const id = quote ? quoteId(quote) : holder.dataset.xId;
        const post = findPost(id, partition);
        if (post) detail.open(post, partition);
        else if (holder.dataset.xUrl) intents.openExternal?.({ url: holder.dataset.xUrl });
        return true;
      }
      return false;
    }

    function quoteId(element) {
      const match = /\/status\/(\d+)/.exec(element.dataset.xUrl || '');
      return match ? match[1] : '';
    }

    function handleClick(column, event) {
      const target = event.target;
      const tab = target?.closest?.('[data-x-timeline]');
      if (tab) {
        event.preventDefault();
        switchTimeline(column.partition, tab.dataset.xTimeline);
        return;
      }
      if (target?.closest?.('[data-x-native-open-login]')) {
        event.preventDefault();
        openLogin(column);
        return;
      }
      if (target?.closest?.('[data-x-native-more]')) {
        event.preventDefault();
        loadMore(column.id);
        return;
      }
      handleInteractive(event, column.partition);
    }

    function mount({ id, partition, host, subtitle = null, badge = null }) {
      const column = {
        id,
        partition,
        host,
        subtitle,
        baseSubtitle: baseSubtitleOf(subtitle?.textContent),
        rendered: new WeakMap(),
        signature: null,
        badge,
        unseen: 0,
      };
      column.handleBadgeClick = event => {
        event.stopPropagation?.();
        host.scrollTo?.({ top: 0, behavior: 'smooth' });
        clearBadge(column);
      };
      badge?.addEventListener?.('click', column.handleBadgeClick);
      column.onClick = event => handleClick(column, event);
      column.handleKeyDown = event => {
        if (event.key !== 'Enter' || !event.target?.classList?.contains('x-native-post')) return;
        const post = findPost(event.target.dataset.xId, partition);
        if (post) detail.open(post, partition);
      };
      column.handleScroll = () => {
        if (column.scrollQueued) return;
        column.scrollQueued = true;
        requestFrame(() => {
          column.scrollQueued = false;
          if ((host.scrollTop || 0) < AT_TOP_PX && column.unseen) clearBadge(column);
          const current = readers.get(partition);
          if (!current || current.status !== 'ready' || current.loadingMore || !current.posts.length) return;
          if (host.scrollHeight - host.scrollTop - host.clientHeight < AUTO_LOAD_MORE_PX) loadMore(id);
        });
      };
      // Pressing a post starts the status page before the click completes.
      column.handlePointerDown = event => {
        if (event.target?.closest?.('[data-x-id]')) statusRuntime?.prewarm?.(partition);
      };
      host.addEventListener('click', column.onClick);
      host.addEventListener('keydown', column.handleKeyDown);
      host.addEventListener('scroll', column.handleScroll, { passive: true });
      host.addEventListener('pointerdown', column.handlePointerDown);
      columns.set(id, column);
      loadAccountId(partition);
      const reader = readers.get(partition) || createReader(partition);
      if (!reader) {
        host.innerHTML = '<div class="feed-empty">X のタイムラインを開始できませんでした</div>';
        return false;
      }
      renderColumn(column, reader);
      return true;
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

    async function refresh(id, { force = false, reload = false } = {}) {
      const column = columns.get(id);
      const reader = column && readers.get(column.partition);
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
        log('soft refresh', id, result);
        if (SOFT_REFRESH_RESULTS.has(result)) return captured;
        captured.cancel();
      }

      if (!force && now() - reader.lastLoadAt < MIN_AUTO_REFRESH_MS) {
        return { status: 'deferred', detail: 'throttled' };
      }
      log('reload', id);
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
      renderReader(reader);
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
      renderReader(reader);
      if (succeeded && timeline === 'following') ensureRecentSort(reader);
      if (!succeeded) {
        intents.onOutcome?.({ kind: 'timeline', status: 'failed', error: new Error(result === 'clicked' || result === 'already'
          ? 'X からタイムラインを受け取れませんでした。更新ボタンで再試行してください'
          : 'X のタブを切り替えられませんでした') });
      }
      return succeeded;
    }

    // Shows X's own login page inside the Column. Once X lands on home, the hidden reader
    // reloads with the new session.
    function openLogin(column) {
      if (column.login) return;
      const reader = readers.get(column.partition);
      const webview = documentRef.createElement('webview');
      webview.className = 'x-native-login-view';
      webview.setAttribute('partition', column.partition);
      const preloadPath = getPreloadPath();
      if (preloadPath) webview.setAttribute('preload', preloadPath);
      const finish = event => {
        const url = event?.url || '';
        if (!/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/home(?:[?#]|$)/.test(url)) return;
        closeLogin(column);
        intents.loginCompleted?.(column.partition);
        if (reader) {
          setStatus(reader, 'loading');
          loadHome(reader);
        }
      };
      webview.addEventListener('did-navigate', finish);
      webview.addEventListener('did-navigate-in-page', finish);
      webview.src = 'https://x.com/i/flow/login';
      column.login = webview;
      column.signature = null;
      column.host.innerHTML = '';
      column.host.classList?.add('x-native-login-host');
      column.host.appendChild(webview);
    }

    function closeLogin(column) {
      if (!column.login) return;
      column.login.remove();
      column.login = null;
      column.host.classList?.remove('x-native-login-host');
      column.signature = null;
      const reader = readers.get(column.partition);
      if (reader) renderColumn(column, reader);
    }

    async function loadMore(id) {
      const column = columns.get(id);
      const reader = column && readers.get(column.partition);
      if (!reader || reader.loadingMore || reader.webContentsId === null || isBusy()) return false;
      reader.loadingMore = true;
      renderReader(reader);
      markDriven(reader);
      const captured = waitForCapture(reader);
      try {
        await reader.webview.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight); true');
      } catch {}
      const result = await captured;
      if (reader.loadingMore) {
        reader.loadingMore = false;
        renderReader(reader);
      }
      return result.status === 'succeeded';
    }

    async function refreshPartition(partition, options = {}) {
      const column = [...columns.values()].find(item => item.partition === partition);
      return column ? refresh(column.id, options) : { status: 'deferred', detail: 'unavailable' };
    }

    function scrollTop(id) {
      columns.get(id)?.host?.scrollTo?.({ top: 0, behavior: 'smooth' });
    }

    function updateRelativeTimes() {
      const hosts = [...columns.values()].map(column => column.host);
      const overlay = detail.overlay();
      if (overlay) hosts.push(overlay);
      hosts.forEach(view.refreshTimes);
    }

    function dispose(id) {
      const column = columns.get(id);
      if (!column) return;
      column.login?.remove();
      columns.delete(id);
      column.host.removeEventListener('click', column.onClick);
      column.host.removeEventListener('keydown', column.handleKeyDown);
      column.host.removeEventListener('scroll', column.handleScroll);
      column.badge?.removeEventListener?.('click', column.handleBadgeClick);
      clearTimeoutFn(column.badgeTimer);
      column.host.removeEventListener('pointerdown', column.handlePointerDown);
      const reader = readers.get(column.partition);
      if (reader && columnsFor(reader).length === 0) {
        disposeReader(reader);
        statusRuntime?.dispose(column.partition);
        accountIds.delete(column.partition);
        detail.forget(column.partition, { closeOpen: true });
      }
    }

    // A removed account's posts and caches must never show up for whoever uses the slot next.
    function forgetAccount(partition = null) {
      [...readers.values()].forEach(reader => {
        if (partition && reader.partition !== partition) return;
        reader.posts = [];
        accountIds.delete(reader.partition);
        detail.forget(reader.partition);
        renderReader(reader);
      });
    }

    // Called by SocialDeck's periodic memory cleanup.
    function trim() {
      let readersReloaded = 0;
      readers.forEach(reader => {
        if (reader.posts.length > MAX_POSTS) reader.posts = reader.posts.slice(0, MAX_POSTS);
        const idle = !reader.switching && !reader.loadingMore && !reader.waiters.length && !isBusy();
        if (idle && reader.status === 'ready' && reader.webContentsId !== null
          && now() - reader.lastLoadAt >= READER_REFRESH_AGE_MS && !documentRef.hidden) {
          loadHome(reader);
          readersReloaded += 1;
        }
      });
      const statusReadersDisposed = statusRuntime?.disposeAll?.() || 0;
      return { readersReloaded, statusReadersDisposed };
    }

    // The hidden home page's notification badge tells whether X has new notifications, so
    // the notification page only needs loading when the count changes.
    async function readNotificationBadge(partition) {
      const reader = readers.get(partition);
      if (!reader || reader.status !== 'ready' || reader.webContentsId === null) return null;
      const count = await reader.webview.executeJavaScript(scripts.createNotificationBadgeScript()).catch(() => null);
      return Number.isInteger(count) && count >= 0 ? count : null;
    }

    function getMemoryStats() {
      return {
        readers: readers.size,
        posts: [...readers.values()].reduce((total, reader) => total + reader.posts.length, 0),
        statusReaders: statusRuntime?.count?.() || 0,
      };
    }

    return {
      closeDetail: detail.close,
      dispose,
      forgetAccount,
      getMemoryStats,
      getPendingReaction: reactions.getPendingReaction,
      has: id => columns.has(id),
      loadMore,
      mount,
      openPost: detail.open,
      openPostFrom: detail.openFrom,
      readNotificationBadge,
      refresh,
      refreshPartition,
      rerenderAll: rerenderEverything,
      scrollTop,
      switchTimeline,
      trim,
      updateRelativeTimes,
    };
  }

  global.SocialDeckXNativeTimelineRuntime = { createXNativeTimelineRuntime };
})(window);
