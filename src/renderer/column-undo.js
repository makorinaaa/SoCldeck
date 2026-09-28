(function (global) {
  function createColumnUndo({ capture, remove, restore, canRestore, changed = () => {} }) {
    let pending = null;
    return {
      remove(id) {
        const snapshot = capture(id);
        const result = remove(id);
        if (result.status === 'removed' && snapshot) {
          pending = snapshot;
          changed(pending);
        }
        return result;
      },
      undo() {
        if (!pending) return false;
        if (!canRestore(pending)) throw new Error('削除時のアカウントが見つかりません。アカウント設定を確認してください');
        restore(pending);
        pending = null;
        changed(null);
        return true;
      },
      clear() { pending = null; changed(null); },
    };
  }
  global.SocialDeckColumnUndo = { createColumnUndo };
})(window);
