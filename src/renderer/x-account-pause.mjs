// X がアカウントの制限や本人確認を求めたときに、そのアカウントの X の自動操作を止めておく。
// - 回数制限（429）: 機能ごと・15分ごとの制限なので、15分「一時停止」して自動で再開する
// - ロック・本人確認・投稿の上限: 利用者が X で確認して「再開」を押すまで「停止」する（再起動しても停止のまま）
const STORAGE_KEY = 'socialdeck_x_paused';
const RATE_LIMIT_PAUSE_MS = 15 * 60 * 1000;
const REASONS = new Set(['locked', 'rate-limit', 'post-limit']);

function describeXPauseReason(reason, { operation = null } = {}) {
  if (reason === 'locked') return 'X でアカウントのロック・本人確認が表示されました';
  if (reason === 'rate-limit') return `X の${operation ? ` ${operation} で` : ''}回数制限（429）が返されました`;
  if (reason === 'post-limit') return 'X で投稿の上限・制限が表示されました';
  return 'X で制限が表示されました';
}

function createXAccountPause({ storage, now = Date.now }) {
  let entries = {};
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      Object.entries(saved).forEach(([partition, entry]) => {
        if (!partition || !entry || !REASONS.has(entry.reason)) return;
        const at = Number(entry.at) || 0;
        entries[partition] = {
          reason: entry.reason,
          at,
          operation: /^[A-Za-z]{1,64}$/.test(entry.operation || '') ? entry.operation : null,
          // v2.6.1 は回数制限でも期限なしで止めていた。その記録は止めた時刻から15分の一時停止として扱う
          until: Number.isFinite(entry.until) ? entry.until
            : entry.reason === 'rate-limit' ? at + RATE_LIMIT_PAUSE_MS : null,
        };
      });
    }
  } catch { /* 壊れていれば止めていない状態から始める */ }

  function save() {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* 保存できなくても、この起動中は止める */ }
  }

  // 一時停止の期限が過ぎたものは外す
  function active(partition) {
    const entry = entries[partition];
    if (!entry) return null;
    if (entry.until !== null && now() >= entry.until) {
      delete entries[partition];
      save();
      return null;
    }
    return entry;
  }

  return {
    isPaused: partition => Boolean(active(partition)),
    // 利用者が再開するまで止める（自動では再開しない）
    isStopped: partition => active(partition)?.until === null,
    reasonOf: partition => active(partition)?.reason || null,
    untilOf: partition => active(partition)?.until ?? null,
    describe: partition => {
      const entry = active(partition);
      return entry ? describeXPauseReason(entry.reason, entry) : '';
    },
    list: () => Object.keys(entries).map(partition => {
      const entry = active(partition);
      return entry ? { partition, ...entry } : null;
    }).filter(Boolean),
    // 新しく止めたとき、または一時停止を停止に強めたときだけ true
    pause(partition, reason, { operation = null } = {}) {
      if (!partition || !REASONS.has(reason)) return false;
      const current = active(partition);
      const temporary = reason === 'rate-limit';
      if (current && (temporary || current.until === null)) return false;
      const at = now();
      entries[partition] = { reason, at, operation, until: temporary ? at + RATE_LIMIT_PAUSE_MS : null };
      save();
      return true;
    },
    resume(partition) {
      if (!entries[partition]) return;
      delete entries[partition];
      save();
    },
  };
}

export { RATE_LIMIT_PAUSE_MS, createXAccountPause, describeXPauseReason };
