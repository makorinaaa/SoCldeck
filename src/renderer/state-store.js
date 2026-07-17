(function (global) {
  const STATE_KEY = 'socialdeck_v4';
  const LEGACY_STATE_KEY = 'socialdeck_v3';

  function defaultState() {
    return {
      xs: [],
      activeX: 0,
      b: null,
      composePreferences: {
        crossPostFromX: false,
        crossPostFromBluesky: false,
      },
    };
  }

  function withoutCredentials(account) {
    if (!account || typeof account !== 'object') return account || null;
    const { accessJwt, refreshJwt, ...publicAccount } = account;
    return publicAccount;
  }

  function normalizeState(value) {
    if (!value || typeof value !== 'object') return defaultState();
    return {
      ...defaultState(),
      ...value,
      xs: Array.isArray(value.xs) ? value.xs : [],
      activeX: Number.isInteger(value.activeX) ? value.activeX : 0,
      b: value.b || null,
      composePreferences: {
        ...defaultState().composePreferences,
        ...(value.composePreferences || {}),
        crossPostFromX: value.composePreferences?.crossPostFromX === true,
        crossPostFromBluesky: value.composePreferences?.crossPostFromBluesky === true,
      },
    };
  }

  function createStateStore(storage = global.localStorage) {
    return {
      load() {
        try {
          const v4 = JSON.parse(storage.getItem(STATE_KEY));
          if (v4) return normalizeState(v4);
          const v3 = JSON.parse(storage.getItem(LEGACY_STATE_KEY));
          if (v3) {
            return normalizeState({
              xs: v3.x ? [{ ...v3.x, partition: 'persist:x-0' }] : [],
              activeX: 0,
              b: v3.b || null,
            });
          }
        } catch {}
        return defaultState();
      },
      save(state) {
        const persisted = normalizeState(state);
        persisted.b = withoutCredentials(persisted.b);
        storage.setItem(STATE_KEY, JSON.stringify(persisted));
      },
    };
  }

  global.SocialDeckStateStore = {
    STATE_KEY,
    LEGACY_STATE_KEY,
    createStateStore,
    defaultState,
  };
})(window);
