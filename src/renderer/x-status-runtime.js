(function (global) {
  // Owns one hidden X WebView per account for status pages. Opening a post, liking,
  // reposting and replying all happen there through X's own page, one at a time.
  function createXStatusRuntime({
    documentRef = global.document,
    getHost = () => documentRef.getElementById('x-status-readers'),
    getPreloadPath = () => '',
    tap,
    scripts = global.SocialDeckXStatusActions,
    idleMs = 3 * 60 * 1000,
    setTimeoutFn = (...args) => global.setTimeout?.(...args),
    clearTimeoutFn = (...args) => global.clearTimeout?.(...args),
  } = {}) {
    if (!tap?.attach) throw new Error('X status runtime requires a timeline tap');
    const views = new Map();

    function createView(partition) {
      const host = getHost();
      if (!host) throw new Error('X の操作用ビューを作成できませんでした');
      const webview = documentRef.createElement('webview');
      webview.id = `x-status-reader-${partition.replace(/[^a-z0-9-]/gi, '_')}`;
      webview.setAttribute('partition', partition);
      webview.setAttribute('webpreferences', 'backgroundThrottling=false');
      const preloadPath = getPreloadPath();
      if (preloadPath) webview.setAttribute('preload', preloadPath);
      const view = { partition, webview, webContentsId: null, loaded: false, chain: Promise.resolve(), pending: 0, idleTimer: null };
      view.ready = new Promise((resolve, reject) => {
        webview.addEventListener('dom-ready', async () => {
          if (view.webContentsId !== null) return;
          view.webContentsId = webview.getWebContentsId();
          const attached = await tap.attach(view.webContentsId).catch(() => false);
          if (attached) resolve();
          else reject(new Error('X の操作用ビューを準備できませんでした'));
        });
      });
      view.ready.catch(() => {});
      webview.src = 'about:blank';
      host.appendChild(webview);
      views.set(partition, view);
      return view;
    }

    async function showStatus(view, target, { reload = false } = {}) {
      const path = scripts.statusPath(target);
      if (!path) throw new Error('ポストのURLが正しくありません');
      await view.ready;
      if (view.loaded && !reload) {
        await view.webview.executeJavaScript(scripts.createNavigateScript(path)).catch(() => null);
        if (await view.webview.executeJavaScript(scripts.createWaitScript(target.id)).catch(() => 'missing') === 'ready') return;
      }
      await view.webview.loadURL(`https://x.com${path}`).catch(() => {});
      view.loaded = true;
      const state = await view.webview.executeJavaScript(scripts.createWaitScript(target.id)).catch(() => 'missing');
      if (state === 'login') throw Object.assign(new Error('X へのログインが必要です'), { code: 'X_LOGIN_REQUIRED' });
      if (state !== 'ready') throw new Error('X でポストを開けませんでした');
    }

    function scheduleIdle(view) {
      clearTimeoutFn(view.idleTimer);
      view.idleTimer = setTimeoutFn(() => {
        if (view.pending === 0 && views.get(view.partition) === view) dispose(view.partition);
      }, idleMs);
    }

    // Starts the status page early (for example when a post is pressed) so opening it is faster.
    function prewarm(partition) {
      if (views.has(partition)) return false;
      try {
        scheduleIdle(createView(partition));
        return true;
      } catch {
        return false;
      }
    }

    // A desktop-width X page costs a few hundred MB: release it when nothing used it for a while.
    function enqueue(partition, work) {
      const view = views.get(partition) || createView(partition);
      clearTimeoutFn(view.idleTimer);
      view.pending += 1;
      const next = view.chain.then(() => work(view));
      view.chain = next.catch(() => {}).then(() => {
        view.pending -= 1;
        if (view.pending === 0 && views.get(partition) === view) scheduleIdle(view);
      });
      return next;
    }

    // Tasks for one account run in order so they never fight over the same page.
    function run(partition, target, task = async () => {}, options = {}) {
      return enqueue(partition, async view => {
        await showStatus(view, target, options);
        return task(view.webview);
      });
    }

    // Follows a notification on X's own notification page to the post it is about.
    function resolveNotification(partition, activationScript) {
      return enqueue(partition, view => followNotification(view, activationScript));
    }

    async function followNotification(view, activationScript) {
      const openNotifications = async reload => {
        const navigated = view.loaded && !reload
          // In-app navigation: X only fetches the notifications, not the whole page.
          ? await view.webview.executeJavaScript(scripts.createNavigateScript('/notifications')).catch(() => null)
          : null;
        // Already on the list ('same') means it may be stale: load it fresh instead.
        if (navigated !== 'pushed') {
          await view.webview.loadURL('https://x.com/notifications').catch(() => {});
          view.loaded = true;
        }
        return view.webview.executeJavaScript(activationScript).catch(() => false);
      };
      await view.ready;
      const clicked = await openNotifications(false) || (view.loaded && await openNotifications(true));
      if (!clicked) return null;
      const found = await view.webview.executeJavaScript(scripts.createWaitForStatusPathScript()).catch(() => null);
      return found?.id ? { id: String(found.id), url: `https://x.com/${found.handle}/status/${found.id}`, handle: found.handle } : null;
    }

    function toggle(partition, target, action, active) {
      return run(partition, target, webview => webview.executeJavaScript(
        scripts.createToggleScript({ statusId: target.id, action, active }),
      ));
    }

    function remove(partition, target) {
      return run(partition, target, webview => webview.executeJavaScript(scripts.createDeleteScript(target.id)));
    }

    function partitionOf(webContentsId) {
      for (const view of views.values()) {
        if (view.webContentsId === webContentsId) return view.partition;
      }
      return null;
    }

    function dispose(partition) {
      const view = views.get(partition);
      if (!view) return;
      views.delete(partition);
      clearTimeoutFn(view.idleTimer);
      if (view.webContentsId !== null) tap.detach?.(view.webContentsId)?.catch?.(() => {});
      view.webview.remove();
    }

    // Memory cleanup releases idle status pages right away.
    function disposeAll() {
      let disposed = 0;
      [...views.values()].forEach(view => {
        if (view.pending > 0) return;
        dispose(view.partition);
        disposed += 1;
      });
      return disposed;
    }

    return {
      count: () => views.size,
      dispose,
      disposeAll,
      partitionOf,
      prewarm,
      remove,
      resolveNotification,
      run,
      toggle,
    };
  }

  global.SocialDeckXStatusRuntime = { createXStatusRuntime };
})(window);
