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
    const blueskyStatus = documentRef.getElementById('notif-center-b-status');
    const reasonSelect = documentRef.getElementById('notif-center-reason');
    const unreadInput = documentRef.getElementById('notif-center-unread');
    const searchInput = documentRef.getElementById('notif-center-search');
    const countLabel = documentRef.getElementById('notif-center-count');
    const healthLabel = documentRef.getElementById('notif-center-health');
    const refreshButton = documentRef.querySelector('[data-notification-action="refresh"]');
    const markReadButton = documentRef.querySelector('.notif-center-tools .mark-read');
    const markXReadButton = documentRef.querySelector('.notif-center-tools .mark-x-read');
    const tabs = Array.from(documentRef.querySelectorAll('.notif-center-tab'));
    const escape = ui.escape || (value => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;'));
    let handlers = {};
    let latestSnapshot = null;
    let search = '';
    let visibleLimit = 60;
    let filterKey = '';
    const renderedHtml = new WeakMap();

    function replaceHtml(element, html) {
      if (renderedHtml.get(element) === html) return;
      const scrollTop = element.scrollTop;
      element.innerHTML = html;
      if (typeof scrollTop === 'number') element.scrollTop = scrollTop;
      renderedHtml.set(element, html);
    }

    function setOpen(open) {
      modal?.classList.toggle('on', Boolean(open));
      if (open && latestSnapshot) renderVisible(latestSnapshot);
    }

    function renderXAvatar(item) {
      const actor = item.author || {};
      const account = item.account || {};
      const fallback = escape((actor.displayName || actor.handle || 'X').slice(0, 2).toUpperCase());
      const image = actor.avatar ? `<img src="${escape(actor.avatar)}" loading="lazy">` : fallback;
      return `<div class="av" style="width:32px;height:32px;background:${escape(account.bg || ui.avatarBackground?.(actor.handle) || 'var(--text2)')};font-size:9px">${image}</div>`;
    }

    function statusText(status = {}) {
      const last = status.lastSuccess ? `最終取得 ${new Date(status.lastSuccess).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'まだ取得していません';
      const labels = { idle: '待機中', loading: '取得中…', disabled: '取得オフ', succeeded: '取得済み', failed: '取得失敗（前回の通知を表示）', 'login-required': 'Xへのログインが必要です' };
      return `${labels[status.phase] || '待機中'} · ${last}${status.error && status.phase === 'failed' ? ` · ${status.error}` : ''}`;
    }

    function render(snapshot) {
      latestSnapshot = snapshot;
      if (modal?.classList.contains('on')) renderVisible(snapshot);
    }

    function renderVisible(snapshot) {
      const nextFilterKey = JSON.stringify([snapshot.network, snapshot.reason, snapshot.unreadOnly, search]);
      if (nextFilterKey !== filterKey) {
        visibleLimit = 60;
        filterKey = nextFilterKey;
        if (list) list.scrollTop = 0;
      }
      // Preserve the model index: filtering and pagination must not change action targets.
      const words = search.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
      const matches = snapshot.items.map((item, index) => ({ item, index })).filter(({ item }) => {
        if (!words.length) return true;
        const text = [item.author?.displayName, item.author?.handle, item.text, item.raw?.record?.text,
          item.account?.username, item.networkId === 'b' ? 'Bluesky' : 'X'].join(' ').normalize('NFKC').toLocaleLowerCase();
        return words.every(word => text.includes(word));
      });
      if (countLabel) countLabel.textContent = `${matches.length}件 · 未読 ${matches.filter(({ item }) => item.isRead === false).length}`;
      if (refreshButton) refreshButton.disabled = Boolean(snapshot.loading);
      if (healthLabel) {
        const failures = (snapshot.xStates || []).filter(state => state.enabled && ['failed', 'login-required'].includes(state.phase)).length
          + (snapshot.hasBluesky && snapshot.blueskyState?.phase === 'failed' ? 1 : 0);
        healthLabel.textContent = failures ? `${failures}アカウントを確認` : snapshot.loading ? '更新中…' : '取得設定を確認';
        healthLabel.classList.toggle('needs-attention', failures > 0);
      }
      tabs.forEach(tab => tab.classList.toggle('on', tab.dataset.network === snapshot.network));
      if (reasonSelect) {
        reasonSelect.value = snapshot.reason;
        reasonSelect.disabled = false;
      }
      if (unreadInput) {
        unreadInput.checked = snapshot.unreadOnly;
        unreadInput.disabled = !snapshot.unreadFilterEnabled;
      }
      if (markReadButton) {
        markReadButton.disabled = !snapshot.canMarkAllRead;
        markReadButton.hidden = snapshot.network === 'x' || !snapshot.hasBluesky;
      }
      if (markXReadButton) {
        markXReadButton.hidden = snapshot.network === 'b' || !snapshot.xAccounts.length;
        markXReadButton.disabled = !snapshot.canMarkXRead;
      }

      const showX = ['all', 'x'].includes(snapshot.network) && snapshot.xAccounts.length > 0;
      xArea?.classList.toggle('show', showX);
      if (xArea) {
        const accountHtml = showX ? '<div class="notif-fetch-hint">取得するXアカウント（変更は自動保存）。オフでも前回の通知は残ります。</div>' + snapshot.xAccounts.map((account, accountIndex) => {
          const status = snapshot.xStates?.[accountIndex] || { enabled: true };
          return `<div class="notif-fetch-account">
          <label><input type="checkbox" data-fetch-account="${accountIndex}" ${status.enabled ? 'checked' : ''}>${escape(account.username)}</label>
          <span class="notif-fetch-status" role="status">${escape(statusText(status))}</span>
          <button class="notif-fetch-retry" data-fetch-retry="${accountIndex}" ${!status.enabled || status.phase === 'loading' || status.phase === 'login-required' ? 'disabled' : ''}>再試行</button>
          <button class="notif-x-account" data-x-account-index="${accountIndex}">
            <span style="background:${escape(account.bg || 'var(--text2)')}">${escape(account.initials || 'X')}</span>
            ${escape(account.username)} の通知カラム
          </button></div>`;
        }).join('') : '';
        replaceHtml(xArea, accountHtml);
      }
      if (blueskyStatus) {
        blueskyStatus.hidden = snapshot.network === 'x' || !snapshot.hasBluesky;
        blueskyStatus.textContent = 'Bluesky: ' + statusText(snapshot.blueskyState);
      }
      if (!list) return;
      if (snapshot.loading && !snapshot.items.length) {
        replaceHtml(list, '<div class="notif-center-state">通知を読み込んでいます...</div>');
        return;
      }
      if (snapshot.network === 'b' && !snapshot.hasBluesky) {
        replaceHtml(list, '<div class="notif-center-state">Blueskyにログインすると通知がここに表示されます</div>');
        return;
      }
      if (snapshot.network === 'b' && snapshot.blueskyError && !snapshot.items.length) {
        replaceHtml(list, `<div class="notif-center-state">Bluesky通知を取得できませんでした<br>${escape(snapshot.blueskyError)}</div>`);
        return;
      }
      if (!matches.length) {
        const xFailed = ['all', 'x'].includes(snapshot.network) && snapshot.xErrors.length > 0;
        replaceHtml(list, xFailed
          ? '<div class="notif-center-state">通知の取得に問題があります。<br>「アカウント・取得状況」から確認できます。</div>'
          : `<div class="notif-center-state">${search ? '検索に一致する通知はありません' : snapshot.unreadOnly ? '未読の通知はありません' : '条件に一致する通知はありません'}</div>`);
        return;
      }

      replaceHtml(list, matches.slice(0, visibleLimit).map(({ item, index }) => {
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
          : '';
        const replyButton = ui.canReply?.(item)
          ? `<button class="notif-reply-button" data-notification-reply="${index}">返信</button>` : '';
        const readButton = item.networkId === 'x' && item.isRead === false
          ? `<button class="notif-reply-button" data-notification-read="${index}">既読にする</button>` : '';
        return `<div class="notif-center-item ${item.isRead === false ? 'unread' : ''}" data-notification-index="${index}" role="button" tabindex="0">
          ${avatar}
          <div class="notif-copy"><div class="notif-title"><strong>${escape(actor.displayName || actor.handle || 'ユーザー')}</strong>${escape(NOTIFICATION_LABELS[item.reason] || 'さんから通知があります')}</div>${excerpt}<div class="notif-center-meta">${escape(item.networkId === 'b' ? 'Bluesky' : `X · ${item.account?.username || 'Xアカウント'}`)}${item.isRead === false ? ' · 未読' : ''}</div></div>
          <div class="notif-time">${escape(timeLabel)}${replyButton}${readButton}</div>
        </div>`;
      }).join('') + (matches.length > visibleLimit ? `<button class="notif-center-more" data-notification-action="more">さらに表示（残り${matches.length - visibleLimit}件）</button>` : ''));
    }

    function onClick(event) {
      const retry = event.target.closest?.('[data-fetch-retry]');
      if (retry) { handlers.retryX?.(Number(retry.dataset.fetchRetry)); return; }
      const read = event.target.closest?.('[data-notification-read]');
      if (read) {
        handlers.markRead?.(Number(read.dataset.notificationRead));
        return;
      }
      const reply = event.target.closest?.('[data-notification-reply]');
      if (reply) {
        handlers.reply?.(Number(reply.dataset.notificationReply));
        return;
      }
      if (event.target === modal) {
        setOpen(false);
        return;
      }
      const action = event.target.closest?.('[data-notification-action]')?.dataset.notificationAction;
      if (action === 'refresh') handlers.reload?.();
      if (action === 'more') { visibleLimit += 60; if (latestSnapshot) renderVisible(latestSnapshot); }
      if (action === 'close') setOpen(false);
      if (action === 'mark-read') handlers.markAllRead?.();
      if (action === 'mark-x-read') handlers.markAllXRead?.();
      const tab = event.target.closest?.('[data-network]');
      if (tab) handlers.setNetwork?.(tab.dataset.network);
      const accountButton = event.target.closest?.('[data-x-account-index]');
      if (accountButton) handlers.openXAccount?.(Number(accountButton.dataset.xAccountIndex));
      const item = event.target.closest?.('[data-notification-index]');
      if (item) handlers.activate?.(Number(item.dataset.notificationIndex));
    }

    function onChange(event) {
      if (event.target.dataset?.fetchAccount !== undefined) {
        handlers.setXEnabled?.(Number(event.target.dataset.fetchAccount), event.target.checked);
        return;
      }
      if (event.target === reasonSelect || event.target === unreadInput) {
        handlers.setFilters?.({
          reason: reasonSelect?.value || 'all',
          unreadOnly: Boolean(unreadInput?.checked),
        });
      }
    }

    function onInput(event) {
      if (event.target !== searchInput) return;
      search = searchInput.value;
      if (latestSnapshot) renderVisible(latestSnapshot);
    }

    function onKeyDown(event) {
      if (event.target.closest?.('[data-notification-reply], [data-notification-read]')) return;
      if (!['Enter', ' '].includes(event.key)) return;
      const item = event.target.closest?.('[data-notification-index]');
      if (!item) return;
      event.preventDefault();
      handlers.activate?.(Number(item.dataset.notificationIndex));
    }

    modal?.addEventListener('click', onClick);
    modal?.addEventListener('change', onChange);
    modal?.addEventListener('input', onInput);
    modal?.addEventListener('keydown', onKeyDown);

    return {
      connect(nextHandlers) { handlers = nextHandlers || {}; },
      dispose() {
        modal?.removeEventListener('click', onClick);
        modal?.removeEventListener('change', onChange);
        modal?.removeEventListener('input', onInput);
        modal?.removeEventListener('keydown', onKeyDown);
        handlers = {};
        latestSnapshot = null;
      },
      render,
      setOpen,
      clearSearch() {
        search = '';
        if (searchInput) searchInput.value = '';
      },
    };
  }

  function createNotificationCenterRuntime({
    model,
    storage = global.localStorage,
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
    let reloading = null;
    let reloadAccountIndex;
    let queuedReload = null;
    const filtersKey = 'socialdeck_notification_filters_v1';
    const validReasons = ['all', 'conversation', 'reply', 'mention', 'like', 'repost', 'follow', 'quote'];
    function normalizeFilters(value = {}) {
      return {
        network: ['all', 'x', 'b'].includes(value?.network) ? value.network : 'all',
        reason: validReasons.includes(value?.reason) ? value.reason : 'all',
        unreadOnly: value?.unreadOnly === true,
      };
    }
    let savedFilters = normalizeFilters();
    try { savedFilters = normalizeFilters(JSON.parse(storage?.getItem?.(filtersKey) || '{}')); } catch {}
    ({ network, reason, unreadOnly } = savedFilters);
    function saveFilters() {
      savedFilters = { network, reason, unreadOnly };
      try { storage?.setItem?.(filtersKey, JSON.stringify(savedFilters)); }
      catch { intents.toast?.('表示条件を保存できませんでした'); }
    }
    const selectionKey = 'socialdeck_notification_accounts_v1';
    let accountSelection = {};
    try {
      const saved = JSON.parse(storage?.getItem?.(selectionKey) || '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) accountSelection = saved;
    } catch {}
    const xStates = new Map();
    let blueskyState = { phase: 'idle', lastSuccess: null, error: null };
    let blueskyOwner = null;
    const accountKey = account => account.partition || account.username;
    const isEnabled = account => accountSelection[accountKey(account)] !== false;

    function accountState(account) {
      const saved = xStates.get(accountKey(account)) || { phase: 'idle', lastSuccess: null, error: null };
      return { ...saved, enabled: isEnabled(account), phase: !isEnabled(account) ? 'disabled'
        : account.loginPending ? 'login-required' : saved.phase };
    }

    function session() {
      const current = getSession() || {};
      return {
        bluesky: Boolean(current.bluesky),
        blueskyAccountId: current.blueskyAccountId || (current.bluesky ? 'bluesky' : null),
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
      return getAllItems().filter(item => network === 'all' || item.networkId === network);
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
        xStates: currentSession.xAccounts.map(accountState),
        blueskyState: { ...blueskyState },
        hasBluesky: currentSession.bluesky,
        xErrors: [...xErrors],
        blueskyError,
        unreadFilterEnabled: currentSession.bluesky || currentSession.xAccounts.length > 0,
        canMarkAllRead: network !== 'x' && currentSession.bluesky,
        canMarkXRead: xItems.some(item => item.isRead === false),
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

    async function loadX(currentSession, onlyAccountIndex) {
      return Promise.all(currentSession.xAccounts.map(async (account, accountIndex) => {
        if (!isEnabled(account) || account.loginPending
          || (onlyAccountIndex !== undefined && onlyAccountIndex !== accountIndex)) return null;
        try {
          const items = await sources.listX?.(account, accountIndex) || [];
          return { account, accountIndex, items: items.map(item => model.normalizeXNotification(item, { account, accountIndex })) };
        } catch (error) {
          return { account, accountIndex, error: error?.message || '取得できませんでした', loginRequired: error?.code === 'X_LOGIN_REQUIRED' };
        }
      }));
    }

    async function executeReload({ background = false, accountIndex: onlyAccountIndex } = {}) {
      if (disposed) return { status: 'ignored', detail: 'disposed', snapshot: snapshot() };
      const requestRevision = ++revision;
      const currentSession = session();
      if (blueskyOwner !== currentSession.blueskyAccountId) {
        blueskyItems = [];
        blueskyError = null;
        blueskyState = { phase: 'idle', lastSuccess: null, error: null };
        blueskyOwner = currentSession.blueskyAccountId;
      }
      loading = true;
      currentSession.xAccounts.forEach((account, index) => {
        if (isEnabled(account) && !account.loginPending && (onlyAccountIndex === undefined || onlyAccountIndex === index)) {
          xStates.set(accountKey(account), { ...accountState(account), phase: 'loading', error: null });
        }
      });
      const fetchBluesky = onlyAccountIndex === undefined;
      if (fetchBluesky && currentSession.bluesky) blueskyState = { ...blueskyState, phase: 'loading', error: null };
      render();

      const [blueskyResult, xResult] = await Promise.allSettled([
        fetchBluesky ? loadBluesky(currentSession) : Promise.resolve(blueskyItems),
        loadX(currentSession, onlyAccountIndex),
      ]);
      if (disposed || requestRevision !== revision) {
        return { status: 'ignored', detail: 'stale', snapshot: snapshot() };
      }
      const latestSession = session();
      if (latestSession.blueskyAccountId !== currentSession.blueskyAccountId
        || latestSession.xAccounts.map(accountKey).join('|') !== currentSession.xAccounts.map(accountKey).join('|')) {
        xItems = xItems.filter(item => latestSession.xAccounts.some(account => accountKey(account) === accountKey(item.account || {})));
        if (latestSession.blueskyAccountId !== currentSession.blueskyAccountId) blueskyItems = [];
        loading = false;
        return { status: 'ignored', detail: 'session-changed', snapshot: render() };
      }

      if (blueskyResult.status === 'fulfilled') {
        blueskyItems = blueskyResult.value;
        if (fetchBluesky) {
          blueskyError = null;
          blueskyState = { phase: currentSession.bluesky ? 'succeeded' : 'idle', lastSuccess: currentSession.bluesky ? now().toISOString() : null, error: null };
        }
      } else {
        blueskyError = blueskyResult.reason?.message || 'Bluesky通知を取得できませんでした';
        blueskyState = { ...blueskyState, phase: 'failed', error: blueskyError };
      }
      if (xResult.status === 'fulfilled') {
        xResult.value.filter(Boolean).forEach(result => {
          if (!isEnabled(result.account)) return;
          const key = accountKey(result.account);
          const previous = xStates.get(key) || {};
          if (result.error) {
            xStates.set(key, { ...previous, phase: result.loginRequired ? 'login-required' : 'failed', error: result.error });
          } else {
            xItems = xItems.filter(item => accountKey(item.account || {}) !== key).concat(result.items);
            xStates.set(key, { phase: 'succeeded', lastSuccess: now().toISOString(), error: null });
          }
        });
      } else {
        currentSession.xAccounts.forEach(account => {
          if (isEnabled(account)) xStates.set(accountKey(account), { ...accountState(account), phase: 'failed', error: xResult.reason?.message || '取得できませんでした' });
        });
      }
      xErrors = currentSession.xAccounts.flatMap((account, accountIndex) => {
        const status = accountState(account);
        return status.enabled && (status.error || status.phase === 'login-required')
          ? [{ accountIndex, message: status.phase === 'login-required' ? 'Xへのログインが必要です' : status.error }] : [];
      });
      xItems = xItems.filter(item => currentSession.xAccounts.some(account => accountKey(account) === accountKey(item.account || {})));
      xItems = intents.observeX?.(xItems, currentSession.xAccounts, xErrors, currentSession.xAccounts.map(isEnabled)) || xItems;
      loading = false;
      const current = render();
      return { status: 'succeeded', snapshot: current };
    }

    function reload(options = {}) {
      if (reloading) {
        if (reloadAccountIndex === undefined || reloadAccountIndex === options.accountIndex) return reloading;
        // A partial request cannot satisfy a full refresh or a different account retry.
        // Coalesce these requests into one follow-up refresh after the current reader finishes.
        if (!queuedReload) {
          queuedReload = reloading.catch(() => {}).then(() => {
            queuedReload = null;
            return reload({ background: true });
          });
        }
        return queuedReload;
      }
      reloadAccountIndex = options.accountIndex;
      reloading = executeReload(options).finally(() => { reloading = null; });
      return reloading;
    }

    async function setXEnabled(accountIndex, enabled) {
      const account = session().xAccounts[accountIndex];
      if (!account || disposed) return { status: 'ignored' };
      const next = { ...accountSelection, [accountKey(account)]: Boolean(enabled) };
      try {
        storage?.setItem?.(selectionKey, JSON.stringify(next));
      } catch (error) {
        intents.toast?.('取得するアカウントを保存できませんでした');
        render();
        return { status: 'failed', error };
      }
      accountSelection = next;
      if (!enabled) xErrors = xErrors.filter(error => error.accountIndex !== accountIndex);
      render();
      if (enabled) {
        if (reloading) await reloading;
        const currentIndex = session().xAccounts.findIndex(entry => accountKey(entry) === accountKey(account));
        if (currentIndex < 0 || !isEnabled(account)) return { status: 'ignored' };
        return reload({ accountIndex: currentIndex });
      }
      return { status: 'succeeded', snapshot: snapshot() };
    }

    function retryX(accountIndex) {
      const account = session().xAccounts[accountIndex];
      if (!account || !isEnabled(account)) return { status: 'ignored' };
      return reload({ accountIndex });
    }

    async function open(filters = {}) {
      if (disposed) return { status: 'ignored', detail: 'disposed', snapshot: snapshot() };
      if (Object.keys(filters).length) view.clearSearch?.();
      ({ network, reason, unreadOnly } = normalizeFilters({ ...savedFilters, ...filters }));
      view.setOpen?.(true);
      render();
      return reload();
    }

    function setNetwork(nextNetwork) {
      network = ['all', 'x', 'b'].includes(nextNetwork) ? nextNetwork : 'all';
      saveFilters();
      return render();
    }

    function setFilters(filters = {}) {
      if (typeof filters.reason === 'string') reason = validReasons.includes(filters.reason) ? filters.reason : 'all';
      if (typeof filters.unreadOnly === 'boolean') {
        unreadOnly = filters.unreadOnly;
      }
      saveFilters();
      return render();
    }

    async function activate(index) {
      const item = snapshot().items[index];
      if (!item) return { status: 'ignored', detail: 'not-found' };
      view.setOpen?.(false);
      intents.close?.();
      if (item.networkId === 'x') {
        await intents.openXNotification?.(item);
        xItems = intents.observeX?.(xItems, session().xAccounts, xErrors, session().xAccounts.map(isEnabled)) || xItems;
        render();
      } else if (item.targetUri) {
        await intents.openBlueskyPost?.(item);
      } else if (item.author?.did) {
        await intents.openBlueskyProfile?.(item);
      }
      return { status: 'succeeded', item };
    }

    async function reply(index) {
      const item = snapshot().items[index];
      if (!item) return { status: 'ignored', detail: 'not-found' };
      try {
        const opened = await intents.reply?.(item);
        if (opened === false) {
          intents.toast?.('返信画面を開けませんでした。アカウントのログイン状態を確認してください');
          return { status: 'failed' };
        }
        return { status: 'succeeded', item };
      } catch (error) {
        intents.toast?.('返信画面を開けませんでした: ' + error.message);
        return { status: 'failed', error };
      }
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

    function markRead(index) {
      const item = snapshot().items[index];
      if (!item || item.networkId !== 'x' || item.isRead !== false) return { status: 'ignored' };
      intents.markXRead?.(item);
      xItems = xItems.map(entry => entry.id === item.id ? { ...entry, isRead: true } : entry);
      return { status: 'succeeded', snapshot: render() };
    }

    function markAllXRead() {
      intents.markAllXRead?.();
      xItems = xItems.map(item => item.isRead === false ? { ...item, isRead: true } : item);
      intents.toast?.('Xの通知をすべて既読にしました');
      return { status: 'succeeded', snapshot: render() };
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
      reply,
      dispose,
      getAllItems,
      markAllRead,
      markRead,
      markAllXRead,
      open,
      openXAccount,
      reload,
      setFilters,
      setNetwork,
      setXEnabled,
      retryX,
    };
    view.connect?.(runtime);
    return runtime;
  }

  global.SocialDeckNotificationCenterRuntime = {
    createNotificationCenterDomView,
    createNotificationCenterRuntime,
  };
})(window);
