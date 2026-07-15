(function (global) {
  function isXLoginUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.replace(/^www\./, '');
      if (!['x.com', 'twitter.com'].includes(host)) return false;
      return /^\/(?:i\/flow\/|login(?:\/|$)|account\/access(?:\/|$))/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function isXAppUrl(value) {
    try {
      const host = new URL(value).hostname.replace(/^www\./, '');
      return ['x.com', 'twitter.com'].includes(host) && !isXLoginUrl(value);
    } catch {
      return false;
    }
  }

  function createXLoginGate() {
    const states = new Map();

    function register(partition, webviewId, loginPending) {
      if (!loginPending) return false;
      let state = states.get(partition);
      if (!state) {
        state = { ownerId: webviewId, parkedIds: [], sawLogin: false };
        states.set(partition, state);
        return false;
      }
      if (!state.parkedIds.includes(webviewId)) state.parkedIds.push(webviewId);
      return state.ownerId !== webviewId;
    }

    function observe(partition, webviewId, url) {
      const state = states.get(partition);
      if (!state || state.ownerId !== webviewId) return [];
      if (isXLoginUrl(url)) {
        state.sawLogin = true;
        return [];
      }
      if (!state.sawLogin || !isXAppUrl(url)) return [];
      states.delete(partition);
      return state.parkedIds.slice();
    }

    function unregister(partition, webviewId) {
      const state = states.get(partition);
      if (!state) return [];
      if (state.ownerId === webviewId) {
        states.delete(partition);
        return state.parkedIds.slice();
      }
      state.parkedIds = state.parkedIds.filter(id => id !== webviewId);
      return [];
    }

    return {
      clear: () => states.clear(),
      isActive: partition => states.has(partition),
      observe,
      register,
      unregister,
    };
  }

  global.SocialDeckXLoginGate = { createXLoginGate, isXLoginUrl };
})(window);
