(function (global) {
  function createXWebViewRuntime({
    documentRef = global.document,
    storage = global.localStorage,
    isElectron = true,
    loginGate,
    isLoginPending = () => false,
    completeLogin = () => {},
    getRefreshInterval = () => undefined,
    setRefreshInterval = () => {},
    defaultRefreshInterval = 60000,
    createRefreshScript,
    getCanonicalUrl = () => null,
    getPreloadPath = () => '',
    allowDevTools = false,
    openImage = () => {},
    setTimeoutFn = global.setTimeout,
    clearTimeoutFn = global.clearTimeout,
  } = {}) {
    let accounts = [];
    let postingDepth = 0;
    const reloadQueue = new Set();
    const silentReloading = new Set();

    function syncAccounts(nextAccounts = []) {
      accounts = nextAccounts.map((account, index) => ({
        ...account,
        index,
        partition: account.partition || `persist:x-${index}`,
      }));
      documentRef.querySelectorAll('webview').forEach(webview => {
        const match = /^x-notif-reader-(\d+)$/.exec(webview.id || '');
        if (!match) return;
        const account = accounts[Number(match[1])];
        if (!account || webview.partition !== account.partition) webview.remove();
      });
    }

    function findAccount(accountId) {
      return accounts.find(account => (
        account.username === accountId || account.partition === accountId
      )) || null;
    }

    function getWebView(id) {
      return documentRef.getElementById(`wv-${id}`);
    }

    function getColumn(id) {
      return documentRef.getElementById(`col-${id}`);
    }

    function setRefreshBusy(id, busy) {
      const button = documentRef.getElementById(`rfr-${id}`);
      if (button) button.classList.toggle('updating', Boolean(busy));
      const sub = documentRef.querySelector(`#col-${id} .col-sub`);
      if (!sub) return;
      if (busy) {
        if (!sub.dataset.origText) sub.dataset.origText = sub.innerHTML;
        sub.innerHTML = '<div class="ldot" style="background:var(--accent)"></div>更新中...';
      } else if (sub.dataset.origText) {
        sub.innerHTML = sub.dataset.origText;
        delete sub.dataset.origText;
      }
    }

    function finishReload(id, webview) {
      silentReloading.delete(id);
      setRefreshBusy(id, false);
      webview.style.opacity = webview.dataset.sdPrevOpacity || '';
      delete webview.dataset.sdPrevOpacity;
    }

    function observeLogin(partition, id, url) {
      if (!loginGate) return;
      const wasActive = loginGate.isActive(partition);
      const parkedIds = loginGate.observe(partition, id, url);
      if (wasActive && !loginGate.isActive(partition)) {
        completeLogin(partition);
        releaseParked(partition, parkedIds);
      }
    }

    function releaseParked(partition, parkedIds) {
      parkedIds.forEach(id => {
        const webview = getWebView(id);
        if (!webview || webview.partition !== partition) return;
        webview.dataset.sdLoginParked = 'false';
        const loading = documentRef.getElementById(`wvload-${id}`);
        if (loading) loading.innerHTML = '<div class="spinner"></div>読み込み中…';
        webview.src = webview.dataset.sdLoginTarget;
      });
    }

    function createWebViewElement({ id, networkId, partition, targetUrl, preloadPath }) {
      const loginPending = networkId === 'x' && isLoginPending(partition);
      const parked = networkId === 'x' && loginGate
        ? loginGate.register(partition, id, loginPending)
        : false;
      const webview = documentRef.createElement('webview');
      webview.id = `wv-${id}`;
      webview.style.flex = '1';
      webview.style.display = 'none';
      webview.setAttribute('partition', partition);
      webview.setAttribute('webpreferences', 'backgroundThrottling=false');
      if (networkId === 'x' && preloadPath) webview.setAttribute('preload', preloadPath);
      webview.dataset.sdLoginParked = String(parked);
      webview.dataset.sdLoginTarget = targetUrl;
      webview.src = parked ? 'about:blank' : targetUrl;
      return { webview, parked };
    }

    function mountColumn({
      id,
      networkId,
      partition,
      targetUrl,
      host,
      preloadPath = '',
    }) {
      const loading = documentRef.getElementById(`wvload-${id}`);
      const overlay = documentRef.getElementById(`wvov-${id}`);
      const { webview, parked } = createWebViewElement({
        id, networkId, partition, targetUrl, preloadPath,
      });
      if (loading && parked) {
        loading.innerHTML = '<div class="spinner"></div>Xのログイン完了を待っています…';
      }
      host.insertBefore(webview, overlay || null);

      if (networkId === 'x') {
        const onNavigate = event => observeLogin(partition, id, event.url);
        webview.addEventListener('did-navigate', onNavigate);
        webview.addEventListener('did-navigate-in-page', onNavigate);
      }

      let readyOnce = false;
      webview.addEventListener('dom-ready', () => {
        if (webview.dataset.sdLoginParked === 'true') return;
        webview.dataset.ready = 'true';
        if (loading) loading.style.display = 'none';
        webview.style.display = 'flex';
        if (!readyOnce) {
          readyOnce = true;
          if (getRefreshInterval(id) === undefined) {
            setRefreshInterval(id, defaultRefreshInterval);
          }
        }
      });

      webview.addEventListener('did-finish-load', () => {
        if (networkId === 'x') observeLogin(partition, id, webview.getURL());
        if (webview.dataset.sdLoginParked === 'true') return;
        finishReload(id, webview);
        const savedFontSize = Number(storage?.getItem?.(`col_fs_${id}`));
        if (savedFontSize && savedFontSize !== 13) {
          webview.insertCSS(`* { font-size: ${savedFontSize}px !important; }`).catch(() => {});
        }
        if (overlay && overlay.style.display !== 'none') {
          overlay.style.opacity = '0';
          setTimeoutFn(() => {
            overlay.style.display = 'none';
            overlay.style.backgroundImage = '';
            overlay.style.opacity = '1';
          }, 420);
        }
      });

      webview.addEventListener('ipc-message', event => {
        if (event.channel !== 'x-img-open') return;
        try {
          const { urls, idx } = JSON.parse(event.args[0]);
          if (urls?.length) openImage(urls, idx);
        } catch {}
      });

      webview.addEventListener('did-fail-load', event => {
        if (event?.errorCode === -3) return;
        finishReload(id, webview);
        if (!loading) return;
        loading.style.display = '';
        loading.innerHTML = '<div style="color:var(--red);font-size:12px;text-align:center;padding:20px">読み込みに失敗しました<br><button type="button" style="margin-top:8px;padding:4px 10px;border-radius:5px;background:transparent;border:1px solid var(--red);color:var(--red);cursor:pointer;font-size:11px">再試行</button></div>';
        loading.querySelector('button')?.addEventListener('click', () => reload(id, { silent: false }));
      });

      return webview;
    }

    async function back(id) {
      const webview = getWebView(id);
      if (!webview) return false;
      const canonicalUrl = getCanonicalUrl(id);
      if (canonicalUrl) {
        await webview.loadURL(canonicalUrl);
        return true;
      }
      if (webview.canGoBack()) {
        webview.goBack();
        return true;
      }
      return false;
    }

    async function navigate(id, url) {
      const webview = getWebView(id);
      if (!webview?.loadURL) return false;
      await webview.loadURL(url);
      return true;
    }

    async function navigateToStart(id, originalUrl) {
      const webview = getWebView(id);
      if (!webview) return false;
      const targetUrl = getCanonicalUrl(id) || originalUrl || webview.src;
      if (webview.src === targetUrl) await reload(id);
      else await webview.loadURL(targetUrl);
      return true;
    }

    async function reload(id, { silent = true } = {}) {
      const webview = getWebView(id);
      if (!webview) return { status: 'unavailable' };
      if (postingDepth > 0) {
        reloadQueue.add(id);
        return { status: 'queued' };
      }

      const overlay = documentRef.getElementById(`wvov-${id}`);
      if (silent) {
        silentReloading.add(id);
        setRefreshBusy(id, true);
      }
      if (silent && overlay && webview.style.display !== 'none') {
        overlay.style.backgroundImage = '';
        overlay.style.backgroundColor = '#000';
        overlay.style.display = 'block';
        overlay.style.opacity = '1';
        webview.dataset.sdPrevOpacity = webview.style.opacity || '';
        webview.style.opacity = '0';
      }

      const canonicalUrl = getCanonicalUrl(id);
      if (canonicalUrl) await webview.loadURL(canonicalUrl);
      else webview.reload();

      if (silent) {
        setTimeoutFn(() => {
          if (!silentReloading.has(id)) return;
          finishReload(id, webview);
        }, 30000);
      }
      return { status: 'reloading' };
    }

    async function refreshNavigation(id, destination = 'home') {
      const webview = getWebView(id);
      if (!webview || webview.style.display === 'none') return 'unavailable';
      if (postingDepth > 0) {
        reloadQueue.add(id);
        return 'queued';
      }
      try {
        return await webview.executeJavaScript(createRefreshScript(destination));
      } catch {
        return 'failed';
      }
    }

    async function refreshIds(ids) {
      return Promise.all(ids.map(async id => {
        const definitionId = getColumn(id)?.dataset?.definitionId;
        const destination = definitionId === 'x-home-new'
          ? 'home'
          : definitionId === 'x-notif-new'
            ? 'notifications'
            : null;
        if (!destination) return reload(id);
        const result = await refreshNavigation(id, destination);
        const accepted = new Set([
          'home-clicked', 'notifications-clicked', 'banner-clicked',
          'deferred', 'not-following', 'interaction-open', 'queued',
        ]);
        return accepted.has(result) ? { status: result } : reload(id);
      }));
    }

    async function flushReloadQueue() {
      if (postingDepth > 0 || reloadQueue.size === 0) return [];
      const ids = [...reloadQueue];
      reloadQueue.clear();
      return refreshIds(ids);
    }

    async function withPosting(task) {
      postingDepth += 1;
      try {
        return await task();
      } finally {
        postingDepth -= 1;
        if (postingDepth === 0) await flushReloadQueue();
      }
    }

    function findComposeWebView(accountId) {
      const account = findAccount(accountId);
      if (!account) return null;
      let home = null;
      let fallback = null;
      documentRef.querySelectorAll('webview').forEach(webview => {
        if (webview.partition !== account.partition) return;
        const source = webview.src || '';
        if (/x\.com\/home|twitter\.com\/home/.test(source)) home = webview;
        else if (!fallback && /x\.com|twitter\.com/.test(source)) fallback = webview;
      });
      return home || fallback;
    }

    async function executeCompose(delivery, context, execute) {
      const webview = findComposeWebView(delivery.accountId);
      if (!webview) throw new Error('X compose delivery requires a Home Column');
      return withPosting(() => execute(delivery, { ...context, webview }));
    }

    async function refreshAccount(accountId) {
      const account = findAccount(accountId);
      if (!account) return [];
      const ids = [];
      documentRef.querySelectorAll('webview').forEach(webview => {
        if (webview.partition !== account.partition) return;
        if (!webview.id?.startsWith('wv-')) return;
        const id = webview.id?.replace(/^wv-/, '');
        if (id) ids.push(id);
      });
      return refreshIds(ids);
    }

    function disposeColumn(id) {
      reloadQueue.delete(id);
      silentReloading.delete(id);
      const webview = getWebView(id);
      const partition = webview?.partition;
      if (!partition || !loginGate?.unregister) return;
      const parkedIds = loginGate.unregister(partition, id);
      const remainingIds = parkedIds.filter(parkedId => (
        parkedId !== id && Boolean(getWebView(parkedId))
      ));
      const nextOwnerId = remainingIds.shift();
      if (!nextOwnerId) return;
      loginGate.register(partition, nextOwnerId, true);
      remainingIds.forEach(parkedId => loginGate.register(partition, parkedId, true));
      const nextOwner = getWebView(nextOwnerId);
      if (!nextOwner) return;
      releaseParked(partition, [nextOwnerId]);
    }

    function openDevTools() {
      if (!allowDevTools) return false;
      let target = null;
      documentRef.querySelectorAll('webview').forEach(webview => {
        const source = webview.src || '';
        if (!/x\.com|twitter\.com/.test(source)) return;
        if (!target || /x\.com\/home|twitter\.com\/home/.test(source)) target = webview;
      });
      if (!target?.openDevTools) return false;
      target.openDevTools();
      return true;
    }

    function setFontSize(id, fontSize) {
      const webview = getWebView(id);
      if (!webview?.insertCSS) return false;
      webview.insertCSS(`* { font-size: ${fontSize}px !important; }`).catch(() => {});
      return true;
    }

    function waitUntilReady(webview, message = 'Xページを読み込めませんでした') {
      if (webview.dataset.ready === 'true') return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timeout = setTimeoutFn(() => {
          cleanup();
          reject(new Error(message));
        }, 15000);
        const ready = () => { cleanup(); resolve(); };
        const failed = event => {
          if (event.errorCode === -3) return;
          cleanup();
          reject(new Error(message));
        };
        const cleanup = () => {
          clearTimeoutFn(timeout);
          webview.removeEventListener('dom-ready', ready);
          webview.removeEventListener('did-fail-load', failed);
        };
        webview.addEventListener('dom-ready', ready, { once: true });
        webview.addEventListener('did-fail-load', failed);
      });
    }

    function findVisibleNotificationWebView(partition) {
      const columns = documentRef.querySelectorAll('.col');
      for (const column of columns) {
        if (column.dataset?.definitionId !== 'x-notif-new') continue;
        const webview = column.querySelector?.('webview');
        if (webview?.partition !== partition) continue;
        const currentUrl = webview.getURL?.() || webview.src || '';
        try {
          if (new URL(currentUrl).pathname.startsWith('/notifications')) return webview;
        } catch {}
      }
      return null;
    }

    function getNotificationReader(host, account) {
      const id = `x-notif-reader-${account.index}`;
      const visible = findVisibleNotificationWebView(account.partition);
      if (visible) {
        documentRef.getElementById(id)?.remove();
        return visible;
      }
      if (!host || !isElectron || account.loginPending) return null;
      let webview = documentRef.getElementById(id);
      if (webview && webview.partition !== account.partition) {
        webview.remove();
        webview = null;
      }
      if (webview) return webview;

      webview = documentRef.createElement('webview');
      webview.id = id;
      webview.setAttribute('partition', account.partition);
      webview.setAttribute('webpreferences', 'backgroundThrottling=true');
      const preloadPath = getPreloadPath();
      if (preloadPath) webview.setAttribute('preload', preloadPath);
      webview.addEventListener('dom-ready', () => { webview.dataset.ready = 'true'; });
      webview.src = 'https://x.com/notifications';
      host.appendChild(webview);
      return webview;
    }

    function disposeNotificationReaders() {
      let disposed = 0;
      documentRef.querySelectorAll('webview').forEach(webview => {
        if (!/^x-notif-reader-\d+$/.test(webview.id || '')) return;
        webview.remove();
        disposed += 1;
      });
      return disposed;
    }

    function getMemoryStats() {
      let columnWebViewCount = 0;
      let notificationReaderCount = 0;
      documentRef.querySelectorAll('webview').forEach(webview => {
        const id = String(webview.id || '');
        if (/^x-notif-reader-\d+$/.test(id)) {
          notificationReaderCount += 1;
        } else if (/^wv-x-/.test(id)) {
          columnWebViewCount += 1;
        }
      });
      return { columnWebViewCount, notificationReaderCount };
    }

    async function listNotifications({ accountId, host, script, retainReader = false }) {
      const account = findAccount(accountId);
      if (!account) return [];
      const webview = getNotificationReader(host, account);
      if (!webview) return [];
      const hiddenReader = /^x-notif-reader-\d+$/.test(webview.id || '');
      try {
        await waitUntilReady(webview, 'X通知ページを読み込めませんでした');
        return await webview.executeJavaScript(script) || [];
      } finally {
        if (hiddenReader && !retainReader) webview.remove();
      }
    }

    async function openNotificationTarget({ columnId, item, notificationUrl, activationScript }) {
      const webview = getWebView(columnId);
      if (!webview) return { status: 'unavailable' };
      const targetUrl = item.targetUrl || notificationUrl;
      const needsActivation = ['like', 'repost', 'reply', 'mention', 'quote'].includes(item.reason)
        && !/\/status\/\d+/.test(targetUrl);
      if (!needsActivation) {
        await webview.loadURL(targetUrl);
        return { status: 'opened' };
      }

      await waitUntilReady(webview, 'X通知カラムを読み込めませんでした');
      if (webview.getURL?.() !== notificationUrl) await webview.loadURL(notificationUrl);
      const activated = await webview.executeJavaScript(activationScript);
      return { status: activated ? 'opened' : 'not-found' };
    }

    return {
      back,
      disposeNotificationReaders,
      disposeColumn,
      executeCompose,
      getMemoryStats,
      listNotifications,
      mountColumn,
      navigate,
      navigateToStart,
      openDevTools,
      openNotificationTarget,
      refreshAccount,
      refreshNavigation,
      reload,
      setFontSize,
      syncAccounts,
      withPosting,
    };
  }

  global.SocialDeckXWebViewRuntime = { createXWebViewRuntime };
})(window);
