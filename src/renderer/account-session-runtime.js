(function (global) {
  function createAccountSessionDomView({
    documentRef = global.document,
    escape = value => String(value ?? ''),
  } = {}) {
    const ids = [
      'login-screen', 'x-user', 'b-user', 'b-pass', 'x-status', 'b-status',
      'x-err', 'b-err', 'x-login-btn', 'b-login-btn', 'b-logout-btn', 'lenter',
      'lfoot-msg', 'nav-chips', 'sb-avs', 'amenu-items', 'amenu',
    ];
    const elements = {};
    ids.forEach(id => { elements[id] = documentRef.getElementById(id); });
    let handlers = {};

    function actionTarget(event) {
      return event.target.closest?.('[data-account-action],button') || event.target;
    }

    function onClick(event) {
      const target = actionTarget(event);
      const action = target.dataset?.accountAction || ({
        'x-login-btn': 'login-x',
        'b-login-btn': 'login-b',
        'b-logout-btn': 'logout-b',
        lenter: 'enter',
      })[target.id];
      if (action === 'login-x') {
        handlers.login?.('x', { displayName: elements['x-user']?.value || '' });
      } else if (action === 'login-b') {
        handlers.login?.('b', {
          handle: elements['b-user']?.value || '',
          password: elements['b-pass']?.value || '',
        });
      } else if (action === 'logout-x') {
        handlers.logout?.('x', Number(target.dataset.accountIndex));
      } else if (action === 'logout-b') {
        handlers.logout?.('b');
      } else if (action === 'logout-all') {
        handlers.logoutAll?.();
      } else if (action === 'open-settings') {
        handlers.openSettings?.();
      } else if (action === 'enter') {
        handlers.enter?.();
      } else if (action === 'toggle-account-menu') {
        elements.amenu?.classList.toggle('open');
      }
    }

    const eventRoots = [
      elements['login-screen'], elements.amenu, elements['sb-avs'],
    ].filter(Boolean);
    eventRoots.forEach(root => root.addEventListener('click', onClick));

    function renderXAccounts(snapshot) {
      const status = elements['x-status'];
      if (!status) return;
      if (snapshot.xAccounts.length === 0) {
        status.className = 'lsbar none';
        status.textContent = 'X account is not connected';
        return;
      }
      status.className = 'lsbar ok';
      const accounts = snapshot.xAccounts.map((account, accountIndex) => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <div style="width:24px;height:24px;border-radius:50%;background:${escape(account.bg || '')};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#000;flex-shrink:0">${escape(account.initials || '')}</div>
          <span style="flex:1;font-size:12px;color:var(--text1)">${escape(account.username || '')}</span>
          <button data-account-action="logout-x" data-account-index="${accountIndex}" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:11px;font-family:inherit">Remove</button>
        </div>`).join('');
      status.innerHTML = `<div style="width:100%"><div style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><span style="font-size:12px">${snapshot.xAccounts.length} X account(s) connected</span></div>${accounts}</div>`;
    }

    function renderBlueskyStatus(snapshot) {
      const status = elements['b-status'];
      if (snapshot.blueskyAccount) {
        if (status) {
          status.className = 'lsbar ok';
          status.innerHTML = `Connected: <span class="sname">@${escape(snapshot.blueskyAccount.handle || '')}</span>`;
        }
        if (elements['b-login-btn']) elements['b-login-btn'].style.display = 'none';
        if (elements['b-logout-btn']) elements['b-logout-btn'].style.display = 'block';
      } else {
        if (status) {
          status.className = 'lsbar none';
          status.textContent = 'Bluesky account is not connected';
        }
        if (elements['b-login-btn']) elements['b-login-btn'].style.display = 'flex';
        if (elements['b-logout-btn']) elements['b-logout-btn'].style.display = 'none';
      }
    }

    function renderNavigation(snapshot) {
      if (elements['nav-chips']) {
        elements['nav-chips'].innerHTML = [
          ...snapshot.xAccounts.map(account => `<div class="chip live"><div class="cav" style="background:${escape(account.bg || '')}">${escape(account.initials || '')}</div><div class="cdot"></div>${escape(account.username || '')}</div>`),
          ...(snapshot.blueskyAccount ? [`<div class="chip live"><div class="cav" style="background:${escape(snapshot.blueskyAccount.bg || '')}">${snapshot.blueskyAccount.avatar ? `<img src="${escape(snapshot.blueskyAccount.avatar)}">` : escape(snapshot.blueskyAccount.initials || '')}</div><div class="cdot"></div>@${escape(snapshot.blueskyAccount.handle || '')}</div>`] : []),
        ].join('');
      }
      if (elements['sb-avs']) {
        const firstX = snapshot.xAccounts[0];
        elements['sb-avs'].innerHTML = [
          ...(firstX ? [`<button class="sbav" data-account-action="toggle-account-menu" style="background:${escape(firstX.bg || '')}" title="X accounts">${escape(firstX.initials || '')}<span class="adot x"></span></button>`] : []),
          ...(snapshot.blueskyAccount ? [`<button class="sbav" data-account-action="toggle-account-menu" style="background:${escape(snapshot.blueskyAccount.bg || '')}" title="@${escape(snapshot.blueskyAccount.handle || '')}">${snapshot.blueskyAccount.avatar ? `<img src="${escape(snapshot.blueskyAccount.avatar)}">` : escape(snapshot.blueskyAccount.initials || '')}<span class="adot b"></span></button>`] : []),
        ].join('');
      }
    }

    function renderAccountMenu(snapshot) {
      if (!elements['amenu-items']) return;
      const xSection = snapshot.xAccounts.length > 0
        ? `<div style="padding:6px 13px;font-size:10px;font-weight:600;color:var(--text3)">X accounts</div>${snapshot.xAccounts.map((account, accountIndex) => `
          <div class="aitem">
            <div class="aiav" style="background:${escape(account.bg || '')}">${escape(account.initials || '')}</div>
            <div class="aiinfo"><div class="ainame">${escape(account.username || '')}</div><div class="aihandle">X WebView</div></div>
            <button data-account-action="logout-x" data-account-index="${accountIndex}" style="padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:10px;font-family:inherit">Remove</button>
          </div>`).join('')}`
        : '';
      const bluesky = snapshot.blueskyAccount;
      const bSection = bluesky
        ? `${snapshot.xAccounts.length > 0 ? '<div class="amenu-sep"></div>' : ''}<div style="padding:6px 13px;font-size:10px;font-weight:600;color:var(--text3)">Bluesky</div>
          <div class="aitem"><div class="aiav" style="background:${escape(bluesky.bg || '')};overflow:hidden;padding:0">${bluesky.avatar ? `<img src="${escape(bluesky.avatar)}">` : escape(bluesky.initials || '')}</div><div class="aiinfo"><div class="ainame">${escape(bluesky.displayName || bluesky.handle || '')}</div><div class="aihandle">@${escape(bluesky.handle || '')}</div></div><span class="aplat b">Bluesky</span></div>`
        : '';
      elements['amenu-items'].innerHTML = xSection + bSection;
    }

    function render(snapshot) {
      renderXAccounts(snapshot);
      renderBlueskyStatus(snapshot);
      renderNavigation(snapshot);
      renderAccountMenu(snapshot);
      if (elements.lenter) elements.lenter.disabled = !snapshot.canEnter || snapshot.busy;
      if (elements['lfoot-msg']) elements['lfoot-msg'].textContent = snapshot.connectedLabel;
      if (elements['x-login-btn']) elements['x-login-btn'].disabled = snapshot.busy;
      if (elements['b-login-btn']) elements['b-login-btn'].disabled = snapshot.busy;
      if (elements['x-err']) elements['x-err'].textContent = snapshot.error?.network === 'x' ? snapshot.error.message : '';
      if (elements['b-err']) elements['b-err'].textContent = snapshot.error?.network === 'b' ? snapshot.error.message : '';
    }

    return {
      clearCredentials(networkId) {
        if (networkId === 'x' && elements['x-user']) elements['x-user'].value = '';
        if (networkId === 'b') {
          if (elements['b-user']) elements['b-user'].value = '';
          if (elements['b-pass']) elements['b-pass'].value = '';
        }
      },
      connect(nextHandlers) { handlers = nextHandlers || {}; },
      dispose() {
        eventRoots.forEach(root => root.removeEventListener('click', onClick));
        handlers = {};
      },
      render,
      setSettingsOpen(open) {
        if (open) elements.amenu?.classList.remove('open');
        elements['login-screen']?.classList.toggle('hidden', !open);
      },
    };
  }

  function createAccountSessionRuntime({
    state,
    xSession = {},
    bluesky = {},
    getAvatarBackground = () => '',
    getBlueskyBackground = () => '',
    createDefaultState = () => ({ xs: [], activeX: 0, b: null, composePreferences: {} }),
    view = {},
    intents = {},
  } = {}) {
    let started = false;
    let disposed = false;
    const operation = { busy: false, error: null };

    function getSnapshot() {
      const current = state?.get?.() || {};
      const xAccounts = Array.isArray(current.xs) ? current.xs : [];
      const blueskyAccount = current.b || null;
      const connected = [
        xAccounts.length > 0 ? `X(${xAccounts.length})` : '',
        blueskyAccount ? 'Bluesky' : '',
      ].filter(Boolean);
      return {
        xAccounts,
        activeXAccountIndex: Number.isInteger(current.activeX) ? current.activeX : 0,
        blueskyAccount,
        canEnter: connected.length > 0,
        connectedLabel: connected.length > 0
          ? `${connected.join(' + ')} connected`
          : 'Add an account to continue',
        busy: operation.busy,
        error: operation.error,
      };
    }

    function refresh() {
      const snapshot = getSnapshot();
      view.render?.(snapshot);
      return snapshot;
    }

    function nextXPartition(accounts) {
      const used = new Set(accounts.map(account => account.partition).filter(Boolean));
      for (let index = 0; index < 100; index++) {
        const partition = `persist:x-${index}`;
        if (!used.has(partition)) return partition;
      }
      return `persist:x-${Date.now()}`;
    }

    function blockedMutation() {
      if (disposed) return { status: 'ignored', detail: 'disposed' };
      if (operation.busy) return { status: 'ignored', detail: 'busy' };
      return null;
    }

    async function login(networkId, credentials = {}) {
      const blocked = blockedMutation();
      if (blocked) return blocked;
      if (networkId === 'b') return loginBluesky(credentials);
      if (networkId !== 'x') return { status: 'ignored', detail: 'unsupported-network' };
      const current = state.get();
      const accounts = Array.isArray(current.xs) ? current.xs : [];
      const clean = String(credentials.displayName || '').trim().replace(/^@/, '');
      if (!clean) {
        operation.error = { network: 'x', message: 'Enter a display name' };
        refresh();
        return { status: 'rejected', reason: 'display-name-required' };
      }
      const username = `@${clean}`;
      if (accounts.some(account => account.username === username)) {
        operation.error = { network: 'x', message: 'This account is already registered' };
        refresh();
        return { status: 'rejected', reason: 'duplicate-account' };
      }
      operation.busy = true;
      operation.error = null;
      refresh();
      try {
        const partition = nextXPartition(accounts);
        const account = {
          username,
          initials: clean.slice(0, 2).toUpperCase(),
          bg: getAvatarBackground(accounts.length),
          partition,
          loginPending: true,
        };
        try {
          await xSession.initializeTheme?.(partition);
        } catch {}
        state.commit({
          ...current,
          xs: [...accounts, account],
          activeX: accounts.length,
        });
        await xSession.sync?.([...accounts, account]);
        view.clearCredentials?.('x');
        await intents.accountsChanged?.({ network: 'x', kind: 'login', account });
        return { status: 'authenticated', account, snapshot: getSnapshot() };
      } finally {
        operation.busy = false;
        refresh();
      }
    }

    async function loginBluesky(credentials) {
      const handle = String(credentials.handle || '').trim();
      const password = String(credentials.password || '').trim();
      if (!handle || !password) {
        operation.error = { network: 'b', message: 'Enter handle and app password' };
        refresh();
        return { status: 'rejected', reason: 'credentials-required' };
      }
      operation.busy = true;
      operation.error = null;
      refresh();
      try {
        const session = await bluesky.login?.(handle, password);
        const account = {
          handle: session.handle,
          did: session.did,
          accessJwt: session.accessJwt,
          refreshJwt: session.refreshJwt,
          displayName: session.handle,
          avatar: null,
          initials: session.handle.slice(0, 2).toUpperCase(),
          bg: getBlueskyBackground(session.handle),
        };
        try {
          const profile = await bluesky.getProfile?.(session.accessJwt, session.did);
          account.avatar = profile?.avatar || null;
          account.displayName = profile?.displayName || session.handle;
        } catch {}
        const current = state.get();
        state.commit({ ...current, b: account });
        view.clearCredentials?.('b');
        await intents.accountsChanged?.({ network: 'b', kind: 'login', account });
        return { status: 'authenticated', account, snapshot: getSnapshot() };
      } catch (error) {
        operation.error = { network: 'b', message: error?.message || 'Login failed' };
        return { status: 'failed', error, snapshot: getSnapshot() };
      } finally {
        operation.busy = false;
        refresh();
      }
    }

    async function logout(networkId, accountIndex = 0) {
      const blocked = blockedMutation();
      if (blocked) return blocked;
      if (networkId === 'b') {
        const current = state.get();
        if (!current.b) return { status: 'ignored', detail: 'account-not-found' };
        const account = current.b;
        operation.busy = true;
        operation.error = null;
        refresh();
        try {
          state.commit({ ...current, b: null });
          await intents.accountsChanged?.({ network: 'b', kind: 'logout', account });
          return { status: 'logged-out', account, snapshot: getSnapshot() };
        } finally {
          operation.busy = false;
          refresh();
        }
      }
      if (networkId !== 'x') return { status: 'ignored', detail: 'unsupported-network' };
      const current = state.get();
      const accounts = Array.isArray(current.xs) ? current.xs : [];
      const index = Number(accountIndex);
      const account = accounts[index];
      if (!account) return { status: 'ignored', detail: 'account-not-found' };
      const confirmed = await intents.confirmLogout?.(account);
      if (!confirmed) return { status: 'cancelled' };
      operation.busy = true;
      operation.error = null;
      refresh();
      try {
        await xSession.clear?.(account.partition || `persist:x-${index}`);
        const nextAccounts = accounts.filter((_, accountIndexValue) => accountIndexValue !== index);
        const previousActiveX = Number.isInteger(current.activeX) ? current.activeX : 0;
        const activeX = index < previousActiveX
          ? previousActiveX - 1
          : Math.min(previousActiveX, Math.max(0, nextAccounts.length - 1));
        state.commit({ ...current, xs: nextAccounts, activeX });
        await xSession.sync?.(nextAccounts);
        await intents.accountsChanged?.({ network: 'x', kind: 'logout', account });
        return { status: 'logged-out', account, snapshot: getSnapshot() };
      } finally {
        operation.busy = false;
        refresh();
      }
    }

    async function logoutAll() {
      const blocked = blockedMutation();
      if (blocked) return blocked;
      const confirmed = await intents.confirmLogoutAll?.();
      if (!confirmed) return { status: 'cancelled' };
      operation.busy = true;
      operation.error = null;
      refresh();
      try {
        await xSession.clearAll?.();
        const current = state.get();
        state.commit({
          ...createDefaultState(),
          composePreferences: current.composePreferences,
        });
        await xSession.sync?.([]);
        await intents.workspaceResetRequested?.();
        await intents.accountsChanged?.({ network: 'all', kind: 'logout' });
        return { status: 'logged-out', snapshot: getSnapshot() };
      } finally {
        operation.busy = false;
        refresh();
      }
    }

    async function start() {
      if (disposed) return { status: 'ignored', detail: 'disposed' };
      if (!started) {
        started = true;
        view.connect?.({ enter, login, logout, logoutAll, openSettings });
      }
      const snapshot = refresh();
      await xSession.sync?.(snapshot.xAccounts);
      return snapshot;
    }

    function openSettings() {
      if (disposed) return { status: 'ignored', detail: 'disposed' };
      view.setSettingsOpen?.(true);
      refresh();
      return { status: 'opened' };
    }

    async function enter() {
      if (disposed) return { status: 'ignored', detail: 'disposed' };
      view.setSettingsOpen?.(false);
      await intents.enterRequested?.();
      return { status: 'entered' };
    }

    function dispose() {
      if (disposed) return { status: 'disposed' };
      disposed = true;
      view.dispose?.();
      view.connect?.(null);
      return { status: 'disposed' };
    }

    return {
      dispose,
      getSnapshot,
      login,
      logout,
      logoutAll,
      openSettings,
      refresh,
      start,
    };
  }

  global.SocialDeckAccountSessionRuntime = {
    createAccountSessionDomView,
    createAccountSessionRuntime,
  };
})(window);
