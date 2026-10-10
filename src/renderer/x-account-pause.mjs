// X がアカウントの制限や本人確認を求めたときに、そのアカウントの X の自動操作を止めておく。
// 制限中に自動更新やボタン操作を続けると制限が重くなるおそれがあるので、利用者が X で確認して
// 「再開」を押すまで止めたままにする（再起動しても止めたまま）。
const STORAGE_KEY = 'socialdeck_x_paused';
const REASONS = {
  locked: 'X でアカウントのロック・本人確認が表示されました',
  'rate-limit': 'X の回数制限（429）が返されました',
  'post-limit': 'X で投稿の上限・制限が表示されました',
};

function describeXPauseReason(reason) {
  return REASONS[reason] || 'X で制限が表示されました';
}

function createXAccountPause({ storage, now = Date.now }) {
  let paused = {};
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      Object.entries(saved).forEach(([partition, entry]) => {
        if (partition && entry && REASONS[entry.reason]) {
          paused[partition] = { reason: entry.reason, at: Number(entry.at) || 0 };
        }
      });
    }
  } catch { /* 壊れていれば止めていない状態から始める */ }

  function save() {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(paused)); } catch { /* 保存できなくても、この起動中は止める */ }
  }

  return {
    isPaused: partition => Boolean(paused[partition]),
    reasonOf: partition => paused[partition]?.reason || null,
    list: () => Object.entries(paused).map(([partition, entry]) => ({ partition, ...entry })),
    // 新しく止めたときだけ true
    pause(partition, reason) {
      if (!partition || !REASONS[reason] || paused[partition]) return false;
      paused[partition] = { reason, at: now() };
      save();
      return true;
    },
    resume(partition) {
      if (!paused[partition]) return;
      delete paused[partition];
      save();
    },
  };
}

export { createXAccountPause, describeXPauseReason };
