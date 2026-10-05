(function (global) {
  // Native X Home Columns: mounting Columns on an account's hidden home page (a reader),
  // their header badge, login view, clicks, and the posts they show. The reader itself, post
  // lists, page scripts, drawing, the detail view and reactions live in x-native-* modules.

  // Earlier builds kept the newest posts in storage to show at startup; those are removed.
  const LEGACY_SNAPSHOT_KEY_PREFIX = 'socialdeck_x_native_snapshot_';
  // Columns load more on their own when scrolled this close to the end.
  const AUTO_LOAD_MORE_PX = 800;
  // Below this scroll offset a Column counts as "at the top" for the new-post badge.
  const AT_TOP_PX = 40;
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
    const { toMuteShape } = global.SocialDeckXNativePosts;
    const { baseSubtitleOf, createXNativeColumnView } = global.SocialDeckXNativeColumnView;

    const columns = new Map();
    const accountIds = new Map();
    removeLegacySnapshots();

    const readers = global.SocialDeckXNativeReaders.createXNativeReaders({
      documentRef,
      getReaderHost,
      getPreloadPath,
      tap,
      isAuthenticated,
      isBusy,
      createRefreshScript,
      intents,
      log,
      now,
      setTimeoutFn,
      clearTimeoutFn,
      notifyChange: reader => renderReader(reader),
      notifyNewPosts: (reader, posts) => {
        const shown = posts.filter(post => showsInTimeline(post, reader.partition));
        if (shown.length) announceNewPosts(reader, shown.length);
      },
    });
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

    tap.onCaptured(payload => {
      const statusPartition = statusRuntime?.partitionOf(payload?.webContentsId);
      if (statusPartition) {
        detail.handleStatusCapture(statusPartition, payload);
        return;
      }
      readers.handleCapture(payload);
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
      readers.all().forEach(reader => { reader.posts = reader.posts.filter(post => post?.id !== id); });
      detail.removePost(id);
    }

    function rerenderEverything() {
      readers.all().forEach(renderReader);
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
        readers.switchTimeline(column.partition, tab.dataset.xTimeline);
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
      const reader = readers.ensure(partition);
      if (!reader) {
        host.innerHTML = '<div class="feed-empty">X のタイムラインを開始できませんでした</div>';
        return false;
      }
      renderColumn(column, reader);
      return true;
    }

    function refresh(id, options = {}) {
      const column = columns.get(id);
      if (!column) return Promise.resolve({ status: 'deferred', detail: 'unavailable' });
      return readers.refresh(column.partition, { ...options, label: id });
    }

    // Shows X's own login page inside the Column. Once X lands on home, the hidden reader
    // starts over with the new session.
    function openLogin(column) {
      if (column.login) return;
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
        readers.restart(column.partition);
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

    function loadMore(id) {
      const column = columns.get(id);
      return column ? readers.loadMore(column.partition) : Promise.resolve(false);
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
        readers.dispose(column.partition);
        statusRuntime?.dispose(column.partition);
        accountIds.delete(column.partition);
        detail.forget(column.partition, { closeOpen: true });
      }
    }

    // A removed account's posts and caches must never show up for whoever uses the slot next.
    function forgetAccount(partition = null) {
      readers.all().forEach(reader => {
        if (partition && reader.partition !== partition) return;
        reader.posts = [];
        accountIds.delete(reader.partition);
        detail.forget(reader.partition);
        renderReader(reader);
      });
    }

    // Called by SocialDeck's periodic memory cleanup.
    function trim() {
      const readersReloaded = readers.trim();
      const statusReadersDisposed = statusRuntime?.disposeAll?.() || 0;
      return { readersReloaded, statusReadersDisposed };
    }

    function getMemoryStats() {
      return {
        readers: readers.count(),
        posts: readers.all().reduce((total, reader) => total + reader.posts.length, 0),
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
      readNotificationBadge: readers.readNotificationBadge,
      refresh,
      refreshPartition,
      rerenderAll: rerenderEverything,
      scrollTop,
      switchTimeline: readers.switchTimeline,
      trim,
      updateRelativeTimes,
    };
  }

  global.SocialDeckXNativeTimelineRuntime = { createXNativeTimelineRuntime };
})(window);
