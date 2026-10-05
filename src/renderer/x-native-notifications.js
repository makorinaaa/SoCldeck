(function (global) {
  const { escapeHtml } = global.SocialDeckHtmlEscape;

  const LABELS = { like: 'いいね', repost: 'リポスト', follow: 'フォロー', reply: '返信', mention: 'メンション', quote: '引用' };
  const TYPE_CLASSES = { like: 'ntlk', repost: 'ntrt', follow: 'ntfw', reply: 'ntrp', mention: 'ntrp', quote: 'ntrp' };
  const POST_REASONS = new Set(['reply', 'mention', 'quote']);
  // Below this scroll offset a Column counts as "at the top" for the new-item badge.
  const AT_TOP_PX = 40;
  const BADGE_AT_TOP_MS = 5000;

  // Native X notification Columns. They draw the notifications X's own notification page
  // fetches in the account's hidden notification page (shared with the notification
  // center), so no X page runs inside the Column. Replies, mentions and quotes are drawn
  // as posts with their actions; likes, reposts and follows as compact rows.
  function createXNativeNotifications({
    documentRef = global.document,
    renderPost,
    postOptions = (post, partition) => ({ partition }),
    handleInteractive = () => false,
    openPost = () => null,
    icons = {},
    relTime = () => '',
    blocksPost = () => false,
    loadNotifications = async () => [],
    getNotifications = () => null,
    intents = {},
    log = () => {},
    setTimeoutFn = global.setTimeout,
    clearTimeoutFn = global.clearTimeout,
    patchKeyedChildren = global.SocialDeckXNativeColumnView?.patchKeyedChildren,
    createElementFromHtml = html => {
      const template = documentRef.createElement('template');
      template.innerHTML = html.trim();
      return template.content.firstElementChild;
    },
  } = {}) {
    if (typeof renderPost !== 'function') throw new Error('X native notifications require a post renderer');
    const columns = new Map();
    // Per account: the notifications drawn, and the state of their last load.
    const accounts = new Map();

    function accountOf(partition) {
      if (!accounts.has(partition)) accounts.set(partition, { items: null, status: 'loading', message: '', loading: null });
      return accounts.get(partition);
    }

    function columnsOf(partition) {
      return [...columns.values()].filter(column => column.partition === partition);
    }

    function shows(item) {
      if (!item?.id) return false;
      return !(item.post && blocksPost(item.post));
    }

    function messageOf(item) {
      const text = String(item.text || '');
      const postText = String(item.postText || '');
      if (postText && text.endsWith(postText)) return text.slice(0, text.length - postText.length).trim();
      return text.split('\n')[0].trim();
    }

    function labelHtml(reason) {
      const icon = { like: icons.heart, repost: icons.repost, follow: icons.follow }[reason] || icons.reply || '';
      return `<div class="ntype ${TYPE_CLASSES[reason] || ''}">${icon} ${escapeHtml(LABELS[reason] || '通知')}</div>`;
    }

    function avatarHtml(item) {
      const initials = escapeHtml((item.actorName || item.actorHandle || '?').slice(0, 2).toUpperCase());
      const avatar = /^https:\/\//.test(item.avatar || '') ? `<img src="${escapeHtml(item.avatar)}" alt="" loading="lazy" decoding="async">` : '';
      return `<div class="av" style="width:28px;height:28px;font-size:9px">${initials}${avatar}</div>`;
    }

    // The relative time is filled in by refreshTimes, so an item's HTML stays the same and
    // its element is kept while the item does not change.
    function rowHtml(item) {
      const message = messageOf(item) || `${item.actorName || item.actorHandle || ''}`;
      const quote = item.postText
        ? `<div class="x-notif-target">${escapeHtml(item.postText).replace(/\n/g, '<br>')}</div>`
        : '';
      return `<div class="notif x-native-notif" role="button" tabindex="0" data-x-notif-id="${escapeHtml(item.id)}">
        ${labelHtml(item.reason)}
        <div class="nrow">${avatarHtml(item)}<div class="ninfo">
          <div class="nwho">${escapeHtml(message)}</div>${quote}
          <div class="nago" data-created-at="${escapeHtml(item.indexedAt || '')}"></div>
        </div></div>
      </div>`;
    }

    function itemHtml(item, partition) {
      if (item.post && POST_REASONS.has(item.reason)) {
        return `<div class="x-native-notif x-native-notif-post" data-x-notif-id="${escapeHtml(item.id)}">
          ${labelHtml(item.reason)}${renderPost(item.post, postOptions(item.post, partition))}
        </div>`;
      }
      return rowHtml(item);
    }

    function keyOf(element) {
      if (element.dataset?.xNotifId) return `n:${element.dataset.xNotifId}`;
      if (element.classList?.contains('x-native-notice')) return 'notice';
      return null;
    }

    function refreshTimes(host) {
      host?.querySelectorAll?.('.nago[data-created-at], .p-time[data-created-at]').forEach(element => {
        const label = relTime(element.dataset.createdAt);
        if (element.textContent !== label) element.textContent = label;
      });
    }

    function render(column) {
      const account = accountOf(column.partition);
      const items = (account.items || []).filter(shows);
      if (!items.length) {
        const html = account.status === 'loading'
          ? '<div class="feed-loading"><div class="spinner"></div>X の通知を読み込み中…</div>'
          : `<div class="feed-empty">${escapeHtml(account.message || '通知はありません')}</div>`;
        if (column.signature !== html) column.host.innerHTML = html;
        column.signature = html;
        return;
      }
      const entries = [];
      if (account.status === 'error' && account.message) {
        entries.push({ key: 'notice', html: `<div class="x-native-notice">${escapeHtml(account.message)}</div>` });
      }
      items.forEach(item => entries.push({ key: `n:${item.id}`, html: itemHtml(item, column.partition) }));
      const signature = entries.map(entry => entry.html).join('');
      if (column.signature !== signature) {
        column.signature = signature;
        patchKeyedChildren({ host: column.host, entries, rendered: column.rendered, keyOf, createElementFromHtml });
      }
      refreshTimes(column.host);
    }

    function renderPartition(partition) {
      columnsOf(partition).forEach(render);
    }

    function announce(column, count) {
      if (!column.badge || !count) return;
      const atTop = (column.host.scrollTop || 0) < AT_TOP_PX;
      column.unseen = (atTop ? 0 : column.unseen || 0) + count;
      column.badge.textContent = `+${column.unseen}`;
      column.badge.title = atTop ? '新着通知' : '新着通知（クリックで先頭へ）';
      column.badge.style.display = '';
      clearTimeoutFn(column.badgeTimer);
      if (atTop) column.badgeTimer = setTimeoutFn(() => clearBadge(column), BADGE_AT_TOP_MS);
    }

    function clearBadge(column) {
      clearTimeoutFn(column.badgeTimer);
      column.unseen = 0;
      if (column.badge) column.badge.style.display = 'none';
    }

    // New notifications for an account, from any reader of its notification page.
    function setItems(partition, items) {
      if (!Array.isArray(items)) return;
      const account = accountOf(partition);
      const known = account.items ? new Set(account.items.map(item => item.id)) : null;
      account.items = items;
      account.status = 'ready';
      account.message = '';
      const added = known ? items.filter(item => shows(item) && !known.has(item.id)).length : 0;
      columnsOf(partition).forEach(column => {
        render(column);
        announce(column, added);
      });
    }

    // Loads the account's notification page through the shared loader. Its captured data
    // arrives through setItems; the loader's own result only tells how the load went.
    async function refresh(id, { force = false } = {}) {
      const column = columns.get(id);
      if (!column) return { status: 'deferred', detail: 'unavailable' };
      const account = accountOf(column.partition);
      // A load already running may have started before what the person wants to see:
      // a forced refresh waits for it and then loads again.
      if (account.loading && !force) return account.loading;
      const previous = account.loading;
      const loading = (async () => {
        if (previous) await previous.catch(() => {});
        try {
          const raw = await loadNotifications(column.partition, { force });
          const latest = getNotifications(column.partition);
          if (latest) setItems(column.partition, latest);
          else if (Array.isArray(raw) && raw.length && !raw[0]?.captured) {
            account.status = 'error';
            account.message = 'X の通知データを読み取れませんでした。WebView 版の通知カラムを使ってください';
          } else if (!account.items) {
            account.items = [];
            account.status = 'ready';
          }
          return { status: 'succeeded' };
        } catch (error) {
          log('notifications failed', error?.message || error);
          account.status = 'error';
          account.message = error?.code === 'X_LOGIN_REQUIRED'
            ? 'このアカウントで X にログインしてください'
            : `通知を読み込めませんでした: ${error?.message || ''}`;
          return { status: 'failed', error };
        } finally {
          if (account.loading === loading) account.loading = null;
          renderPartition(column.partition);
        }
      })();
      account.loading = loading;
      return loading;
    }

    function openItem(column, element) {
      const item = (accountOf(column.partition).items || []).find(entry => entry.id === element.dataset.xNotifId);
      if (!item) return;
      const target = item.target || item.post;
      if (target?.id) {
        openPost(target, column.partition);
        return;
      }
      const match = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)\/status\/(\d+)/.exec(item.targetUrl || '');
      if (match) {
        openPost({
          id: match[2],
          url: `https://x.com/${match[1]}/status/${match[2]}`,
          createdAt: '',
          author: { handle: match[1], name: match[1] },
          segments: item.postText ? [{ type: 'text', text: item.postText }] : [],
          media: [],
        }, column.partition);
        return;
      }
      const profile = item.profileUrl || item.targetUrl;
      if (profile) intents.openExternal?.({ url: profile });
    }

    function mount({ id, partition, host, badge = null }) {
      const column = { id, partition, host, badge, rendered: new WeakMap(), signature: null, unseen: 0 };
      column.onClick = event => {
        if (handleInteractive(event, partition)) return;
        const row = event.target?.closest?.('.x-native-notif[data-x-notif-id]');
        if (row) openItem(column, row);
      };
      column.onKeyDown = event => {
        if (event.key !== 'Enter' || !event.target?.matches?.('.x-native-notif[data-x-notif-id]')) return;
        openItem(column, event.target);
      };
      column.onScroll = () => {
        if ((host.scrollTop || 0) < AT_TOP_PX && column.unseen) clearBadge(column);
      };
      column.onBadgeClick = event => {
        event.stopPropagation?.();
        host.scrollTo?.({ top: 0, behavior: 'smooth' });
        clearBadge(column);
      };
      host.addEventListener('click', column.onClick);
      host.addEventListener('keydown', column.onKeyDown);
      host.addEventListener('scroll', column.onScroll, { passive: true });
      badge?.addEventListener?.('click', column.onBadgeClick);
      columns.set(id, column);
      const known = getNotifications(partition);
      if (known && !accountOf(partition).items) setItems(partition, known);
      else render(column);
      refresh(id).catch(() => {});
      return true;
    }

    function dispose(id) {
      const column = columns.get(id);
      if (!column) return false;
      columns.delete(id);
      clearTimeoutFn(column.badgeTimer);
      column.host.removeEventListener('click', column.onClick);
      column.host.removeEventListener('keydown', column.onKeyDown);
      column.host.removeEventListener('scroll', column.onScroll);
      column.badge?.removeEventListener?.('click', column.onBadgeClick);
      return true;
    }

    // The posts shown for this account (for clicks, reactions and the detail view).
    function postsOf(partition) {
      return (accounts.get(partition)?.items || []).flatMap(item => [item.post, item.target]).filter(Boolean);
    }

    function applyUpdate(apply, partition) {
      const account = accounts.get(partition);
      if (!account?.items) return;
      account.items = account.items.map(item => {
        const post = item.post ? apply(item.post) : item.post;
        const target = item.target ? apply(item.target) : item.target;
        return post === item.post && target === item.target ? item : { ...item, post, target };
      });
    }

    function removePost(id) {
      accounts.forEach(account => {
        if (account.items) account.items = account.items.filter(item => item.post?.id !== id);
      });
    }

    function forget(partition = null) {
      if (partition) accounts.delete(partition);
      else accounts.clear();
    }

    return {
      applyUpdate,
      dispose,
      forget,
      has: id => columns.has(id),
      partitionOf: id => columns.get(id)?.partition || null,
      hasPartition: partition => columnsOf(partition).length > 0,
      hosts: () => [...columns.values()].map(column => column.host),
      mount,
      postsOf,
      refresh,
      refreshTimes,
      removePost,
      renderAll: () => columns.forEach(render),
      renderPartition,
      scrollTop: id => columns.get(id)?.host?.scrollTo?.({ top: 0, behavior: 'smooth' }),
      setItems,
    };
  }

  global.SocialDeckXNativeNotifications = { createXNativeNotifications };
})(window);
