(function (global) {
  const { escapeHtml } = global.SocialDeckHtmlEscape;

  const HOME_URL = 'https://x.com/home';
  const MAX_POSTS = 200;
  const CAPTURE_TIMEOUT_MS = 20000;
  // Automatic reloads never run more often than this, whatever the column interval says.
  const MIN_AUTO_REFRESH_MS = 3 * 60 * 1000;
  const SOFT_REFRESH_RESULTS = new Set(['home-clicked', 'banner-clicked']);
  const DETAIL_WAIT_MS = 6000;
  const LOAD_TIMEOUT_MS = 30000;
  // A long-lived x.com page slowly grows; memory cleanup reloads readers older than this.
  const READER_REFRESH_AGE_MS = 30 * 60 * 1000;
  // The newest posts are kept per account so a restart shows them at once.
  const SNAPSHOT_POSTS = 40;
  const SNAPSHOT_SAVE_DELAY_MS = 2000;
  const SNAPSHOT_KEY_PREFIX = 'socialdeck_x_native_snapshot_';
  const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  // Columns load more on their own when scrolled this close to the end.
  const AUTO_LOAD_MORE_PX = 800;
  // Below this scroll offset a Column counts as "at the top" for the new-post badge.
  const AT_TOP_PX = 40;
  const BADGE_AT_TOP_MS = 5000;
  const TIMELINE_LABELS = { 'for-you': 'おすすめ', following: 'フォロー中' };

  function compareSortIndex(left, right) {
    const a = String(left.sortIndex || '');
    const b = String(right.sortIndex || '');
    if (a.length !== b.length) return b.length - a.length;
    return b < a ? -1 : b > a ? 1 : 0;
  }

  // Newly captured posts replace older copies so counts and viewer state stay fresh.
  function mergePosts(existing, incoming, limit = MAX_POSTS) {
    const byId = new Map(existing.map(post => [post.id, post]));
    incoming.forEach(post => {
      if (!post?.id) return;
      const previous = byId.get(post.id);
      // Keep the original position for posts already shown; re-ranking would make them jump.
      byId.set(post.id, previous ? { ...post, sortIndex: previous.sortIndex, local: previous.local && !post.sortIndex } : post);
    });
    return [...byId.values()].sort(compareSortIndex).slice(0, limit);
  }

  function sortValue(post) {
    try {
      return BigInt(post?.sortIndex || 0);
    } catch {
      return 0n;
    }
  }

  // A timeline's first page is the truth for the range it covers: posts shown in that range
  // but missing from it were deleted (or hidden) and go away. Older posts loaded with
  // "load more" stay. A ranked feed (for you) is replaced, since its order changes anyway.
  // Posts this account just sent stay: X can leave them out of its own refreshes. Posts
  // restored from the saved snapshot always give way, wherever they sit.
  function reconcileFirstPage(existing, firstPage, timeline) {
    if (!firstPage.length) return existing;
    const ids = new Set(firstPage.map(post => post.id));
    existing = existing.filter(post => !post.cached || ids.has(post.id));
    if (timeline === 'for-you') return existing.filter(post => ids.has(post.id) || post.local);
    const oldest = firstPage.reduce((min, post) => {
      const value = sortValue(post);
      return value < min ? value : min;
    }, sortValue(firstPage[0]));
    return existing.filter(post => ids.has(post.id) || post.local || sortValue(post) < oldest);
  }

  // A new post has no timeline sortIndex: place it just above the newest shown post.
  function placeOnTop(posts, existing) {
    const top = existing.reduce((max, post) => {
      try {
        const value = BigInt(post.sortIndex || 0);
        return value > max ? value : max;
      } catch {
        return max;
      }
    }, 0n);
    return posts.map((post, index) => ({ ...post, local: true, sortIndex: String(top + BigInt(posts.length - index)) }));
  }

  function toMuteShape(post) {
    const quoted = post.quoted;
    const text = segments => (segments || []).map(segment => segment.text || '').join('');
    return {
      post: {
        record: { text: text(post.segments) },
        author: { handle: post.author?.handle, displayName: post.author?.name },
        embed: quoted ? {
          record: {
            value: { text: text(quoted.segments) },
            author: { handle: quoted.author?.handle, displayName: quoted.author?.name },
          },
        } : null,
      },
      reason: post.repostedBy
        ? { by: { handle: post.repostedBy.handle, displayName: post.repostedBy.name } }
        : null,
    };
  }

  // Serialized into X's home page: selects the For you / Following tab. X's narrow layout
  // hides its header while scrolled, so the tabs may need a moment to come back.
  async function selectHomeTab(documentLike, timeline, schedule = null, attempts = 1) {
    const pattern = timeline === 'following' ? /フォロー中|Following/i : /おすすめ|For you/i;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const tab = Array.from(documentLike.querySelectorAll('[role="tab"]'))
        .find(element => pattern.test(String(element.textContent || '')));
      if (tab) {
        if (tab.getAttribute('aria-selected') === 'true') return 'already';
        tab.click();
        return 'clicked';
      }
      if (schedule) await new Promise(resolve => schedule(resolve, 150));
    }
    return 'missing';
  }

  function createSelectTabScript(timeline) {
    return `(window.scrollTo(0, 0), (${selectHomeTab.toString()})(document, ${JSON.stringify(timeline)}, setTimeout, 20))`;
  }

  function isLoginUrl(value) {
    if (/\/i\/flow\/(?:login|signup)|\/login(?:[/?#]|$)|\/logout(?:[/?#]|$)/.test(value || '')) return true;
    // A signed-out session is sent from /home to X's landing page.
    return /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/?(?:[?#]|$)/.test(value || '');
  }

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
    createElementFromHtml = html => {
      const template = documentRef.createElement('template');
      template.innerHTML = html.trim();
      return template.content.firstElementChild;
    },
  } = {}) {
    if (!tap?.attach || !tap?.onCaptured) throw new Error('X native timeline requires a timeline tap');
    if (typeof renderPost !== 'function') throw new Error('X native timeline requires a post renderer');

    const readers = new Map();
    const columns = new Map();
    const pendingReactions = new Map();
    let activeDetail = null;
    let activeMenu = null;
    // A status page may be fetched before the detail view knows which post it shows.
    const recentDetails = new Map();
    const accountIds = new Map();
    const deleting = new Set();

    // The account's own posts (and only those) can be deleted from SocialDeck.
    function postOptions(post, partition) {
      // The author decides: a post shown because someone else reposted it is still deletable.
      const own = Boolean(post?.author?.id) && accountIds.get(partition) === post.author.id;
      return { partition, own, deleting: deleting.has(`${partition}|${post?.id}`) };
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
        handleStatusCapture(statusPartition, payload);
        return;
      }
      if (payload?.webContentsId == null) return;
      const reader = [...readers.values()].find(item => item.webContentsId === payload.webContentsId);
      if (!reader || !Array.isArray(payload.posts)) return;
      if (reader.switching) {
        if (payload.operation === 'CreateTweet' || !payload.firstPage) return;
        if (payload.timeline !== reader.switching) {
          // The reload opened the other tab: X did not keep the click, so select it again.
          if (!reader.reselected) {
            reader.reselected = true;
            reader.webview.executeJavaScript(createSelectTabScript(reader.switching)).catch(() => {});
          }
          return;
        }
        reader.posts = [];
      } else if (reader.desiredTimeline && payload.timeline && payload.timeline !== reader.desiredTimeline) {
        return;
      }
      const incoming = payload.operation === 'CreateTweet'
        ? placeOnTop(payload.posts.filter(post => !reader.posts.some(shown => shown.id === post.id)), reader.posts)
        : payload.posts;
      const wasSwitching = Boolean(reader.switching);
      const shownBefore = new Set(reader.posts.map(post => post.id));
      const previousTop = reader.posts.reduce((max, post) => (post.local ? max : (sortValue(post) > max ? sortValue(post) : max)), 0n);
      const isFirstPage = payload.operation !== 'CreateTweet' && payload.firstPage === true;
      log('captured', payload.operation, payload.posts.length, isFirstPage ? 'first page' : 'partial');
      const base = isFirstPage ? reconcileFirstPage(reader.posts, payload.posts, payload.timeline) : reader.posts;
      reader.posts = mergePosts(base, incoming);
      reader.timeline = payload.timeline || reader.timeline;
      reader.status = 'ready';
      reader.loadingMore = false;
      const waiters = reader.waiters.splice(0);
      waiters.forEach(resolve => resolve({ status: 'succeeded', detail: 'captured' }));
      renderReader(reader);
      saveSnapshotSoon(reader);
      if (shownBefore.size && !wasSwitching && payload.operation !== 'CreateTweet') {
        const arrived = reader.posts.filter(post => !shownBefore.has(post.id) && !post.local && sortValue(post) > previousTop);
        if (arrived.length) announceNewPosts(reader, arrived.length);
      }
    });

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

    function snapshotKey(partition) {
      return SNAPSHOT_KEY_PREFIX + partition;
    }

    function readSnapshot(partition) {
      try {
        const snapshot = JSON.parse(storage?.getItem(snapshotKey(partition)) || 'null');
        if (!Array.isArray(snapshot?.posts)) return null;
        // An old snapshot would show a timeline from long ago: start empty instead.
        if (!(now() - Number(snapshot.savedAt) < SNAPSHOT_MAX_AGE_MS)) return null;
        return {
          timeline: ['for-you', 'following'].includes(snapshot.timeline) ? snapshot.timeline : null,
          // Saved posts only bridge the wait: X's first page replaces them (see reconcileFirstPage).
          posts: snapshot.posts.filter(post => post && typeof post.id === 'string')
            .slice(0, SNAPSHOT_POSTS).map(post => ({ ...post, cached: true, local: false })),
        };
      } catch {
        return null;
      }
    }

    function saveSnapshotSoon(reader) {
      clearTimeoutFn(reader.snapshotTimer);
      reader.snapshotTimer = setTimeoutFn(() => {
        try {
          storage?.setItem(snapshotKey(reader.partition), JSON.stringify({
            savedAt: now(),
            timeline: reader.timeline,
            posts: reader.posts.slice(0, SNAPSHOT_POSTS).map(({ local, cached, ...post }) => post),
          }));
        } catch { /* Storage may be full or unavailable: the snapshot is only a head start. */ }
      }, SNAPSHOT_SAVE_DELAY_MS);
    }

    function createReader(partition) {
      const host = getReaderHost();
      if (!host) return null;
      const snapshot = readSnapshot(partition);
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
        posts: snapshot?.posts || [],
        timeline: snapshot?.timeline || null,
        status: 'loading',
        message: '',
        loadingMore: false,
        lastLoadAt: now(),
        waiters: [],
        switching: null,
        desiredTimeline: null,
      };

      const onNavigate = event => {
        if (isLoginUrl(event?.url)) setStatus(reader, 'login', 'このアカウントで X にログインしてください');
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

    // Loads X's home in the reader; if no timeline arrives the Column stops spinning and
    // offers the refresh button instead of waiting forever.
    function loadHome(reader) {
      reader.lastLoadAt = now();
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
      clearTimeoutFn(reader.snapshotTimer);
      readers.delete(reader.partition);
      reader.waiters.splice(0).forEach(resolve => resolve({ status: 'deferred', detail: 'disposed' }));
      if (reader.webContentsId !== null) tap.detach?.(reader.webContentsId)?.catch?.(() => {});
      reader.webview.remove();
    }

    function keyOf(element) {
      if (element.dataset?.xId) return `post:${element.dataset.xId}`;
      if (element.hasAttribute?.('data-x-native-more')) return 'more';
      if (element.hasAttribute?.('data-x-native-tabs')) return 'tabs';
      if (element.hasAttribute?.('data-x-native-login')) return 'login';
      if (element.classList?.contains('x-native-notice')) return 'notice';
      return null;
    }

    // Updates a column in place: unchanged posts keep their DOM nodes (a playing video keeps
    // playing, images are not decoded again) and only new or changed posts are built.
    // Chromium's scroll anchoring keeps the reading position when posts are added above.
    function patchColumn(column, entries) {
      const { host } = column;
      if (typeof host.insertBefore !== 'function') {
        host.innerHTML = entries.map(entry => entry.html).join('');
        return;
      }
      const existing = new Map();
      Array.from(host.children || []).forEach(element => {
        const key = keyOf(element);
        if (key && !existing.has(key) && column.rendered.has(element)) existing.set(key, element);
        else element.remove();
      });
      let cursor = host.firstElementChild;
      for (const entry of entries) {
        let element = existing.get(entry.key);
        existing.delete(entry.key);
        if (element && column.rendered.get(element) !== entry.html) {
          const fresh = createElementFromHtml(entry.html);
          if (cursor === element) cursor = fresh;
          element.replaceWith(fresh);
          element = fresh;
        }
        if (!element) element = createElementFromHtml(entry.html);
        column.rendered.set(element, entry.html);
        if (element === cursor) cursor = cursor.nextElementSibling;
        else host.insertBefore(element, cursor);
      }
      existing.forEach(element => element.remove());
    }

    function tabsHtml(reader) {
      const current = reader.switching || reader.timeline;
      const button = (timeline, label) => `<button type="button" data-x-timeline="${timeline}" class="${current === timeline ? 'on' : ''}"${reader.switching ? ' disabled' : ''} aria-pressed="${current === timeline}">${label}</button>`;
      return `<div class="x-native-tabs" data-x-native-tabs role="group" aria-label="タイムライン">${button('for-you', 'おすすめ')}${button('following', 'フォロー中')}</div>`;
    }

    function loginHtml(reader) {
      return `<div class="x-native-login" data-x-native-login>
        <div>${escapeHtml(reader.message || 'このアカウントで X にログインしてください')}</div>
        <button type="button" data-x-native-open-login>X にログイン</button>
      </div>`;
    }

    function renderColumn(column, reader) {
      const { host } = column;
      if (column.login) return;
      if (column.subtitle) {
        const label = TIMELINE_LABELS[reader.timeline];
        column.subtitle.textContent = label ? `${column.baseSubtitle} · ${label}` : column.baseSubtitle;
      }
      const visible = reader.switching ? [] : reader.posts.filter(post => !blocksPost(toMuteShape(post)));
      if (reader.status === 'login' && !visible.length) {
        const html = loginHtml(reader);
        if (column.signature !== html) host.innerHTML = html;
        column.signature = html;
        return;
      }
      if (!visible.length) {
        const tabs = reader.timeline || reader.switching ? tabsHtml(reader) : '';
        const html = tabs + (reader.status === 'loading' || reader.switching
          ? '<div class="feed-loading"><div class="spinner"></div>X のタイムラインを読み込み中…</div>'
          : reader.status === 'ready'
            ? '<div class="feed-empty">表示できるポストがありません</div>'
            : `<div class="feed-empty">${escapeHtml(reader.message || '読み込めませんでした')}</div>`);
        if (column.signature !== html) host.innerHTML = html;
        column.signature = html;
        return;
      }
      const entries = [{ key: 'tabs', html: tabsHtml(reader) }];
      if (reader.status === 'login') entries.push({ key: 'login', html: loginHtml(reader) });
      else if (reader.status === 'error') {
        entries.push({ key: 'notice', html: `<div class="x-native-notice">${escapeHtml(reader.message)}</div>` });
      }
      visible.forEach(post => entries.push({ key: `post:${post.id}`, html: renderPost(post, postOptions(post, column.partition)) }));
      entries.push({
        key: 'more',
        html: `<button type="button" class="x-native-more" data-x-native-more${reader.loadingMore ? ' disabled' : ''}>${reader.loadingMore ? '読み込み中…' : 'さらに読み込む'}</button>`,
      });
      // Most captures (a refresh with no new posts) change nothing: skip the DOM entirely.
      const signature = entries.map(entry => entry.html).join('');
      if (column.signature === signature) return;
      column.signature = signature;
      patchColumn(column, entries);
    }

    function renderReader(reader) {
      columnsFor(reader).forEach(column => renderColumn(column, reader));
    }

    // Viewer state (liked / reposted) differs per account, so posts are looked up per account.
    function findPost(id, partition) {
      if (!id) return null;
      const candidates = [...(readers.get(partition)?.posts || [])];
      const detail = activeDetail?.partition === partition ? activeDetail : null;
      if (detail?.data) {
        const { ancestors = [], focal, replies = [] } = detail.data;
        candidates.push(...ancestors, focal, ...replies.flatMap(chain => [chain.post, ...(chain.replies || [])]));
      }
      if (detail?.fallback) candidates.push(detail.fallback);
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
      if (activeDetail?.partition !== partition) return;
      if (activeDetail.data) {
        const data = activeDetail.data;
        activeDetail.data = {
          ...data,
          ancestors: (data.ancestors || []).map(apply),
          focal: apply(data.focal),
          replies: (data.replies || []).map(chain => ({ post: apply(chain.post), replies: (chain.replies || []).map(apply) })),
        };
      }
      if (activeDetail.fallback) activeDetail.fallback = apply(activeDetail.fallback);
    }

    function rerenderEverything() {
      readers.forEach(renderReader);
      renderDetail();
    }

    // Reactions, deletions and status pages only touch one account's posts.
    function renderPartition(partition) {
      const reader = readers.get(partition);
      if (reader) renderReader(reader);
      if (activeDetail?.partition === partition) renderDetail();
    }

    function reactionKey(kind, id, partition) {
      return `${partition}|${kind}:${id}`;
    }

    function getPendingReaction(kind, id, partition) {
      return pendingReactions.get(reactionKey(kind, id, partition)) || null;
    }

    async function toggleReaction(kind, post, partition) {
      const key = reactionKey(kind, post.id, partition);
      if (pendingReactions.has(key) || !statusRuntime) return;
      const field = kind === 'like' ? 'liked' : 'reposted';
      const countField = kind === 'like' ? 'like' : 'repost';
      const active = !post.viewer?.[field];
      pendingReactions.set(key, { active });
      renderPartition(partition);
      try {
        let result = await toggleInReader(partition, post, kind, active);
        log('reaction (home)', kind, post.id, result);
        if (result !== 'done' && result !== 'already') {
          result = await statusRuntime.toggle(partition, post, kind, active);
          log('reaction (status page)', kind, post.id, result);
        }
        if (result !== 'done' && result !== 'already') {
          throw new Error(result === 'unconfirmed' ? 'X で反映を確認できませんでした' : 'X で操作できませんでした');
        }
        updatePost(post.id, current => ({
          viewer: { ...current.viewer, [field]: active },
          counts: {
            ...current.counts,
            [countField]: Math.max(0, (Number(current.counts?.[countField]) || 0)
              + (result === 'done' && Boolean(current.viewer?.[field]) !== active ? (active ? 1 : -1) : 0)),
          },
        }), partition);
        if (kind === 'repost') showOwnRepost(post.id, partition, active);
        intents.onOutcome?.({ kind, status: 'succeeded', active });
      } catch (error) {
        intents.onOutcome?.({ kind, status: 'failed', active, error });
      } finally {
        pendingReactions.delete(key);
        renderPartition(partition);
      }
    }

    // X does not put the account's own repost on top of its home right away: SocialDeck does,
    // like it does for the account's new posts.
    function showOwnRepost(id, partition, active) {
      const reader = readers.get(partition);
      const shown = reader?.posts.find(post => post.id === id);
      if (!reader || !shown) return;
      if (active) {
        const others = reader.posts.filter(post => post.id !== id);
        const [moved] = placeOnTop([{ ...shown, repostedBy: { handle: '', name: 'あなた', self: true } }], others);
        reader.posts = [moved, ...others];
      } else if (shown.repostedBy?.self) {
        reader.posts = reader.posts.map(post => (post.id === id ? { ...post, repostedBy: null } : post));
      }
    }

    // The hidden home page usually still holds recent posts: pressing X's button there needs
    // no navigation, so a like lands in a fraction of the time a status page takes.
    async function toggleInReader(partition, post, kind, active) {
      const reader = readers.get(partition);
      if (!createToggleScript || !reader || reader.status !== 'ready' || reader.webContentsId === null
        || reader.switching || isBusy()) return 'skipped';
      try {
        return await reader.webview.executeJavaScript(createToggleScript({ statusId: post.id, action: kind, active }));
      } catch {
        return 'failed';
      }
    }

    function closeMenu() {
      if (!activeMenu) return;
      documentRef.removeEventListener?.('pointerdown', activeMenu.handlePointerDown, true);
      documentRef.removeEventListener?.('keydown', activeMenu.handleKeyDown);
      activeMenu.menu.remove?.();
      activeMenu = null;
    }

    // A deleted post is gone for every account, so it leaves every Column, the open detail
    // view and the cached status pages, not only those of the account that deleted it.
    function removePost(id) {
      const keep = post => post?.id !== id;
      readers.forEach(reader => { reader.posts = reader.posts.filter(keep); });
      recentDetails.forEach((payloads, partition) => {
        recentDetails.set(partition, payloads.map(payload => ({
          ...payload,
          thread: (payload.thread || []).filter(keep),
          replies: (payload.replies || []).filter(chain => keep(chain.post))
            .map(chain => ({ ...chain, replies: (chain.replies || []).filter(keep) })),
        })));
      });
      if (!activeDetail) return;
      if (activeDetail.focalId === id) {
        closeDetail();
        return;
      }
      const data = activeDetail.data;
      if (data) {
        activeDetail.data = {
          ...data,
          ancestors: data.ancestors.filter(post => post.id !== id),
          replies: data.replies
            .filter(chain => chain.post.id !== id)
            .map(chain => ({ ...chain, replies: (chain.replies || []).filter(post => post.id !== id) })),
        };
      }
    }

    async function deletePost(post, partition) {
      const key = `${partition}|${post.id}`;
      if (deleting.has(key) || !statusRuntime?.remove) return;
      if (!confirmAction('このポストを削除しますか？この操作は取り消せません。')) return;
      deleting.add(key);
      renderPartition(partition);
      try {
        let result = await statusRuntime.remove(partition, post);
        log('delete', post.id, result);
        // Failures before X's confirm button was pressed leave the post untouched: one retry
        // covers a status page that was still starting up.
        if (['missing', 'menu-missing', 'delete-missing', 'confirm-missing'].includes(result)) {
          result = await statusRuntime.remove(partition, post);
          log('delete retry', post.id, result);
        }
        if (result !== 'done') {
          throw new Error(result === 'delete-missing' ? 'X で削除メニューが見つかりませんでした' : 'X で削除を確認できませんでした');
        }
        removePost(post.id);
        intents.onOutcome?.({ kind: 'delete', status: 'succeeded' });
      } catch (error) {
        intents.onOutcome?.({ kind: 'delete', status: 'failed', error });
      } finally {
        deleting.delete(key);
        rerenderEverything();
      }
    }

    function openMoreMenu(button, post, partition) {
      showMenu(button, `<button type="button" class="x-menu-danger" data-x-menu-action="delete">${icons.trash || ''} 削除</button>`, action => {
        if (action === 'delete') deletePost(post, partition);
      });
    }

    function openRepostMenu(button, post, partition) {
      showMenu(button, `
        <button type="button" data-x-menu-action="repost">${icons.repost || ''} ${post.viewer?.reposted ? 'リポストを取り消す' : 'リポスト'}</button>
        <button type="button" data-x-menu-action="quote">引用</button>`, action => {
        if (action === 'repost') toggleReaction('repost', post, partition);
        else intents.quote?.({ id: post.id, url: post.url, handle: post.author?.handle || '', partition });
      });
    }

    function showMenu(button, html, onAction) {
      closeMenu();
      if (!documentRef.body) return;
      const menu = documentRef.createElement('div');
      menu.className = 'bsky-repost-menu';
      const rect = button.getBoundingClientRect?.() || { left: 0, bottom: 0 };
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 4}px`;
      menu.innerHTML = html;
      menu.addEventListener('click', event => {
        const action = event.target?.closest?.('[data-x-menu-action]')?.dataset.xMenuAction;
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        onAction(action);
      });
      const handlePointerDown = event => {
        if (!menu.contains?.(event.target)) closeMenu();
      };
      const handleKeyDown = event => {
        if (event.key === 'Escape') closeMenu();
      };
      documentRef.body.appendChild(menu);
      documentRef.addEventListener?.('pointerdown', handlePointerDown, true);
      documentRef.addEventListener?.('keydown', handleKeyDown);
      activeMenu = { menu, handlePointerDown, handleKeyDown };
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
          toggleReaction('like', post, partition);
        } else if (action === 'repost') {
          openRepostMenu(actionButton, post, partition);
        } else if (action === 'more') {
          openMoreMenu(actionButton, post, partition);
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
        if (post) openPost(post, partition);
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

    function closeDetail() {
      if (!activeDetail) return;
      documentRef.removeEventListener?.('keydown', activeDetail.handleKeyDown);
      activeDetail.overlay.remove?.();
      activeDetail = null;
    }

    function renderDetail() {
      if (!activeDetail) return;
      const body = activeDetail.overlay.querySelector?.('.bsky-post-detail-body');
      if (!body) return;
      const html = detailHtml(activeDetail);
      if (activeDetail.renderedHtml === html) return;
      activeDetail.renderedHtml = html;
      body.innerHTML = html;
    }

    function detailHtml(detail) {
      const { data, fallback, error } = detail;
      if (data && renderThread) {
        return renderThread(data, {
          partition: detail.partition,
          postOptions: post => postOptions(post, detail.partition),
        });
      }
      if (!fallback) {
        const preview = detail.previewText
          ? `<div class="x-detail-preview">${escapeHtml(detail.previewText).replace(/\n/g, '<br>')}</div>`
          : '';
        return error
          ? `<div class="feed-err">${escapeHtml(error)}</div>`
          : `${preview}<div class="feed-loading"><div class="spinner"></div>ポストを探しています…</div>`;
      }
      return renderPost(fallback, { ...postOptions(fallback, detail.partition), focal: true })
        + (error
          ? `<div class="feed-err">${escapeHtml(error)}</div>`
          : '<div class="feed-loading"><div class="spinner"></div>返信を読み込み中…</div>');
    }

    // Opens a post like Bluesky does: an overlay with the conversation around it.
    function openPost(post, partition) {
      if (!post?.id) return null;
      const detail = createDetail(partition, post);
      if (detail && statusRuntime) loadDetail(detail, post);
      return detail;
    }

    // Opens the detail view first and fills it once the post is known, for example when
    // a notification only reveals its post after X's notification page is followed.
    async function openPostFrom(partition, findPost, { previewText = '' } = {}) {
      const detail = createDetail(partition, null, { previewText });
      if (!detail) return null;
      let post = null;
      try {
        post = await findPost();
      } catch {}
      if (activeDetail !== detail) return null;
      if (!post?.id) {
        closeDetail();
        return null;
      }
      detail.focalId = post.id;
      detail.fallback = post;
      useCachedDetail(detail);
      renderDetail();
      if (statusRuntime) loadDetail(detail, post);
      return detail;
    }

    function useCachedDetail(detail) {
      for (const payload of recentDetails.get(detail.partition) || []) {
        const shaped = shapeDetail(payload, detail.focalId);
        if (shaped) {
          detail.data = shaped;
          return;
        }
      }
    }

    function createDetail(partition, post, { previewText = '' } = {}) {
      if (!documentRef.body) return null;
      closeDetail();
      const overlay = documentRef.createElement('div');
      overlay.className = 'ov on';
      overlay.id = 'x-post-detail';
      overlay.innerHTML = `
        <div class="bsky-post-detail-modal">
          <div class="chead"><h2>ポスト</h2><button class="cbtn" type="button" data-x-detail-external title="X で開く">↗</button><button class="cbtn" type="button" data-x-detail-close title="閉じる">&times;</button></div>
          <div class="bsky-post-detail-body"></div>
        </div>`;
      const detail = { overlay, partition, focalId: post?.id || null, fallback: post, data: null, error: '', previewText };
      detail.handleKeyDown = event => {
        if (event.key === 'Escape' && !activeMenu) closeDetail();
      };
      overlay.addEventListener('click', event => {
        if (event.target === overlay || event.target?.closest?.('[data-x-detail-close]')) {
          closeDetail();
          return;
        }
        if (event.target?.closest?.('[data-x-detail-external]')) {
          if (detail.fallback?.url) intents.openExternal?.({ url: detail.fallback.url });
          return;
        }
        const clicked = event.target?.closest?.('[data-x-id]');
        if (clicked?.dataset.xId === detail.focalId && !event.target?.closest?.('[data-x-action], img, video, a[href], .p-quote')) return;
        handleInteractive(event, partition);
      });
      documentRef.addEventListener?.('keydown', detail.handleKeyDown);
      documentRef.body.appendChild(overlay);
      activeDetail = detail;
      if (post) useCachedDetail(detail);
      renderDetail();
      return detail;
    }

    // Shapes a captured status page around the post the detail view asked for.
    function shapeDetail(payload, focalId) {
      const thread = payload.thread || [];
      const index = thread.findIndex(post => post.id === focalId);
      if (index < 0) return null;
      const ownsReplies = !payload.focalId || payload.focalId === focalId;
      return {
        focalId,
        ancestors: thread.slice(0, index),
        focal: thread[index],
        replies: ownsReplies ? payload.replies || [] : [],
      };
    }

    function waitForDetail(detail, timeoutMs) {
      return new Promise(resolve => {
        if (detail.data) {
          resolve(true);
          return;
        }
        const timer = setTimeoutFn(() => {
          detail.onData = null;
          resolve(Boolean(detail.data));
        }, timeoutMs);
        detail.onData = () => {
          clearTimeoutFn(timer);
          detail.onData = null;
          resolve(true);
        };
      });
    }

    // X can serve an already visited status from its cache without fetching the
    // conversation again; one full page load then makes it fetch TweetDetail.
    async function loadDetail(detail, post) {
      try {
        await statusRuntime.run(detail.partition, post);
        if (await waitForDetail(detail, DETAIL_WAIT_MS) || activeDetail !== detail) return;
        log('detail reload', post.id);
        await statusRuntime.run(detail.partition, post, undefined, { reload: true });
        if (await waitForDetail(detail, DETAIL_WAIT_MS) || activeDetail !== detail) return;
        detail.error = '返信を読み込めませんでした';
      } catch (error) {
        if (activeDetail !== detail) return;
        detail.error = error?.message || 'ポストを開けませんでした';
      }
      renderDetail();
    }

    function handleStatusCapture(partition, payload) {
      log('status captured', payload.operation, payload.focalId || '', activeDetail?.focalId || '');
      if (payload.operation === 'TweetDetail') {
        recentDetails.set(partition, [payload, ...(recentDetails.get(partition) || [])].slice(0, 5));
        (payload.thread || []).forEach(post => {
          updatePost(post.id, () => ({ counts: post.counts, viewer: post.viewer }), partition);
        });
        const detail = activeDetail?.partition === partition ? activeDetail : null;
        const shaped = detail && shapeDetail(payload, detail.focalId);
        if (shaped) {
          detail.data = shaped;
          detail.error = '';
          detail.onData?.();
        }
        renderPartition(partition);
        return;
      }
      if (payload.operation === 'CreateTweet' && activeDetail?.data && activeDetail.partition === partition) {
        const [created] = payload.posts || [];
        if (!created) return;
        const data = activeDetail.data;
        if (created.replyTo && !data.replies.some(chain => chain.post.id === created.id)) {
          activeDetail.data = { ...data, replies: [{ post: created, replies: [] }, ...data.replies] };
          updatePost(data.focal.id, current => ({
            counts: { ...current.counts, reply: (Number(current.counts?.reply) || 0) + 1 },
          }), partition);
          renderPartition(partition);
        }
      }
    }

    function mount({ id, partition, host, subtitle = null, badge = null }) {
      const column = {
        id,
        partition,
        host,
        subtitle,
        baseSubtitle: String(subtitle?.textContent || '').replace(/(?:\s*·\s*(?:おすすめ|フォロー中))+\s*$/, ''),
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
        if (post) openPost(post, partition);
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
        }, CAPTURE_TIMEOUT_MS);
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
      if (!reload && reader.status === 'ready' && createRefreshScript) {
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
      const result = await reader.webview.executeJavaScript(createSelectTabScript(timeline)).catch(() => 'failed');
      log('switch timeline', timeline, result);
      let succeeded = false;
      if (result === 'clicked' || result === 'already') {
        reader.desiredTimeline = timeline;
        const captured = waitForCapture(reader);
        loadHome(reader);
        succeeded = (await captured).status === 'succeeded' && reader.timeline === timeline;
      }
      reader.switching = null;
      renderReader(reader);
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
      if (activeDetail) hosts.push(activeDetail.overlay);
      hosts.forEach(host => {
        host.querySelectorAll('.p-time[data-created-at]').forEach(element => {
          element.textContent = relTime(element.dataset.createdAt);
        });
      });
    }

    function rerenderAll() {
      rerenderEverything();
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
        recentDetails.delete(column.partition);
        accountIds.delete(column.partition);
        if (activeDetail?.partition === column.partition) closeDetail();
      }
    }

    // A removed account's saved posts must never show up for whoever uses the slot next.
    function forgetAccount(partition = null) {
      try {
        const keys = [];
        for (let index = 0; index < (storage?.length || 0); index += 1) {
          const key = storage.key(index);
          if (key?.startsWith(SNAPSHOT_KEY_PREFIX) && (!partition || key === snapshotKey(partition))) keys.push(key);
        }
        keys.forEach(key => storage.removeItem(key));
      } catch {}
      [...readers.values()].forEach(reader => {
        if (partition && reader.partition !== partition) return;
        clearTimeoutFn(reader.snapshotTimer);
        reader.posts = [];
        accountIds.delete(reader.partition);
        recentDetails.delete(reader.partition);
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

    function getMemoryStats() {
      return {
        readers: readers.size,
        posts: [...readers.values()].reduce((total, reader) => total + reader.posts.length, 0),
        statusReaders: statusRuntime?.count?.() || 0,
      };
    }

    function has(id) {
      return columns.has(id);
    }

    return {
      closeDetail,
      dispose,
      forgetAccount,
      getMemoryStats,
      trim,
      getPendingReaction,
      has,
      loadMore,
      mount,
      openPost,
      openPostFrom,
      refresh,
      refreshPartition,
      rerenderAll,
      scrollTop,
      switchTimeline,
      updateRelativeTimes,
    };
  }

  global.SocialDeckXNativeTimelineRuntime = {
    createXNativeTimelineRuntime,
    createSelectTabScript,
    mergePosts,
    placeOnTop,
    selectHomeTab,
    reconcileFirstPage,
    toMuteShape,
  };
})(window);
