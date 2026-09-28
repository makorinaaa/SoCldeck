(function (global) {
  const CHECKS = {
    socialdeck_v4: value => value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.xs),
    socialdeck_cols: value => Array.isArray(value) && value.every(column => column && typeof column === 'object' && typeof column.id === 'string'),
  };
  function createWorkspaceStorage({ storage = global.localStorage, onRecovery = () => {} } = {}) {
    function publicCopy(key, text) {
      if (key !== 'socialdeck_v4') return text;
      const value = JSON.parse(text);
      if (value.b && typeof value.b === 'object') {
        const { accessJwt, refreshJwt, password, appPassword, ...account } = value.b;
        value.b = account;
      }
      return JSON.stringify(value);
    }
    function valid(key, text) {
      if (text === null) return false;
      try { return CHECKS[key](JSON.parse(text)); } catch { return false; }
    }
    return {
      getItem(key) {
        const text = storage.getItem(key);
        if (!CHECKS[key] || text === null || valid(key, text)) return text;
        const previous = storage.getItem(`${key}.last-good`);
        // Preserve the unreadable source even when no recovery copy exists.
        storage.setItem(`${key}.corrupt`, text);
        if (!valid(key, previous)) {
          onRecovery('保存データを読み込めませんでした。元のデータを退避しました。バックアップから復元できます。');
          return text;
        }
        storage.setItem(key, previous);
        onRecovery('保存データの破損を検出し、直前の正常な状態に復旧しました。');
        return previous;
      },
      setItem(key, text) {
        if (CHECKS[key]) {
          if (!valid(key, text)) throw new Error('保存データの形式が不正です');
          const old = storage.getItem(key);
          if (valid(key, old)) storage.setItem(`${key}.last-good`, publicCopy(key, old));
          else if (!valid(key, storage.getItem(`${key}.last-good`))) storage.setItem(`${key}.last-good`, publicCopy(key, text));
        }
        storage.setItem(key, text);
      },
      removeItem: key => storage.removeItem(key),
    };
  }
  global.SocialDeckWorkspaceStorage = { createWorkspaceStorage };
})(window);
