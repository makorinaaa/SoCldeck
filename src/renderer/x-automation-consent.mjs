// X 連携の自動化機能（画面外の X ページのデータの読み取りと、スクリプトでのボタン操作）への同意。
// X は API 以外の自動化やスクレイピングを禁止しており、アカウントの制限・永久凍結の可能性を明記している。
// 同意するまでこれらの機能は動かさない。同意の有無は人ごとの判断なので、ワークスペースとは別に保存し、
// バックアップにも含めない。
const STORAGE_KEY = 'socialdeck_x_automation';
const DECISIONS = new Set(['enabled', 'disabled']);
const X_AUTOMATION_RULES_URL = 'https://help.x.com/en/rules-and-policies/x-automation';
const X_TERMS_URL = 'https://x.com/en/tos';
const OVERLAY_ID = 'x-automation-ov';

function createXAutomationSetting({ storage, fallback = null }) {
  function get() {
    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (DECISIONS.has(saved)) return saved;
      if (saved === null && DECISIONS.has(fallback)) return fallback;
    } catch { /* 読めなければ未確認として扱い、機能は動かさない */ }
    return 'unset';
  }

  return {
    get,
    isEnabled: () => get() === 'enabled',
    set(decision) {
      if (!DECISIONS.has(decision)) return;
      storage.setItem(STORAGE_KEY, decision);
    },
  };
}

function needsXAutomationDecision(decision, xAccounts) {
  return decision === 'unset' && Array.isArray(xAccounts) && xAccounts.length > 0;
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// listPaused: X が制限・本人確認を求めたため止めているアカウント（x-account-pause.mjs）
function createXAutomationConsent({ documentRef, getDecision, listPaused = () => [] }) {
  function pausedSection() {
    const paused = listPaused();
    if (!paused.length) return '';
    return `<div class="x-automation-paused">
        <p><strong>止めているアカウント</strong>（X で状況を確認してから再開してください）</p>
        ${paused.map(entry => `<div class="ng-row">
          <span>${escapeHtml(entry.label)}: ${escapeHtml(entry.description)}</span>
          <button class="ng-del" data-action="resume-x-account" data-partition="${escapeHtml(entry.partition)}">再開</button>
        </div>`).join('')}
      </div>`;
  }

  function close() {
    documentRef.getElementById(OVERLAY_ID)?.remove();
  }

  function open() {
    close();
    const decision = getDecision();
    const current = decision === 'enabled' ? '使う' : decision === 'disabled' ? '使わない' : '未選択';
    const overlay = documentRef.createElement('div');
    overlay.className = 'ov on';
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `<div class="modal x-automation-modal" role="dialog" aria-modal="true" aria-labelledby="x-automation-title">
        <h2 id="x-automation-title">X の自動化機能について</h2>
        <p>SocialDeck の次の機能は、X の API を使わず、画面外で開いた X のページのデータを読み取ったり、X のページのボタンをスクリプトで押したりして動いています。</p>
        <ul>
          <li>ネイティブ版のホーム・リスト・通知カラム</li>
          <li>SocialDeck の投稿画面からの X への投稿・返信・同時投稿</li>
          <li>通知センターの X の通知</li>
          <li>X カラムの自動更新</li>
        </ul>
        <p class="x-automation-warning">X は、API 以外の自動化（ウェブサイトをスクリプトで操作するなど）と、許可のないスクレイピングを禁止しています。これらの機能を使うと、<strong>X のアカウントが制限されたり、永久凍結されたりする可能性があります。</strong>「API を直接呼ばない」ことは、規約に従っていることを意味しません。</p>
        <p>詳しくは X の<a href="${X_AUTOMATION_RULES_URL}" target="_blank" rel="noopener noreferrer">自動化ルール</a>と<a href="${X_TERMS_URL}" target="_blank" rel="noopener noreferrer">利用規約</a>を確認してください。</p>
        <p>使わない場合も、X カラムで X のページを見ることはできます（自動更新はしません）。選択は後から「設定 → X の自動化機能」で変えられます。変えるとアプリを読み込み直します。</p>
        <p class="x-automation-current">現在: ${current}</p>
        ${pausedSection()}
        <div class="x-automation-actions">
          <button class="btn-cancel" data-action="decide-x-automation" data-decision="disabled">使わない</button>
          <button class="send-btn" data-action="decide-x-automation" data-decision="enabled">リスクを理解して使う</button>
        </div>
      </div>`;
    documentRef.body.appendChild(overlay);
  }

  return { close, open };
}

export {
  X_AUTOMATION_RULES_URL,
  X_TERMS_URL,
  createXAutomationConsent,
  createXAutomationSetting,
  needsXAutomationDecision,
};
