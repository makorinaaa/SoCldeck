(function (global) {
  const MAX_RENDERED_ITEMS = 300;
  const PAGE_LIMIT = 40;
  const PREPEND_LIMIT = 30;
  const RELATIVE_TIME_INTERVAL_MS = 60_000;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trimRenderedItems(host, { removeFrom = 'end', preserveScroll = false } = {}) {
    const items = Array.from(host?.querySelectorAll?.('.post, .notif') || []);
    const overflow = items.length - MAX_RENDERED_ITEMS;
    if (overflow <= 0) return 0;
    const removed = removeFrom === 'start'
      ? items.slice(0, overflow)
      : items.slice(items.length - overflow);
    const previousScrollTop = Number(host.scrollTop) || 0;
    const removedHeight = removed.reduce((height, item) => height + (item.offsetHeight || 0), 0);
    removed.forEach(item => item.remove?.());
    if (preserveScroll && removeFrom === 'start') {
      host.scrollTop = Math.max(0, previousScrollTop - removedHeight);
    }
    return removed.length;
  }

  function createBlueskyColumnsRuntime({
    adapter,
    muteRules,
    ui,
    icons = {},
    onOutcome = () => {},
    documentRef = global.document,
    intents = {},
    schedule = global.setTimeout || (callback => callback()),
    cancelSchedule = global.clearTimeout || (() => {}),
    scheduleInterval = global.setInterval || (() => null),
    cancelInterval = global.clearInterval || (() => {}),
    requestFrame = global.requestAnimationFrame || (callback => callback()),
    now = () => new Date().toISOString(),
    hoverDelay = 300,
    createPostView = global.SocialDeckBlueskyPostView?.createBlueskyPostView,
    createReactions = global.SocialDeckBlueskyReactions?.createBlueskyReactions,
    createProfileCard = global.SocialDeckBlueskyProfileCard?.createBlueskyProfileCard,
  } = {}) {
    if (!adapter) throw new Error('Bluesky Columns Runtime requires an authenticated adapter');
    if (typeof createPostView !== 'function'
      || typeof createReactions !== 'function'
      || typeof createProfileCard !== 'function') {
      throw new Error('Bluesky Columns Runtime requires post view, reactions, and profile card modules');
    }
    const columns = new Map();
    let activeDetail = null;
    let detailSequence = 0;
    let relativeTimeTimer = null;

    function collectHosts() {
      const hosts = Array.from(columns.values(), column => column.host);
      if (activeDetail?.overlay) hosts.push(activeDetail.overlay);
      return hosts;
    }

    const reactions = createReactions({
      adapter,
      documentRef,
      icons,
      intents,
      onOutcome,
      getHosts: collectHosts,
    });
    const postView = createPostView({
      ui,
      icons,
      getPendingReaction: reactions.getPendingReaction,
    });
    const profileCard = createProfileCard({
      adapter,
      documentRef,
      onOutcome,
      schedule,
      cancelSchedule,
      hoverDelay,
    });

    function updateRelativeTimes() {
      if (!ui?.relTime) return;
      collectHosts().forEach(host => {
        Array.from(host?.querySelectorAll?.('.p-time[data-created-at], .nago[data-created-at]') || [])
          .forEach(element => {
            const createdAt = element.dataset?.createdAt;
            if (createdAt) element.textContent = ui.relTime(createdAt);
          });
      });
    }

    function startRelativeTimeUpdates() {
      if (relativeTimeTimer !== null || (columns.size === 0 && !activeDetail)) return;
      relativeTimeTimer = scheduleInterval(updateRelativeTimes, RELATIVE_TIME_INTERVAL_MS);
    }

    function stopRelativeTimeUpdates() {
      if (relativeTimeTimer === null || columns.size > 0 || activeDetail) return;
      cancelInterval(relativeTimeTimer);
      relativeTimeTimer = null;
    }

    function closeActiveDetail() {
      if (!activeDetail) return;
      const { overlay, ownerId } = activeDetail;
      reactions.closeRepostMenu(ownerId);
      profileCard.disposeOwner(ownerId);
      overlay.remove?.();
      activeDetail = null;
      stopRelativeTimeUpdates();
    }

    async function openPostDetail(post, columnId = null) {
      if (!documentRef?.createElement || !documentRef?.body) return;
      closeActiveDetail();
      documentRef.getElementById?.('bsky-post-detail')?.remove?.();
      const overlay = documentRef.createElement('div');
      const detailOwnerId = `detail:${++detailSequence}`;
      overlay.className = 'ov on';
      overlay.id = 'bsky-post-detail';
      overlay.innerHTML = `
        <div class="bsky-post-detail-modal">
          <div class="chead"><h2>ポスト</h2><button class="cbtn" type="button" data-bsky-detail-close title="閉じる">&times;</button></div>
          <div class="bsky-post-detail-body"><div class="feed-loading"><div class="spinner"></div>読み込み中...</div></div>
        </div>`;
      const detailHandlers = createDelegatedHandlers(columnId, detailOwnerId);
      overlay.addEventListener?.('click', event => {
        if (event.target === overlay || event.target?.closest?.('[data-bsky-detail-close]')) {
          closeActiveDetail();
          return;
        }
        return detailHandlers.clickHandler(event);
      });
      overlay.addEventListener?.('keydown', detailHandlers.keyHandler);
      overlay.addEventListener?.('contextmenu', detailHandlers.contextMenuHandler);
      overlay.addEventListener?.('error', detailHandlers.imageErrorHandler, true);
      overlay.addEventListener?.('pointerover', detailHandlers.pointerOverHandler);
      overlay.addEventListener?.('pointerout', detailHandlers.pointerOutHandler);
      documentRef.body.appendChild(overlay);
      activeDetail = { overlay, ownerId: detailOwnerId };
      startRelativeTimeUpdates();
      const body = overlay.querySelector?.('.bsky-post-detail-body');

      try {
        const data = await adapter.getThread({
          uri: post.dataset.uri,
          depth: 12,
          parentHeight: 12,
        });
        const thread = data?.thread;
        if (!thread?.post) throw new Error('ポストを取得できませんでした');
        const parents = postView.collectThreadParents(thread)
          .map(parent => `<div class="bsky-thread-parent">${postView.renderPost({ post: parent })}</div>`)
          .join('');
        const replies = postView.renderThreadReplies(thread.replies);
        if (body) {
          body.innerHTML = `${parents ? `<div class="bsky-thread-label">会話</div>${parents}` : ''}
            <div class="bsky-thread-main">${postView.renderPost({ post: thread.post })}</div>
            ${replies ? `<div class="bsky-thread-label">返信</div>${replies}` : '<div class="feed-empty">返信はありません</div>'}`;
        }
      } catch (error) {
        if (body) body.innerHTML = `<div class="feed-err">${escapeHtml(error.message)}</div>`;
        onOutcome({ kind: 'post-detail', status: 'failed', error });
      }
    }

    function openPost({ uri, cid = '', handle = '' }) {
      if (!uri) return Promise.resolve();
      return openPostDetail({
        dataset: { uri, cid, authorHandle: handle },
      }, null);
    }

    async function search(columnId) {
      const column = columns.get(columnId);
      const query = String(column?.searchInput?.value || '').trim();
      if (!column || !query) return { status: 'deferred', detail: 'query-unavailable' };
      const revision = ++column.revision;
      column.host.innerHTML = '<div class="feed-loading"><div class="spinner"></div>検索中…</div>';
      try {
        const data = await adapter.searchPosts({ query, limit: 40 });
        if (columns.get(columnId) !== column || column.revision !== revision) {
          return { status: 'deferred', detail: 'column-disposed' };
        }
        const posts = (data.posts || [])
          .map(post => ({ post }))
          .filter(item => !muteRules?.blocksPost?.(item))
          .map(postView.renderPost)
          .join('');
        column.host.innerHTML = posts
          || `<div class="feed-empty">「${escapeHtml(query)}」の結果は0件です</div>`;
        return { status: 'succeeded', detail: posts ? 'search-results' : 'no-results' };
      } catch (error) {
        if (columns.get(columnId) === column && column.revision === revision) {
          column.host.innerHTML = `<div class="feed-err">検索エラー: ${escapeHtml(error.message)}<br><button type="button" data-bsky-action="search-retry">再試行</button></div>`;
        }
        onOutcome({ kind: 'search', status: 'failed', columnId, error });
        throw error;
      }
    }

    function createClickHandler(columnId, ownerId = columnId) {
      return async event => {
        const profile = event.target?.closest?.('[data-bsky-profile]');
        if (profile) {
          event.preventDefault?.();
          event.stopPropagation?.();
          intents.openProfile?.({
            did: profile.dataset.did || '',
            handle: profile.dataset.handle || '',
          });
          return;
        }
        if (event.target?.closest?.('[data-bsky-tag]')) {
          event.preventDefault?.();
          event.stopPropagation?.();
          return;
        }
        const image = event.target?.closest?.('[data-bsky-image-index]');
        if (image) {
          event.preventDefault?.();
          event.stopPropagation?.();
          const grid = image.closest?.('.p-imgs');
          try {
            const urls = JSON.parse(grid?.dataset?.urls || '[]');
            intents.openImages?.({
              urls,
              startIndex: Number.parseInt(image.dataset.bskyImageIndex || '0', 10) || 0,
            });
          } catch {}
          return;
        }
        const action = event.target?.closest?.('[data-bsky-action]');
        if (action) {
          const actionName = action.dataset?.bskyAction;
          if (actionName === 'load-more') {
            event.preventDefault?.();
            await refresh(columnId, { mode: 'append' });
            return;
          }
          if (actionName === 'retry') {
            event.preventDefault?.();
            await refresh(columnId, { mode: 'replace' });
            return;
          }
          if (actionName === 'search-retry') {
            event.preventDefault?.();
            await search(columnId);
            return;
          }
          const post = action.closest('.post');
          if (!post) return;
          event.preventDefault?.();
          event.stopPropagation?.();
          if (actionName === 'like') {
            await reactions.toggleLike(action, post);
          } else if (actionName === 'reply') {
            closeActiveDetail();
            intents.reply?.({
              uri: post.dataset.uri,
              cid: post.dataset.cid,
              handle: post.dataset.authorHandle || '',
            });
          } else if (actionName === 'repost') {
            reactions.openRepostMenu(action, post, ownerId);
          }
          return;
        }
        if (event.target?.closest?.('button,a,img,video,.p-imgs,input,textarea')) return;
        const notification = event.target?.closest?.('.notif');
        if (notification && columns.has(columnId)) {
          event.preventDefault?.();
          intents.activateNotification?.({
            reason: notification.dataset.notificationReason || '',
            authorDid: notification.dataset.authorDid || '',
            authorHandle: notification.dataset.authorHandle || '',
            targetUri: notification.dataset.targetUri || '',
          });
          return;
        }
        const post = event.target?.closest?.('.post');
        if (!post || (columnId && !columns.has(columnId))) return;
        if (global.getSelection?.()?.toString()) return;
        event.preventDefault?.();
        await openPostDetail(post, columnId);
      };
    }

    function createDelegatedHandlers(columnId, ownerId = columnId) {
      const delegatedClickHandler = createClickHandler(columnId, ownerId);
      const clickHandler = event => Promise.resolve(delegatedClickHandler(event)).catch(() => {});
      const keyHandler = event => {
        if (!['Enter', ' '].includes(event.key)) return;
        const isInteractive = event.target?.closest?.('.post')
          || event.target?.closest?.('.notif')
          || event.target?.closest?.('[data-bsky-profile]');
        if (!isInteractive) return;
        event.preventDefault?.();
        return clickHandler(event);
      };
      const contextMenuHandler = event => {
        const post = event.target?.closest?.('.post');
        if (!post) return;
        event.preventDefault?.();
        intents.openPostMenu?.({
          handle: post.dataset.authorHandle || '',
          x: Number(event.clientX) || 0,
          y: Number(event.clientY) || 0,
        });
      };
      const pointerOverHandler = event => {
        const profile = event.target?.closest?.('[data-bsky-profile]');
        if (!profile || profile.contains?.(event.relatedTarget)) return;
        return profileCard.scheduleShow(ownerId, event.target, profile);
      };
      const pointerOutHandler = event => {
        const profile = event.target?.closest?.('[data-bsky-profile]');
        if (!profile || profile.contains?.(event.relatedTarget)) return;
        profileCard.scheduleHide(ownerId);
      };
      const imageErrorHandler = event => {
        if (event.target?.matches?.('.av img')) event.target.style.display = 'none';
      };
      return {
        clickHandler,
        contextMenuHandler,
        imageErrorHandler,
        keyHandler,
        pointerOutHandler,
        pointerOverHandler,
      };
    }

    function mount({
      id,
      type,
      feedUri = null,
      host,
      badge = null,
      searchInput = null,
      searchButton = null,
    }) {
      if (!id || !host) throw new Error('Bluesky Column requires an id and host');
      const {
        clickHandler,
        contextMenuHandler,
        imageErrorHandler,
        keyHandler,
        pointerOutHandler,
        pointerOverHandler,
      } = createDelegatedHandlers(id);
      const scrollHandler = () => {
        if (badge) badge.style.display = 'none';
      };
      const searchHandler = () => search(id).catch(() => {});
      const searchKeyHandler = event => {
        if (event.key !== 'Enter') return;
        event.preventDefault?.();
        return search(id).catch(() => {});
      };
      host.addEventListener?.('click', clickHandler);
      host.addEventListener?.('keydown', keyHandler);
      host.addEventListener?.('contextmenu', contextMenuHandler);
      host.addEventListener?.('error', imageErrorHandler, true);
      host.addEventListener?.('pointerover', pointerOverHandler);
      host.addEventListener?.('pointerout', pointerOutHandler);
      host.addEventListener?.('scroll', scrollHandler);
      searchInput?.addEventListener?.('keydown', searchKeyHandler);
      searchButton?.addEventListener?.('click', searchHandler);
      columns.set(id, {
        id,
        type,
        feedUri,
        host,
        badge,
        cursor: null,
        revision: 0,
        clickHandler,
        keyHandler,
        contextMenuHandler,
        imageErrorHandler,
        pointerOverHandler,
        pointerOutHandler,
        scrollHandler,
        searchInput,
        searchButton,
        searchHandler,
        searchKeyHandler,
      });
      startRelativeTimeUpdates();
    }

    function getPageItems(column, data) {
      return column.type === 'notif' ? (data.notifications || []) : (data.feed || []);
    }

    function getItemIdentity(column, item) {
      if (column.type !== 'notif') return item.post?.uri || item.uri || '';
      return postView.getNotificationIdentity(item);
    }

    function collectExistingIdentities(column) {
      const selector = column.type === 'notif'
        ? '.notif[data-notification-uri]'
        : '.post[data-uri]';
      return new Set(
        Array.from(column.host.querySelectorAll?.(selector) || [])
          .map(element => column.type === 'notif'
            ? element.dataset?.notificationUri
            : element.dataset?.uri)
          .filter(Boolean),
      );
    }

    function deduplicateItems(column, items) {
      const seen = new Set();
      return items.filter(item => {
        const identity = getItemIdentity(column, item);
        if (!identity) return true;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
    }

    async function fetchPage(column, { limit, cursor }) {
      if (column.type === 'feed') {
        return adapter.getFeed({ feedUri: column.feedUri, limit, cursor });
      }
      if (column.type === 'notif') {
        return adapter.listNotifications(cursor ? { limit, cursor } : { limit });
      }
      return adapter.getTimeline({ limit, cursor });
    }

    async function refresh(id, { mode = 'replace' } = {}) {
      const column = columns.get(id);
      if (!column) return { status: 'deferred', detail: 'column-unavailable' };
      if (!['timeline', 'feed', 'notif'].includes(column.type)) {
        return { status: 'deferred', detail: 'unsupported-column-type' };
      }
      const revision = ++column.revision;
      const seenAt = column.type === 'notif' && mode === 'replace' ? now() : null;

      if (mode === 'replace') {
        column.cursor = null;
        column.host.innerHTML = '<div class="feed-loading"><div class="spinner"></div>読み込み中…</div>';
      }

      const isPrepend = mode === 'prepend';
      const existingIdentities = isPrepend ? collectExistingIdentities(column) : new Set();
      let gapReplaced = false;
      let data;
      try {
        const limit = isPrepend ? PREPEND_LIMIT : PAGE_LIMIT;
        data = await fetchPage(column, { limit, cursor: isPrepend ? null : column.cursor });
        const firstPageItems = getPageItems(column, data);
        const firstPageAllNew = isPrepend
          && existingIdentities.size > 0
          && firstPageItems.length > 0
          && firstPageItems.every(item => !existingIdentities.has(getItemIdentity(column, item)));
        if (firstPageAllNew && data.cursor) {
          const nextPage = await fetchPage(column, { limit: PREPEND_LIMIT, cursor: data.cursor });
          const nextPageItems = getPageItems(column, nextPage);
          const overlapFound = nextPageItems.some(item => existingIdentities.has(getItemIdentity(column, item)));
          gapReplaced = !overlapFound
            && Boolean(nextPage.cursor);
          data = {
            ...nextPage,
            ...(column.type === 'notif'
              ? { notifications: [...firstPageItems, ...nextPageItems] }
              : { feed: [...firstPageItems, ...nextPageItems] }),
          };
        }
      } catch (error) {
        if (columns.get(id) === column && column.revision === revision && mode === 'replace') {
          column.host.innerHTML = `<div class="feed-err">取得エラー: ${escapeHtml(error.message)}<br><button type="button" data-bsky-action="retry">再試行</button></div>`;
        }
        onOutcome({ kind: 'refresh', status: 'failed', columnId: id, error });
        throw error;
      }
      if (columns.get(id) !== column || column.revision !== revision) {
        return { status: 'deferred', detail: 'column-disposed' };
      }
      let items = deduplicateItems(column, getPageItems(column, data));
      if (isPrepend && !gapReplaced) {
        if (column.type !== 'notif') {
          reactions.syncPostMetrics(column.host, items);
          reactions.reapplyPendingReactions();
        }
        items = items.filter(item => {
          const identity = getItemIdentity(column, item);
          return !identity || !existingIdentities.has(identity);
        });
        if (items.length === 0) return { status: 'succeeded', detail: 'no-changes' };
      } else if (column.type !== 'notif') {
        column.cursor = data.cursor || null;
      }
      items = items.filter(item => column.type === 'notif'
        ? !muteRules?.blocksNotification?.(item)
        : !muteRules?.blocksPost?.(item));
      const renderedItems = items.map(item => column.type === 'notif'
        ? postView.renderNotification(item)
        : postView.renderPost(item)).join('');
      const loadMore = column.type !== 'notif' && column.cursor
        ? '<button class="load-more" type="button" data-bsky-action="load-more">もっと見る</button>'
        : '';
      if (mode === 'append') {
        column.host.querySelector?.('.load-more')?.remove();
        column.host.insertAdjacentHTML?.('beforeend', renderedItems + loadMore);
        trimRenderedItems(column.host, { removeFrom: 'start', preserveScroll: true });
        return { status: 'succeeded', detail: 'appended' };
      }
      if (isPrepend && !gapReplaced) {
        if (!renderedItems) return { status: 'succeeded', detail: 'filtered' };
        const previousScrollTop = Number(column.host.scrollTop) || 0;
        const wasAtTop = previousScrollTop < 50;
        const previousChildCount = column.host.children?.length || 0;
        column.host.insertAdjacentHTML?.('afterbegin', renderedItems);
        const addedCount = Math.max(0, (column.host.children?.length || 0) - previousChildCount);
        const addedElements = Array.from(column.host.children || []).slice(0, addedCount);
        addedElements.forEach(element => element.classList?.add?.('sd-new'));
        if (wasAtTop) {
          requestFrame?.(() => column.host.scrollTo?.({ top: 0, behavior: 'smooth' }));
        } else {
          requestFrame?.(() => {
            column.host.scrollTop = previousScrollTop
              + addedElements.reduce((height, element) => height + (element.offsetHeight || 0), 0);
          });
        }
        schedule?.(() => addedElements.forEach(element => element.classList?.remove?.('sd-new')), 600);
        trimRenderedItems(column.host, { removeFrom: 'end' });
        if (column.badge) {
          column.badge.textContent = `+${items.length}`;
          column.badge.style.display = '';
          schedule?.(() => { column.badge.style.display = 'none'; }, 5000);
        }
        return { status: 'succeeded', detail: 'new-items' };
      }
      column.host.innerHTML = (renderedItems
        || `<div class="feed-empty">${column.type === 'notif' ? '通知がありません' : '投稿がありません'}</div>`)
        + loadMore;
      trimRenderedItems(column.host, { removeFrom: 'end' });
      if (column.type === 'notif' && mode === 'replace') {
        try {
          await adapter.markNotificationsSeen({ seenAt });
          if (columns.get(id) === column && column.revision === revision) {
            intents.clearNotificationUnread?.();
          }
        } catch (error) {
          onOutcome({ kind: 'notification-seen', status: 'failed', columnId: id, error });
        }
      }
      return { status: 'succeeded', detail: gapReplaced ? 'gap-replaced' : 'replaced' };
    }

    function dispose(id) {
      const column = columns.get(id);
      if (!column) return false;
      column.revision += 1;
      column.host.removeEventListener?.('click', column.clickHandler);
      column.host.removeEventListener?.('keydown', column.keyHandler);
      column.host.removeEventListener?.('contextmenu', column.contextMenuHandler);
      column.host.removeEventListener?.('error', column.imageErrorHandler, true);
      column.host.removeEventListener?.('pointerover', column.pointerOverHandler);
      column.host.removeEventListener?.('pointerout', column.pointerOutHandler);
      column.host.removeEventListener?.('scroll', column.scrollHandler);
      column.searchInput?.removeEventListener?.('keydown', column.searchKeyHandler);
      column.searchButton?.removeEventListener?.('click', column.searchHandler);
      columns.delete(id);
      stopRelativeTimeUpdates();
      profileCard.disposeOwner(id);
      reactions.closeRepostMenu(id);
      return true;
    }

    function getMemoryStats() {
      let renderedItemCount = 0;
      columns.forEach(column => {
        renderedItemCount += column.host?.querySelectorAll?.('.post, .notif')?.length || 0;
      });
      return { columnCount: columns.size, renderedItemCount };
    }

    function trimAll() {
      let removed = 0;
      columns.forEach(column => {
        const items = Array.from(column.host?.querySelectorAll?.('.post, .notif') || []);
        const overflow = Math.max(0, items.length - MAX_RENDERED_ITEMS);
        const overflowHeight = items.slice(0, overflow)
          .reduce((height, item) => height + (Number(item.offsetHeight) || 0), 0);
        const preserveScroll = (Number(column.host?.scrollTop) || 0) > overflowHeight + 50;
        removed += trimRenderedItems(column.host, {
          removeFrom: preserveScroll ? 'start' : 'end',
          preserveScroll,
        });
      });
      return removed;
    }

    return { dispose, getMemoryStats, mount, openPost, refresh, trimAll };
  }

  global.SocialDeckBlueskyColumnsRuntime = { createBlueskyColumnsRuntime };
})(window);
