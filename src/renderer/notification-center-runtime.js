(function (global) {
  const NOTIFICATION_LABELS = {
    like: 'さんがあなたの投稿をいいねしました',
    repost: 'さんがあなたの投稿をリポストしました',
    follow: 'さんがあなたをフォローしました',
    reply: 'さんがあなたに返信しました',
    mention: 'さんがあなたをメンションしました',
    quote: 'さんがあなたの投稿を引用しました',
  };

  function createNotificationCenterDomView({ documentRef = global.document, ui = {} } = {}) {
    const modal = documentRef.getElementById('notifCenterMod');
    const list = documentRef.getElementById('notif-center-list');
    const xArea = documentRef.getElementById('notif-center-x');
    const reasonSelect = documentRef.getElementById('notif-center-reason');
    const unreadInput = documentRef.getElementById('notif-center-unread');
    const markReadButton = documentRef.querySelector('.notif-center-tools .mark-read');
    const tabs = Array.from(documentRef.querySelectorAll('.notif-center-tab'));
    const escape = ui.escape || (value => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;'));
    let handlers = {};

    function setOpen(open) {
      modal?.classList.toggle('on', Boolean(open));
    }

    function renderXAvatar(item) {
      const actor = item.author || {};
      const account = item.account || {};
      const fallback = escape((actor.displayName || actor.handle || 'X').slice(0, 2).toUpperCase());
      const image = actor.avatar ? `<img src="${escape(actor.avatar)}" loading="lazy">` : fallback;
      return `<div class="av" style="width:32px;height:32px;background:${escape(account.bg || ui.avatarBackground?.(actor.handle) || 'var(--text2)')};font-size:9px">${image}</div>`;
    }

    function render(snapshot) {
      tabs.forEach(tab => tab.classList.toggle('on', tab.dataset.network === snapshot.network));
      if (reasonSelect) {
        reasonSelect.value = snapshot.reason;
        reasonSelect.disabled = false;
      }
      if (unreadInput) {
        unreadInput.checked = snapshot.unreadOnly;
        unreadInput.disabled = !snapshot.unreadFilterEnabled;
      }
      if (markReadButton) markReadButton.disabled = !snapshot.canMarkAllRead;

      const showX = ['all', 'x'].includes(snapshot.network) && snapshot.xAccounts.length > 0;
      xArea?.classList.toggle('show', showX);
      if (xArea) {
        xArea.innerHTML = showX ? snapshot.xAccounts.map((account, accountIndex) => `
          <button class="notif-x-account" data-x-account-index="${accountIndex}">
            <span style="background:${escape(account.bg || 'var(--text2)')}">${escape(account.initials || 'X')}</span>
            ${escape(account.username)} の通知カラム
          </button>`).join('') : '';
      }
      if (!list) return;
      if (snapshot.loading) {
        list.innerHTML = '<div class="notif-center-state">通知を読み込んでいます...</div>';
        return;
      }
      if (snapshot.network === 'b' && !snapshot.hasBluesky) {
        list.innerHTML = '<div class="notif-center-state">Blueskyにログインすると通知がここに表示されます</div>';
        return;
      }
      if (snapshot.network === 'b' && snapshot.blueskyError) {
        list.innerHTML = `<div class="notif-center-state">Bluesky通知を取得できませんでした<br>${escape(snapshot.blueskyError)}</div>`;
        return;
      }
      if (!snapshot.items.length) {
        const xFailed = ['all', 'x'].includes(snapshot.network) && snapshot.xErrors.length > 0;
        list.innerHTML = xFailed
          ? '<div class="notif-center-state">X通知を取得できませんでした。上のボタンから通知カラムを開いて確認できます</div>'
          : '<div class="notif-center-state">条件に一致する通知はありません</div>';
        return;
      }

      list.innerHTML = snapshot.items.map((item, index) => {
        const actor = item.author || {};
        const excerptText = item.networkId === 'x' ? item.text : item.raw?.record?.text;
        const excerpt = excerptText
          ? `<div class="notif-handle">${escape(excerptText)}</div>`
          : `<div class="notif-handle">@${escape(actor.handle || '')}</div>`;
        const avatar = item.networkId === 'x'
          ? renderXAvatar(item)
          : (ui.renderAvatar?.(actor, 32) || '');
        const timeLabel = item.indexedAt
          ? (ui.relativeTime?.(item.indexedAt) || '')
          : (item.account?.username || 'X');
        return `<div class="notif-center-item ${item.isRead === false ? 'unread' : ''}" data-notification-index="${index}" role="button" tabindex="0">
          ${avatar}
          <div class="notif-copy"><div class="notif-title"><strong>${escape(actor.displayName || actor.handle || 'ユーザー')}</strong>${escape(NOTIFICATION_LABELS[item.reason] || 'さんから通知があります')}</div>${excerpt}</div>
          <div class="notif-time">${escape(timeLabel)}</div>
        </div>`;
      }).join('');
    }

    function onClick(event) {
      if (event.target === modal) {
        setOpen(false);
        return;
      }
      const action = event.target.closest?.('[data-notification-action]')?.dataset.notificationAction;
      if (action === 'refresh') handlers.reload?.();
      if (action === 'close') setOpen(false);
      if (action === 'mark-read') handlers.markAllRead?.();
      const tab = event.target.closest?.('[data-network]');
      if (tab) handlers.setNetwork?.(tab.dataset.network);
      const accountButton = event.target.closest?.('[data-x-account-index]');
      if (accountButton) handlers.openXAccount?.(Number(accountButton.dataset.xAccountIndex));
      const item = event.target.closest?.('[data-notification-index]');
      if (item) handlers.activate?.(Number(item.dataset.notificationIndex));
    }

    function onChange(event) {
      if (event.target === reasonSelect || event.target === unreadInput) {
        handlers.setFilters?.({
          reason: reasonSelect?.value || 'all',
          unreadOnly: Boolean(unreadInput?.checked),
        });
      }
    }

    function onKeyDown(event) {
      if (!['Enter', ' '].includes(event.key)) return;
      const item = event.target.closest?.('[data-notification-index]');
      if (!item) return;
      event.preventDefault();
      handlers.activate?.(Number(item.dataset.notificationIndex));
    }

    modal?.addEventListener('click', onClick);
    modal?.addEventListener('change', onChange);
    modal?.addEventListener('keydown', onKeyDown);

    return {
      connect(nextHandlers) { handlers = nextHandlers || {}; },
      dispose() {
        modal?.removeEventListener('click', onClick);
        modal?.removeEventListener('change', onChange);
        modal?.removeEventListener('keydown', onKeyDown);
        handlers = {};
      },
      render,
      setOpen,
    };
  }

  function createNotificationCenterRuntime({
    model,
    getSession = () => ({ bluesky: false, xAccounts: [] }),
    sources = {},
    view = {},
    intents = {},
    now = () => new Date(),
  } = {}) {
    if (!model) throw new Error('Notification center model is required');

    let blueskyItems = [];
    let xItems = [];
    let xErrors = [];
    let blueskyError = null;
    let network = 'all';
    let reason = 'all';
    let unreadOnly = false;
    let loading = false;
    let revision = 0;
    let disposed = false;

    function session() {
      const current = getSession() || {};
      return {
        bluesky: Boolean(current.bluesky),
        xAccounts: Array.isArray(current.xAccounts) ? current.xAccounts : [],
      };
    }

    function getAllItems() {
      return [...xItems, ...blueskyItems].sort((left, right) => {
        const leftTime = Date.parse(left.indexedAt) || 0;
        const rightTime = Date.parse(right.indexedAt) || 0;
        return rightTime - leftTime;
      });
    }

    function sourceItems() {
      if (network === 'x') return xItems;
      if (network === 'b') return blueskyItems;
      return getAllItems();
    }

    function snapshot() {
      const currentSession = session();
      const items = model.filterNotifications(sourceItems(), { reason, unreadOnly });
      return {
        network,
        reason,
        unreadOnly,
        loading,
        items,
        xAccounts: currentSession.xAccounts,
        hasBluesky: currentSession.bluesky,
        xErrors: [...xErrors],
        blueskyError,
        unreadFilterEnabled: network !== 'x' && currentSession.bluesky,
        canMarkAllRead: network !== 'x' && currentSession.bluesky,
      };
    }

    function render() {
      const current = snapshot();
      view.render?.(current);
      return current;
    }

    async function loadBluesky(currentSession) {
      if (!currentSession.bluesky) return [];
      const notifications = await sources.listBluesky?.() || [];
      return notifications.map(model.normalizeBskyNotification);
    }

    async function loadX(currentSession) {
      const results = await Promise.allSettled(currentSession.xAccounts.map((account, accountIndex) =>
        Promise.resolve(sources.listX?.(account, accountIndex) || [])
          .then(items => items.map(item => model.normalizeXNotification(item, { account, accountIndex })))
      ));
      return {
        items: results.flatMap(result => result.status === 'fulfilled' ? result.value : []),
        errors: results.flatMap((result, accountIndex) => result.status === 'rejected'
          ? [{ accountIndex, message: result.reason?.message || '取得できませんでした' }]
          : []),
      };
    }

    async function reload() {
      if (disposed) return { status: 'ignored', detail: 'disposed', snapshot: snapshot() };
      const requestRevision = ++revision;
      const currentSession = session();
      loading = true;
      render();

      const [blueskyResult, xResult] = await Promise.allSettled([
        loadBluesky(currentSession),
        loadX(currentSession),
      ]);
      if (disposed || requestRevision !== revision) {
        return { status: 'ignored', detail: 'stale', snapshot: snapshot() };
      }

      if (blueskyResult.status === 'fulfilled') {
        blueskyItems = blueskyResult.value;
        blueskyError = null;
      } else {
        blueskyItems = [];
        blueskyError = blueskyResult.reason?.message || 'Bluesky通知を取得できませんでした';
      }
      if (xResult.status === 'fulfilled') {
        xItems = xResult.value.items;
        xErrors = xResult.value.errors;
      } else {
        xItems = [];
        xErrors = currentSession.xAccounts.map((_, accountIndex) => ({
          accountIndex,
          message: xResult.reason?.message || '取得できませんでした',
        }));
      }
      loading = false;
      const current = render();
      return { status: 'succeeded', snapshot: current };
    }

    async function open() {
      if (disposed) return { status: 'ignored', detail: 'disposed', snapshot: snapshot() };
      network = 'all';
      unreadOnly = false;
      view.setOpen?.(true);
      render();
      return reload();
    }

    function setNetwork(nextNetwork) {
      network = ['all', 'x', 'b'].includes(nextNetwork) ? nextNetwork : 'all';
      if (network === 'x') unreadOnly = false;
      return render();
    }

    function setFilters(filters = {}) {
      if (typeof filters.reason === 'string') reason = filters.reason;
      if (typeof filters.unreadOnly === 'boolean') {
        unreadOnly = network === 'x' ? false : filters.unreadOnly;
      }
      return render();
    }

    async function activate(index) {
      const item = snapshot().items[index];
      if (!item) return { status: 'ignored', detail: 'not-found' };
      view.setOpen?.(false);
      intents.close?.();
      if (item.networkId === 'x') {
        await intents.openXNotification?.(item);
      } else if (item.targetUri) {
        await intents.openBlueskyPost?.(item);
      } else if (item.author?.did) {
        await intents.openBlueskyProfile?.(item);
      }
      return { status: 'succeeded', item };
    }

    async function markAllRead() {
      if (!session().bluesky || network === 'x') {
        return { status: 'ignored', detail: 'unavailable', snapshot: snapshot() };
      }
      const timestamp = now().toISOString();
      try {
        await sources.markBlueskySeen?.(timestamp);
        blueskyItems = blueskyItems.map(item => ({ ...item, isRead: true }));
        intents.clearUnread?.();
        intents.toast?.('Bluesky通知をすべて既読にしました');
        return { status: 'succeeded', snapshot: render() };
      } catch (error) {
        intents.toast?.('既読にできませんでした: ' + error.message);
        return { status: 'failed', error, snapshot: render() };
      }
    }

    function openXAccount(accountIndex) {
      const account = session().xAccounts[accountIndex];
      if (!account) return { status: 'ignored', detail: 'not-found' };
      view.setOpen?.(false);
      intents.close?.();
      intents.openXAccountNotifications?.({ account, accountIndex });
      return { status: 'succeeded' };
    }

    function dispose() {
      disposed = true;
      revision += 1;
      blueskyItems = [];
      xItems = [];
      xErrors = [];
      blueskyError = null;
      view.dispose?.();
    }

    const runtime = {
      activate,
      dispose,
      getAllItems,
      markAllRead,
      open,
      openXAccount,
      reload,
      setFilters,
      setNetwork,
    };
    view.connect?.(runtime);
    return runtime;
  }

  global.SocialDeckNotificationCenterRuntime = {
    createNotificationCenterDomView,
    createNotificationCenterRuntime,
  };
})(window);
