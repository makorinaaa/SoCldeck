(function (global) {
  const LIMIT = 1024 * 1024;
  const RECOVERY_KEY = 'socialdeck_backup_recovery_v1';
  const STATE_KEY = 'socialdeck_v4';
  const LAYOUT_KEY = 'socialdeck_cols';
  function fail() { throw new Error('バックアップの形式または値が不正です'); }
  // x-accounts.mjs と同じ規則（このファイルは ES モジュールを読み込めない）
  function xPartitionOf(account, index) {
    return account?.partition || `persist:x-${index}`;
  }
  function string(value, max = 2000) {
    if (typeof value !== 'string' || value.length > max) fail();
    return value;
  }
  function list(value) {
    if (!Array.isArray(value) || value.length > 1000) fail();
    return value.map(item => string(item));
  }
  function normalize(value) {
    if (value?.format !== 'socialdeck-workspace' || value.version !== 1) fail();
    const appearance = value.appearance;
    if (!['dark', 'light'].includes(appearance?.theme)
      || !['compact', 'standard', 'comfortable'].includes(appearance.density)
      || !/^#[a-f0-9]{6}$/i.test(appearance.accent)) fail();
    if (!Array.isArray(value.columns) || value.columns.length > 100) fail();
    const ids = new Set();
    const columns = value.columns.map(column => {
      const id = string(column.id, 100);
      if (!/^[\w-]+$/.test(id) || ids.has(id)) fail();
      ids.add(id);
      if (!['wv', 'bsky', 'schedule'].includes(column.kind)) fail();
      if (!['x', 'b', 'anime'].includes(column.network)) fail();
      if ((column.network === 'x' && column.kind !== 'wv')
        || (column.network === 'anime' && column.kind !== 'schedule')
        || (column.network === 'b' && column.kind === 'schedule')) fail();
      if (!Number.isInteger(column.interval) || column.interval < 0 || column.interval > 86400000) fail();
      if (column.interval > 0 && column.interval < 1000) fail();
      if (column.width && !/^\d{2,4}(\.\d+)?px$/.test(column.width)) fail();
      const result = {
        id, kind: column.kind, network: column.network,
        definitionId: string(column.definitionId, 100), title: string(column.title),
        sub: string(column.sub), width: string(column.width), interval: column.interval,
        collapsed: column.collapsed === true,
      };
      if (column.kind === 'wv') {
        const url = new URL(string(column.url, 4000));
        const hosts = column.network === 'x' ? ['x.com', 'twitter.com'] : ['bsky.app'];
        if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password) fail();
        result.url = url.href;
        result.account = string(column.account, 512);
      }
      if (column.network === 'b') result.account = string(column.account, 512);
      if (column.kind === 'bsky') {
        result.type = string(column.type, 100);
        result.feedUri = string(column.feedUri || '', 1000);
      }
      if (column.fontSize !== undefined) {
        if (!Number.isInteger(column.fontSize) || column.fontSize < 8 || column.fontSize > 32) fail();
        result.fontSize = column.fontSize;
      }
      return result;
    });
    let notifications;
    if (value.notifications !== undefined) {
      const rules = value.notifications;
      if (!rules || typeof rules !== 'object') fail();
      notifications = {
        enabled: rules.enabled === true, onlyWhenUnfocused: rules.onlyWhenUnfocused !== false,
        networks: { x: rules.networks?.x !== false, b: rules.networks?.b !== false },
        reasons: Object.fromEntries(['reply', 'mention', 'quote', 'follow', 'like', 'repost', 'other']
          .map(reason => [reason, rules.reasons?.[reason] === true])),
        users: list(rules.users), keywords: list(rules.keywords),
      };
    }
    if (value.memoryInterval !== undefined
      && (!Number.isInteger(value.memoryInterval) || value.memoryInterval < 0 || value.memoryInterval > 86400000
        || (value.memoryInterval > 0 && value.memoryInterval < 1000))) fail();
    return {
      format: 'socialdeck-workspace', version: 1, createdAt: string(value.createdAt, 64),
      appearance: { theme: appearance.theme, accent: appearance.accent, density: appearance.density },
      composePreferences: {
        crossPostFromX: value.composePreferences?.crossPostFromX === true,
        crossPostFromBluesky: value.composePreferences?.crossPostFromBluesky === true,
      },
      mute: { words: list(value.mute?.words), users: list(value.mute?.users) }, columns,
      ...(notifications ? { notifications } : {}),
      ...(value.memoryInterval !== undefined ? { memoryInterval: value.memoryInterval } : {}),
    };
  }

  function parse(text) {
    if (typeof text !== 'string' || text.length > LIMIT) fail();
    return normalize(JSON.parse(text));
  }

  function createWorkspaceBackup({ storage = global.localStorage, getState, resolveDefinition, getNotificationRules, getMemoryInterval }) {
    function capture() {
      const state = getState();
      const layout = JSON.parse(storage.getItem(LAYOUT_KEY) || '[]');
      return normalize({
        format: 'socialdeck-workspace', version: 1, createdAt: new Date().toISOString(),
        appearance: { density: 'standard', ...state.appearance },
        composePreferences: state.composePreferences,
        mute: JSON.parse(storage.getItem('socialdeck_ng') || '{"words":[],"users":[]}'),
        ...(getNotificationRules ? { notifications: getNotificationRules() } : {}),
        ...(getMemoryInterval ? { memoryInterval: getMemoryInterval() } : {}),
        columns: layout.map(column => {
          const definition = resolveDefinition(column);
          if (!definition) throw new Error('復元できないカラムがあります。カラム設定を確認してください');
          const network = definition.network;
          const font = storage.getItem(`col_fs_${column.id}`);
          const account = network === 'x'
            ? state.xs.find((item, index) => xPartitionOf(item, index) === column.partition)?.username
            : network === 'b' ? state.b?.did : undefined;
          return { ...column, network, definitionId: definition.id, account,
            ...(font !== null ? { fontSize: Number(font) } : {}) };
        }),
      });
    }

    function prepare(text) {
      const backup = parse(text);
      const state = getState();
      const columns = backup.columns.map(column => {
        const restored = { ...column };
        if (column.network === 'x') {
          const matches = state.xs.filter(item => item.username === column.account);
          if (matches.length !== 1) throw new Error(`X のアカウント ${column.account} を一意に確認できません。アカウント設定を確認してください`);
          restored.partition = xPartitionOf(matches[0], state.xs.indexOf(matches[0]));
        }
        if (column.network === 'b') {
          if (state.b?.did !== column.account) throw new Error('バックアップと同じ Bluesky アカウントでログインしてください');
          if (column.kind === 'wv') restored.partition = 'persist:bsky';
        }
        const definition = resolveDefinition(restored);
        if (!definition || definition.id !== column.definitionId || definition.network !== column.network) {
          throw new Error('このバージョンでは復元できないカラムが含まれています');
        }
        delete restored.account;
        delete restored.fontSize;
        return restored;
      });
      return { backup, columns };
    }

    function checkpoint() {
      storage.setItem(RECOVERY_KEY, JSON.stringify(capture()));
    }

    function restore(text) {
      const { backup, columns } = prepare(text);
      // The recovery copy must be saved successfully before replacing anything.
      checkpoint();
      const state = getState();
      const publicState = { ...state, appearance: backup.appearance, composePreferences: backup.composePreferences };
      if (publicState.b) {
        const { accessJwt, refreshJwt, appPassword, password, ...account } = publicState.b;
        publicState.b = account;
      }
      const writes = new Map([
        [STATE_KEY, JSON.stringify(publicState)], [LAYOUT_KEY, JSON.stringify(columns)],
        ['socialdeck_ng', JSON.stringify(backup.mute)],
      ]);
      // Notification history is intentionally omitted so polling establishes a fresh baseline.
      if (backup.notifications) writes.set('socialdeck_desktop_notification_rules', JSON.stringify({ rules: backup.notifications }));
      if (backup.memoryInterval !== undefined) writes.set('socialdeck_mem_interval', String(backup.memoryInterval));
      backup.columns.forEach(column => writes.set(`col_fs_${column.id}`, column.fontSize === undefined ? null : String(column.fontSize)));
      const previous = new Map([...writes.keys(), `${STATE_KEY}.last-good`, `${LAYOUT_KEY}.last-good`]
        .map(key => [key, storage.getItem(key)]));
      try {
        writes.forEach((value, key) => value === null ? storage.removeItem(key) : storage.setItem(key, value));
      } catch (error) {
        previous.forEach((value, key) => value === null ? storage.removeItem(key) : storage.setItem(key, value));
        throw error;
      }
      return backup;
    }

    return {
      exportText: () => JSON.stringify(capture(), null, 2), prepare, restore, checkpoint,
      recoveryText: () => storage.getItem(RECOVERY_KEY),
    };
  }
  global.SocialDeckWorkspaceBackup = { createWorkspaceBackup, parse, LIMIT, RECOVERY_KEY };
})(window);
