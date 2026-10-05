(function (global) {
  // These functions are serialized into the X status page, so they must stay
  // self-contained (no references to outer variables).

  function findStatusArticle(documentLike, statusId) {
    return Array.from(documentLike.querySelectorAll('article[data-testid="tweet"]')).find(article => (
      Array.from(article.querySelectorAll('a[href*="/status/"]')).some(link => {
        if (!link.querySelector('time')) return false;
        try {
          return new URL(link.getAttribute('href'), 'https://x.com').pathname.split('/')[3] === statusId;
        } catch {
          return false;
        }
      })
    )) || null;
  }

  async function waitForStatus({ documentLike, statusId, find, schedule, timeoutMs = 12000, intervalMs = 100 }) {
    for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
      if (/\/i\/flow\/login|\/login(?:[/?#]|$)/.test(documentLike.location?.pathname || '')) return 'login';
      if (find(documentLike, statusId)) return 'ready';
      await new Promise(resolve => schedule(resolve, intervalMs));
    }
    return 'missing';
  }

  // Clicks X's own Like or Repost control on the focal post and waits for X to confirm it.
  async function toggleStatusReaction({ documentLike, statusId, action, active, find, schedule }) {
    const wait = ms => new Promise(resolve => schedule(resolve, ms));
    const ids = action === 'like'
      ? { on: 'unlike', off: 'like' }
      : { on: 'unretweet', off: 'retweet' };
    const isActive = article => Boolean(article?.querySelector(`[data-testid="${ids.on}"]`));
    const article = find(documentLike, statusId);
    if (!article) return 'missing';
    if (isActive(article) === active) return 'already';
    const button = article.querySelector(`[data-testid="${active ? ids.off : ids.on}"]`);
    if (!button) return 'missing';
    button.click();
    if (action === 'repost') {
      const confirmId = active ? 'retweetConfirm' : 'unretweetConfirm';
      let confirm = null;
      for (let check = 0; check < 20 && !confirm; check += 1) {
        await wait(100);
        confirm = documentLike.querySelector(`[data-testid="${confirmId}"]`);
      }
      if (!confirm) return 'missing';
      confirm.click();
    }
    for (let check = 0; check < 60; check += 1) {
      await wait(75);
      const current = find(documentLike, statusId);
      if (current && isActive(current) === active) return 'done';
    }
    return 'unconfirmed';
  }

  // Opens X's own reply composer by pressing the post's Reply button (a dialog in X's
  // desktop layout). It is usable once one textarea shares a scope with X's toolbar and
  // Reply button, which is what the compose scripts operate on.
  async function openReplyComposer({ documentLike, statusId, find, schedule }) {
    const wait = ms => new Promise(resolve => schedule(resolve, ms));
    const boxes = () => Array.from(documentLike.querySelectorAll('[data-testid="tweetTextarea_0"]'));
    const isUsable = box => {
      for (let scope = box.parentElement; scope && scope !== documentLike.body; scope = scope.parentElement) {
        if (scope.querySelector('[data-testid="toolBar"]')) {
          // The submit script looks for the Reply button in this same scope.
          return scope.querySelectorAll('[data-testid="tweetTextarea_0"]').length === 1
            && Boolean(scope.querySelector('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]'));
        }
      }
      return false;
    };
    const summary = status => ({ status, boxes: boxes().length });
    let box = null;
    const article = find(documentLike, statusId);
    const replyButton = article?.querySelector('[data-testid="reply"]');
    if (!replyButton) return summary(article ? 'reply-button-missing' : 'post-missing');
    replyButton.click();
    for (let check = 0; check < 40 && !box; check += 1) {
      await wait(200);
      box = boxes().find(isUsable) || null;
    }
    if (!box) return summary('composer-missing');
    // Compose scripts take the first X textarea in the page: retire any other reply box.
    boxes().forEach(other => {
      if (other !== box) other.setAttribute('data-testid', 'sd-inactive-tweetTextarea');
    });
    return summary('ready');
  }

  // After a notification cell is clicked, X's app navigates to the post it is about. A
  // grouped notification ("liked 2 of your posts") opens a list instead: its first post
  // is the most recent one.
  async function waitForStatusPath({ documentLike = null, locationLike, schedule, timeoutMs = 8000, intervalMs = 100 }) {
    const firstListedPost = () => {
      for (const article of Array.from(documentLike?.querySelectorAll?.('article[data-testid="tweet"]') || [])) {
        for (const link of Array.from(article.querySelectorAll('a[href*="/status/"]'))) {
          if (!link.querySelector('time')) continue;
          const match = /^\/([^/]+)\/status\/(\d+)/.exec(link.getAttribute('href') || '');
          if (match) return { handle: match[1], id: match[2] };
        }
      }
      return null;
    };
    for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
      const path = locationLike.pathname || '';
      const match = /^\/([^/]+)\/status\/(\d+)/.exec(path);
      if (match) return { handle: match[1], id: match[2] };
      if (path !== '/notifications') {
        const listed = firstListedPost();
        if (listed) return listed;
      }
      await new Promise(resolve => schedule(resolve, intervalMs));
    }
    return null;
  }

  // Deletes the focal post through X's own menu: More → Delete → confirm. X only offers
  // Delete on the signed-in account's posts, so other posts stop at 'delete-missing'.
  async function deleteStatus({ documentLike, statusId, find, schedule }) {
    const wait = ms => new Promise(resolve => schedule(resolve, ms));
    const waitFor = async (lookup, checks = 30) => {
      for (let check = 0; check < checks; check += 1) {
        const found = lookup();
        if (found) return found;
        await wait(100);
      }
      return null;
    };
    const closeMenu = () => {
      if (typeof KeyboardEvent === 'function') {
        documentLike.dispatchEvent?.(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    };
    if (!find(documentLike, statusId)) return 'missing';
    // On a freshly loaded page X loads its menu code on first use, and a click that lands
    // before the page is interactive does nothing: click again until the menu opens.
    const menuItems = () => Array.from(documentLike.querySelectorAll('[role="menuitem"]'));
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
      const caret = find(documentLike, statusId)?.querySelector('[data-testid="caret"]');
      if (!caret) {
        await wait(300);
        continue;
      }
      caret.click();
      opened = Boolean(await waitFor(() => menuItems().length > 0, 25));
    }
    if (!opened) return 'menu-missing';
    const item = await waitFor(() => menuItems()
      .find(element => /^(?:削除|Delete)$/.test(String(element.innerText || element.textContent || '').trim())), 50);
    if (!item) {
      closeMenu();
      return 'delete-missing';
    }
    item.click();
    const confirm = await waitFor(() => documentLike.querySelector('[data-testid="confirmationSheetConfirm"]'), 80);
    if (!confirm) return 'confirm-missing';
    confirm.click();
    return await waitFor(() => !find(documentLike, statusId), 60) ? 'done' : 'unconfirmed';
  }

  // Moves X's single-page app to a status without a full page load.
  function navigateToStatus(windowLike, path) {
    if (windowLike.location.pathname === path) return 'same';
    windowLike.history.pushState({}, '', path);
    windowLike.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    return 'pushed';
  }

  function statusPath(target) {
    try {
      const url = new URL(target.url);
      if (!['x.com', 'twitter.com'].includes(url.hostname)) return null;
      const [, handle, kind, id] = url.pathname.split('/');
      if (!handle || kind !== 'status' || id !== String(target.id) || !/^\d+$/.test(id)) return null;
      return `/${handle}/status/${id}`;
    } catch {
      return null;
    }
  }

  function createNavigateScript(path) {
    return `(${navigateToStatus.toString()})(window, ${JSON.stringify(path)})`;
  }

  function createWaitForStatusPathScript() {
    return `(${waitForStatusPath.toString()})({ documentLike: document, locationLike: location, schedule: setTimeout })`;
  }

  function createWaitScript(statusId) {
    return `(${waitForStatus.toString()})({
      documentLike: document,
      statusId: ${JSON.stringify(String(statusId))},
      find: ${findStatusArticle.toString()},
      schedule: setTimeout
    })`;
  }

  function createOpenReplyScript(statusId) {
    return `(${openReplyComposer.toString()})({
      documentLike: document,
      statusId: ${JSON.stringify(String(statusId))},
      find: ${findStatusArticle.toString()},
      schedule: setTimeout
    })`;
  }

  function createDeleteScript(statusId) {
    return `(${deleteStatus.toString()})({
      documentLike: document,
      statusId: ${JSON.stringify(String(statusId))},
      find: ${findStatusArticle.toString()},
      schedule: setTimeout
    })`;
  }

  function createToggleScript({ statusId, action, active }) {
    if (!['like', 'repost'].includes(action)) throw new Error('Unsupported X reaction');
    return `(${toggleStatusReaction.toString()})({
      documentLike: document,
      statusId: ${JSON.stringify(String(statusId))},
      action: ${JSON.stringify(action)},
      active: ${JSON.stringify(Boolean(active))},
      find: ${findStatusArticle.toString()},
      schedule: setTimeout
    })`;
  }

  global.SocialDeckXStatusActions = {
    createDeleteScript,
    deleteStatus,
    createNavigateScript,
    createOpenReplyScript,
    createToggleScript,
    createWaitForStatusPathScript,
    createWaitScript,
    findStatusArticle,
    navigateToStatus,
    openReplyComposer,
    statusPath,
    toggleStatusReaction,
    waitForStatus,
    waitForStatusPath,
  };
})(window);
