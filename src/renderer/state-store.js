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
      appearance: {
        theme: 'dark',
        accent: '#4e9af0',
        density: 'standard',
      },
    };
  }

  function normalizeAppearance(value) {
    const theme = value?.theme === 'light' ? 'light' : 'dark';
    const accent = /^#[0-9a-f]{6}$/i.test(String(value?.accent || ''))
      ? String(value.accent).toLowerCase()
      : '#4e9af0';
    const density = ['compact', 'standard', 'comfortable'].includes(value?.density) ? value.density : 'standard';
    return { theme, accent, density };
  }

  function withoutCredentials(account) {
    if (!account || typeof account !== 'object') return account || null;
    const { accessJwt, refreshJwt, ...publicAccount } = account;
    return publicAccount;
  }

  function normalizeState(value) {
    if (!value || typeof value !== 'object') return defaultState();
    // 複数アカウント対応前は X アカウントを1つだけ `x` に保存していた
    const { x: legacyXAccount, ...current } = value;
    const xs = Array.isArray(current.xs) ? current.xs : [];
    const migrated = xs.length === 0 && Boolean(legacyXAccount);
    return {
      ...defaultState(),
      ...current,
      xs: migrated ? [{ ...legacyXAccount, partition: 'persist:x-0' }] : xs,
      activeX: !migrated && Number.isInteger(current.activeX) ? current.activeX : 0,
      b: current.b || null,
      appearance: normalizeAppearance(value.appearance),
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
          if (v3) return normalizeState({ x: v3.x, b: v3.b });
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
