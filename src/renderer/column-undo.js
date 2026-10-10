(function (global) {
  const DISMISS_AFTER_MS = 10_000;

  function createColumnUndo({
    capture, remove, restore, canRestore, changed = () => {},
    dismissAfterMs = DISMISS_AFTER_MS,
    setTimeoutImpl = (callback, delay) => global.setTimeout(callback, delay),
    clearTimeoutImpl = id => global.clearTimeout(id),
  }) {
    let pending = null;
    let timer = null;
    let paused = false;

    function stopTimer() {
      if (timer !== null) clearTimeoutImpl(timer);
      timer = null;
    }

    // 案内は一定時間で自動的に閉じる。ポインターやフォーカスが乗っている間は待つ
    function startTimer() {
      stopTimer();
      if (!pending || paused) return;
      timer = setTimeoutImpl(() => {
        timer = null;
        clear();
      }, dismissAfterMs);
    }

    function clear() {
      stopTimer();
      // 案内が隠れると mouseleave が届かないことがあるので、待ちもここで解く
      paused = false;
      pending = null;
      changed(null);
    }

    return {
      remove(id) {
        const snapshot = capture(id);
        const result = remove(id);
        if (result.status === 'removed' && snapshot) {
          pending = snapshot;
          changed(pending);
          startTimer();
        }
        return result;
      },
      undo() {
        if (!pending) return false;
        if (!canRestore(pending)) throw new Error('削除時のアカウントが見つかりません。アカウント設定を確認してください');
        restore(pending);
        clear();
        return true;
      },
      clear,
      pauseDismiss() {
        paused = true;
        stopTimer();
      },
      resumeDismiss() {
        paused = false;
        startTimer();
      },
    };
  }
  global.SocialDeckColumnUndo = { createColumnUndo };
})(window);
