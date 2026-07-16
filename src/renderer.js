// ═══════════════════════════════════════════════
//  SOCIALDECK — renderer.js
//  Bluesky AT Protocol + X WebView
// ═══════════════════════════════════════════════
const IS_ELECTRON = typeof window.electronAPI !== 'undefined';
const composeMedia = window.SocialDeckComposeMedia;
const xComposeMediaDraft = composeMedia.createMediaDraft({
  supportsVideo: true,
  resolveFilePath: file => IS_ELECTRON && file.path ? file.path : null,
});
const bskyComposeMediaDraft = composeMedia.createMediaDraft();
const composeRequests = window.SocialDeckComposeRequest;
const xComposePreparation = window.SocialDeckXComposePreparation;
const xPostConfirmation = window.SocialDeckXPostConfirmation;
const notificationCenter = window.SocialDeckNotificationCenter;
const E2E_FIXTURES = window.electronAPI?.e2eFixtures || null;
let xWebViewRuntime;

// ─── Bluesky API ───────────────────────────────
const BSKY = 'https://bsky.social/xrpc';

async function apiPost(endpoint, body, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BSKY}/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || e.error || `${endpoint} failed`); }
  // 空レスポンス（updateSeen等）の場合は {} を返す
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}
async function apiGet(endpoint, params = {}, token = null) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const q = new URLSearchParams(params).toString();
  const res = await fetch(`${BSKY}/${endpoint}${q ? '?' + q : ''}`, { headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || e.error || `${endpoint} failed`); }
  return res.json();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let _refreshPromise = null;
async function refreshBskyToken() {
  if (_refreshPromise) return _refreshPromise; // 既に実行中なら同じPromiseを返す
  _refreshPromise = (async () => {
    if (!state.b?.refreshJwt) throw new Error('リフレッシュトークンがありません');
    const res = await fetch(`${BSKY}/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.b.refreshJwt}` }
    });
    if (!res.ok) throw new Error('トークン更新失敗。再ログインしてください');
    const data = await res.json();
    state.b.accessJwt = data.accessJwt;
    state.b.refreshJwt = data.refreshJwt;
    saveState();
    return data.accessJwt;
  })();
  try {
    return await _refreshPromise;
  } finally {
    _refreshPromise = null;
  }
}

// トークン切れを検知して自動リフレッシュ後に再試行するラッパー
async function bskyCallWithRefresh(fn) {
  try {
    return await fn(state.b.accessJwt);
  } catch (e) {
    if (e.message.includes('expired') || e.message.includes('Token') || e.message.includes('Unauthorized')) {
      try {
        const newJwt = await refreshBskyToken();
        return await fn(newJwt);
      } catch (e2) {
        throw e2;
      }
    }
    throw e;
  }
}

const bsky = window.SocialDeckBskyClient.createBskyClient();
const bskyRichText = window.SocialDeckBskyRichText.createBskyRichText();
const buildFacets = bskyRichText.buildFacets;

const SVG = {
  x: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.389 6.231H2.763l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  bsky: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  rt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  reply: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  follow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h2v2H8zM14 14h2v2h-2z"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>`,
};

// ─── COLUMN PERSISTENCE ──────────────────────────
const columnRuntime = window.SocialDeckColumnRuntime.createColumnRuntime();
const COL_KEY = columnRuntime.layoutKey;
const animeScheduleRuntime = window.SocialDeckAnimeScheduleRuntime.createAnimeScheduleRuntime({
  documentRef: document,
  fetchSchedule: force => window.electronAPI?.getAnimeSchedule
    ? window.electronAPI.getAnimeSchedule(force)
    : Promise.reject(new Error('Anime schedule API is unavailable')),
});
const xComposeExecutor = window.SocialDeckXComposeDelivery.createXComposeDelivery({
  createPreparationScript: () => xComposePreparation.createPreparationScript(),
  createConfirmationScript: options => xPostConfirmation.createConfirmationScript(options),
  readFileAsDataUrl,
  trimVideo: window.electronAPI?.trimVideo,
  readFileBase64: window.electronAPI?.readFileBase64,
  deleteTempFile: window.electronAPI?.deleteTempFile,
  setStatus: setFFmpegStatus,
});
const bskyComposeExecutor = window.SocialDeckBskyComposeDelivery.createBlueskyComposeDelivery({
  uploadBlob: async file => {
    const response = await fetch(`${BSKY}/com.atproto.repo.uploadBlob`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'Authorization': `Bearer ${state.b.accessJwt}`,
      },
      body: await file.arrayBuffer(),
    });
    if (!response.ok) throw new Error('Image upload failed');
    return (await response.json()).blob;
  },
  buildFacets,
  resolveFacets: facets => resolveMentionDids(facets, state.b.accessJwt),
  createRecord: ({ repoDid, record }) => bskyCallWithRefresh(jwt =>
    apiPost('com.atproto.repo.createRecord', {
      repo: repoDid,
      collection: 'app.bsky.feed.post',
      record,
    }, jwt)),
});
const networkAdapters = window.SocialDeckNetworkAdapters.createNetworkAdapterRegistry({
  icons: SVG,
  composeExecutors: { x: xComposeExecutor, b: bskyComposeExecutor },
});
const columnLifecycle = window.SocialDeckColumnLifecycle.createColumnLifecycle({
  createPlan: request => networkAdapters.createColumnPlan(request),
  insertPlan: insertColumnPlan,
  scheduleRefresh: (id, interval, callback) => refreshScheduler.set(id, interval, callback),
  clearRefreshSchedule: id => refreshScheduler.remove(id),
  executeRefresh: (id, plan, context) => networkAdapters.executeColumnRefresh(id, plan, {
    refreshXNavigation: (id, destination) => xWebViewRuntime.refreshNavigation(id, destination),
    reloadWebView: id => xWebViewRuntime.reload(id, { silent: true }),
    loadWebViewUrl: (id, url) => xWebViewRuntime.navigateToStart(id, url),
    refreshBlueskyFeed: silentRefreshBsky,
    refreshAnimeSchedule: id => animeScheduleRuntime.load(id, { force: context?.force === true }),
  }),
  applyWidth: (id, width) => {
    const el = document.getElementById(`col-${id}`);
    if (el) { el.style.width = width; el.style.minWidth = width; }
  },
  applyCollapsed: id => setTimeout(() => toggleColCollapse(id), 0),
  reportRestoreError: insertColumnRestoreError,
  cleanupRuntimeState: id => {
    delete colCursors[id];
    collapsedCols.delete(id);
    xWebViewRuntime?.disposeColumn(id);
    animeScheduleRuntime.dispose(id);
    localStorage.removeItem(`col_fs_${id}`);
  },
  listElementIds: () => [...document.querySelectorAll('#cols .col')]
    .map(element => element.id?.replace(/^col-/, ''))
    .filter(Boolean),
  removeElement: id => {
    const element = document.getElementById(`col-${id}`);
    if (!element) return false;
    element.remove();
    return true;
  },
  persistWorkspace: saveColLayout,
  onRefreshStateChange: renderColumnRefreshState,
});
const composeCompletion = window.SocialDeckComposeCompletion.createComposeCompletionRuntime({
  notify: toast,
  refresh: refreshAfterCompose,
  onRefreshError: error => console.warn('Compose refresh failed:', error),
});
const composeCoordinator = window.SocialDeckComposeCoordinator.createComposeCoordinator({
  createAttemptRuntime: window.SocialDeckComposeAttempt.createComposeAttemptRuntime,
  createCrossPostRuntime: window.SocialDeckCrossPostRuntime.createCrossPostRuntime,
  complete: plan => composeCompletion.complete(plan),
});

function saveColLayout() {
  if (new URLSearchParams(location.search).get('widget') === '1') return;
  const cols = document.getElementById('cols');
  if (!cols) return;
  const layout = columnRuntime.captureLayout(cols.querySelectorAll('.col'), {
    resolveDefinition: storedColumn => networkAdapters.resolveColumnDefinition(storedColumn),
    getInterval: id => columnLifecycle.getRefreshInterval(id, DEFAULT_INTERVAL_MS),
    isCollapsed: id => collapsedCols.has(id),
  });
  columnRuntime.writeStoredLayout(layout);
}

function loadColLayout() {
  return columnRuntime.getLayoutForCurrentMode();
}

function insertColumnPlan(plan) {
  if (plan?.kind === 'wv') {
    insertWebViewCol(plan.config, null, plan.partition);
    return true;
  }
  if (plan?.kind === 'bsky') {
    insertBskyCol(plan.config);
    return true;
  }
  if (plan?.kind === 'schedule') {
    insertAnimeScheduleCol(plan.config);
    return true;
  }
  return false;
}

function insertColumnRestoreError(col, error) {
  const column = document.createElement('div');
  column.className = 'col';
  column.id = `col-${col.id}`;
  column.innerHTML = `
    <div class="col-head">
      <div class="col-info">
        <div class="col-title">${esc(col.title || 'Column restore failed')}</div>
        <div class="col-sub">Workspace State was preserved</div>
      </div>
      <div class="col-actions">
        <button class="cbtn" title="削除" onclick="removeCol('${esc(col.id)}')">&times;</button>
      </div>
    </div>
    <div class="feed-empty">${esc(error.message || 'Column Definition could not be resolved')}</div>`;
  document.getElementById('cols')?.appendChild(column);
}

function renderColumnRefreshState(id, state) {
  const element = document.getElementById(`refresh-state-${id}`);
  if (!element) return;
  const labels = { refreshing: '更新中', deferred: '保留', failed: '失敗', paused: '停止中', disabled: 'OFF' };
  element.className = `col-refresh-state ${state.status}`;

  if (state.status === 'succeeded' && state.lastUpdatedAt) {
    const updatedAt = new Date(state.lastUpdatedAt);
    element.textContent = updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    element.title = `最終更新: ${updatedAt.toLocaleString()}`;
    return;
  }

  element.textContent = labels[state.status] || '';
  element.title = state.status === 'failed'
    ? `更新失敗: ${state.error?.message || 'Unknown error'}`
    : state.status === 'deferred'
      ? '閲覧中または準備中のため更新を延期しました'
      : state.status === 'paused'
        ? 'バックグラウンドのため自動更新を停止中です'
        : state.status === 'disabled'
          ? '自動更新はOFFです'
        : '';
}

function restoreColLayout() {
  const layout = loadColLayout();
  if (!layout.length) return false;

  columnLifecycle.restore(layout, {
    persistNormalized: columnRuntime.isWidgetMode()
      ? undefined
      : normalized => columnRuntime.writeStoredLayout(normalized),
  });
  return true;
}

// ─── NG WORD / MUTE ──────────────────────────────
const muteRules = window.SocialDeckMuteRules.createMuteRules();

function openNgSettings() {
  const ngData = muteRules.getRules();
  document.getElementById('ng-modal-ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'ov on'; ov.id = 'ng-modal-ov';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };

  const wordsList = ngData.words.map((w, i) =>
    `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:12px;color:var(--text1)">${esc(w)}</span>
      <button onclick="removeNg('word',${i})" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:11px;font-family:inherit">削除</button>
    </div>`).join('') || '<div style="font-size:12px;color:var(--text3);padding:6px 0">なし</div>';

  const usersList = ngData.users.map((u, i) =>
    `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:12px;color:var(--text1)">@${esc(u)}</span>
      <button onclick="removeNg('user',${i})" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:11px;font-family:inherit">削除</button>
    </div>`).join('') || '<div style="font-size:12px;color:var(--text3);padding:6px 0">なし</div>';

  ov.innerHTML = `<div class="modal" style="width:380px;max-height:80vh;overflow-y:auto">
    <h2 style="margin-bottom:16px">NGワード / ミュート設定</h2>
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px">NGワード（投稿本文）</div>
      ${wordsList}
      <div style="display:flex;gap:6px;margin-top:8px">
        <input id="ng-word-input" type="text" placeholder="キーワードを追加…" style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text1);font-family:inherit;outline:none">
        <button onclick="addNg('word')" style="padding:6px 12px;border-radius:6px;background:var(--accent);border:none;color:#fff;cursor:pointer;font-size:12px;font-family:inherit">追加</button>
      </div>
    </div>
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px">ミュートユーザー</div>
      ${usersList}
      <div style="display:flex;gap:6px;margin-top:8px">
        <input id="ng-user-input" type="text" placeholder="@handle を追加…" style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text1);font-family:inherit;outline:none">
        <button onclick="addNg('user')" style="padding:6px 12px;border-radius:6px;background:var(--accent);border:none;color:#fff;cursor:pointer;font-size:12px;font-family:inherit">追加</button>
      </div>
    </div>
    <button onclick="document.getElementById('ng-modal-ov').remove()" class="btn-cancel">閉じる</button>
  </div>`;
  document.body.appendChild(ov);
  setTimeout(() => document.getElementById('ng-word-input')?.focus(), 50);
}

function addNg(type) {
  const inputId = type === 'word' ? 'ng-word-input' : 'ng-user-input';
  const input = document.getElementById(inputId);
  const { value: val } = muteRules.add(type, input?.value);
  if (!val) return;
  openNgSettings();
  refilterBskyCols();
  toast('NG ' + type + ': ' + val + ' added');
}

function removeNg(type, idx) {
  muteRules.remove(type, idx);
  openNgSettings();
  refilterBskyCols();
}

// NGルール変更時に全Bskyカラムを再読み込みして即時反映
function refilterBskyCols() {
  document.querySelectorAll('.col').forEach(col => {
    const cid = col.id?.replace('col-', '');
    const type = col.dataset?.type;
    if (cid && type) {
      silentRefreshBsky(cid, type, col.dataset.feeduri || null);
    }
  });
}

// ─── STATE ────────────────────────────────────
const LS_KEY = window.SocialDeckStateStore.STATE_KEY;
const MEM_KEY = 'socialdeck_mem_interval'; // メモリクリア間隔設定キー  // v4: Xマルチアカウント対応
// state.xs: Xアカウントの配列 [{username, initials, bg, partition}]
// state.activeX: アクティブなXアカウントのindex
// state.b: Blueskyアカウント（単一）
const stateStore = window.SocialDeckStateStore.createStateStore();
let state = {
  xs: [],
  activeX: 0,
  b: null,
  composePreferences: { crossPostFromX: false, crossPostFromBluesky: false },
};
const AVBG = ['linear-gradient(135deg,#4e9af0,#6a5cf0)', 'linear-gradient(135deg,#e05c7a,#9a5cf0)', 'linear-gradient(135deg,#3dc98a,#4e9af0)', 'linear-gradient(135deg,#f5c842,#e05c7a)', 'linear-gradient(135deg,#9a5cf0,#e05c7a)', 'linear-gradient(135deg,#4e9af0,#3dc98a)', 'linear-gradient(135deg,#e05c7a,#f5c842)', 'linear-gradient(135deg,#3dc98a,#6a5cf0)'];
const uiUtils = window.SocialDeckUiUtils.createUiUtils({
  avatarBackgrounds: AVBG,
  bskyIcon: SVG.bsky,
});
const { esc, relTime, avBgFor, renderAvatar, formatText } = uiUtils;
const lightboxRuntime = window.SocialDeckLightboxRuntime.createLightboxRuntime();
const memoryCleaner = window.SocialDeckMemoryCleaner.createMemoryCleaner({
  key: MEM_KEY,
  clearMemory: IS_ELECTRON ? () => window.electronAPI?.clearMemory?.() : null,
});
const fileDragShield = window.SocialDeckFileDragShield.createFileDragShield({
  getIsColumnDragging: () => Boolean(dragSrc),
});
const notificationRuntime = window.SocialDeckNotificationRuntime.createNotificationRuntime();
const xLoginGate = window.SocialDeckXLoginGate.createXLoginGate();


function loadState() {
  return stateStore.load();
}
function saveState() { stateStore.save(state); }

function getXAccountPartitions() {
  return (state.xs || []).map(account => account.partition).filter(Boolean);
}

function syncXNetworkAccounts() {
  xWebViewRuntime?.syncAccounts(state.xs || []);
  if (!IS_ELECTRON || !window.electronAPI?.syncXNetworkAccounts) {
    return Promise.resolve([]);
  }
  return window.electronAPI.syncXNetworkAccounts(getXAccountPartitions());
}

function nextXPartition() {
  const used = new Set((state.xs || []).map(a => a.partition).filter(Boolean));
  for (let i = 0; i < 100; i++) {
    const partition = `persist:x-${i}`;
    if (!used.has(partition)) return partition;
  }
  return `persist:x-${Date.now()}`;
}

// ─── AUTH ──────────────────────────────────────
function switchTab(t) {
  document.querySelectorAll('.ltab').forEach(el => el.classList.remove('active'));
  document.querySelector(`.ltab.${t === 'x' ? 'xt' : 'bt'}`).classList.add('active');
  document.querySelectorAll('.lpanel').forEach(el => el.classList.remove('active'));
  document.getElementById(`panel-${t}`).classList.add('active');
}

function updateLoginUI() {
  xWebViewRuntime?.syncAccounts(state.xs || []);
  const xStatus = document.getElementById('x-status');
  const bStatus = document.getElementById('b-status');
  const xAccounts = state.xs || [];

  if (xAccounts.length > 0) {
    const listHtml = xAccounts.map((a, i) =>
      '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">' +
      '<div style="width:24px;height:24px;border-radius:50%;background:' + a.bg + ';display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#000;flex-shrink:0">' + esc(a.initials) + '</div>' +
      '<span style="flex:1;font-size:12px;color:var(--text1)">' + esc(a.username) + '</span>' +
      '<button onclick="removeXAccount(' + i + ')" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:11px;font-family:inherit">Remove</button>' +
      '</div>'
    ).join('');
    xStatus.className = 'lsbar ok';
    xStatus.innerHTML = '<div style="width:100%"><div style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><span style="font-size:12px">' + xAccounts.length + ' X account(s) connected</span></div>' + listHtml + '</div>';
  } else {
    xStatus.className = 'lsbar none';
    xStatus.textContent = 'X account is not connected';
  }

  if (state.b) {
    bStatus.className = 'lsbar ok';
    bStatus.innerHTML = 'Connected: <span class="sname">@' + esc(state.b.handle) + '</span>';
    document.getElementById('b-login-btn').style.display = 'none';
    document.getElementById('b-logout-btn').style.display = 'block';
  } else {
    bStatus.className = 'lsbar none';
    bStatus.textContent = 'Bluesky account is not connected';
    document.getElementById('b-login-btn').style.display = 'flex';
    document.getElementById('b-logout-btn').style.display = 'none';
  }

  const lenter = document.getElementById('lenter');
  const msg = document.getElementById('lfoot-msg');
  const canEnter = xAccounts.length > 0 || state.b;
  lenter.disabled = !canEnter;
  msg.textContent = canEnter ? [xAccounts.length > 0 ? 'X(' + xAccounts.length + ')' : '', state.b ? 'Bluesky' : ''].filter(Boolean).join(' + ') + ' connected' : 'Add an account to continue';
}

async function loginX() {
  const user = document.getElementById('x-user').value.trim();
  const err = document.getElementById('x-err');
  err.textContent = '';
  if (!user) { err.textContent = 'Enter a display name'; return; }
  const clean = user.replace(/^@/, '');
  const username = '@' + clean;

  if ((state.xs || []).some(a => a.username === username)) {
    err.textContent = 'This account is already registered';
    return;
  }

  const loginButton = document.getElementById('x-login-btn');
  if (loginButton?.disabled) return;
  const idx = (state.xs || []).length;
  const partition = nextXPartition();
  const bg = AVBG[idx % AVBG.length];
  if (loginButton) loginButton.disabled = true;
  try {
    if (IS_ELECTRON) {
      await window.electronAPI?.initializeXSessionTheme?.(partition);
    }
  } catch {} finally {
    if (loginButton) loginButton.disabled = false;
  }
  if (!state.xs) state.xs = [];
  state.xs.push({ username, initials: clean.slice(0, 2).toUpperCase(), bg, partition, loginPending: true });
  state.activeX = idx;
  saveState();
  await syncXNetworkAccounts();
  document.getElementById('x-user').value = '';
  updateLoginUI();
  toast(username + ' added');
  const app = document.getElementById('app');
  if (!app.style.display || app.style.display === 'none') enterApp();
  else renderApp();
}

async function removeXAccount(idx) {
  const account = state.xs[idx];
  if (!account) return;
  if (!confirm('Log out ' + account.username + '?')) return;
  const partition = account.partition || `persist:x-${idx}`;
  if (IS_ELECTRON && window.electronAPI?.clearXSession) {
    await window.electronAPI.clearXSession(partition);
  }
  state.xs.splice(idx, 1);
  if (state.activeX >= state.xs.length) state.activeX = Math.max(0, state.xs.length - 1);
  saveState();
  await syncXNetworkAccounts();
  updateLoginUI();
  const app = document.getElementById('app');
  if (app.style.display !== 'none' && app.style.display !== '') renderApp();
  toast('X account removed');
}

function logoutX() {
  if (state.xs && state.xs.length > 0) removeXAccount(0);
}

async function loginBluesky() {
  const handle = document.getElementById('b-user').value.trim();
  const pass = document.getElementById('b-pass').value.trim();
  const err = document.getElementById('b-err');
  const btn = document.getElementById('b-login-btn');
  err.textContent = '';
  if (!handle || !pass) { err.textContent = 'Enter handle and app password'; return; }
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.textContent = 'Authenticating...';

  try {
    const session = await bsky.login(handle, pass);
    const bg = avBgFor(session.handle);
    state.b = {
      handle: session.handle,
      did: session.did,
      accessJwt: session.accessJwt,
      refreshJwt: session.refreshJwt,
      displayName: session.handle,
      avatar: null,
      initials: session.handle.slice(0, 2).toUpperCase(),
      bg,
    };
    try {
      const profile = await bsky.getProfile(session.accessJwt, session.did);
      state.b.avatar = profile.avatar || null;
      state.b.displayName = profile.displayName || session.handle;
    } catch {}
    saveState();
    updateLoginUI();
    toast('@' + session.handle + ' logged in');
    const app = document.getElementById('app');
    if (!app.style.display || app.style.display === 'none') enterApp();
    else renderApp();
  } catch (e) {
    err.textContent = e.message || 'Login failed';
    document.getElementById('b-status').textContent = err.textContent;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function logoutBluesky() {
  state.b = null;
  saveState();
  updateLoginUI();
  toast('Bluesky logged out');
}

function enterApp() {
  document.getElementById('login-screen').classList.add('hidden');
  const app = document.getElementById('app');
  app.style.display = 'flex';
  renderApp();
}

function openLoginScreen() {
  closeAmenu();
  updateLoginUI();
  document.getElementById('login-screen').classList.remove('hidden');
}

async function logoutAll() {
  if (!confirm('Log out all accounts?')) return;
  // Xの全WebViewセッションをクリア
  if (IS_ELECTRON && window.electronAPI?.clearAllXSessions) {
    await window.electronAPI.clearAllXSessions();
  }
  // 全カラムの自動更新を停止
  columnLifecycle.clear({ removeElements: true });
  document.getElementById('notif-center-x-readers')?.replaceChildren();
  notificationCenterItems = [];
  xNotificationCenterItems = [];
  const composePreferences = state.composePreferences;
  state = {
    ...window.SocialDeckStateStore.defaultState(),
    composePreferences,
  };
  saveState();
  await syncXNetworkAccounts();
  columnRuntime.clearStoredLayout(); // カラムレイアウトもリセット
  closeAmenu();
  notificationRuntime.stopPoll();
  notificationRuntime.clearUnread();
  document.getElementById('cols').innerHTML = addColBtnHTML();
  document.getElementById('app').style.display = 'none';
  updateLoginUI();
  document.getElementById('login-screen').classList.remove('hidden');
  toast('All accounts logged out');
}

// ─── APP RENDER ────────────────────────────────
function renderApp() {
  xWebViewRuntime.syncAccounts(state.xs || []);
  renderNavChips();
  renderSbAvatars();
  renderDefaultCols();
  renderCompUI();
  buildOptGrid();
}

function renderNavChips() {
  const el = document.getElementById('nav-chips');
  el.innerHTML = '';
  (state.xs || []).forEach(a => {
    el.innerHTML += `<div class="chip live"><div class="cav" style="background:${a.bg}">${a.initials}</div><div class="cdot"></div>${esc(a.username)}</div>`;
  });
  if (state.b) {
    const avHtml = state.b.avatar ? `<img src="${state.b.avatar}">` : state.b.initials;
    el.innerHTML += `<div class="chip live"><div class="cav" style="background:${state.b.bg}">${avHtml}</div><div class="cdot"></div>@${state.b.handle}</div>`;
  }
}

function renderSbAvatars() {
  const el = document.getElementById('sb-avs');
  el.innerHTML = '';
  if ((state.xs || []).length > 0) {
    const first = state.xs[0];
    el.innerHTML += '<div class="sbav" style="background:' + first.bg + '" title="X accounts" onclick="toggleAmenu()">' + esc(first.initials) + '<div class="adot x"></div></div>';
  }
  if (state.b) {
    const inner = state.b.avatar ? '<img src="' + state.b.avatar + '">' : esc(state.b.initials);
    el.innerHTML += '<div class="sbav" style="background:' + state.b.bg + '" title="@' + esc(state.b.handle) + '" onclick="toggleAmenu()">' + inner + '<div class="adot b"></div></div>';
  }

  const mi = document.getElementById('amenu-items');
  mi.innerHTML = '';
  if ((state.xs || []).length > 0) {
    mi.innerHTML += '<div style="padding:6px 13px;font-size:10px;font-weight:600;color:var(--text3)">X accounts</div>';
    state.xs.forEach((a, i) => {
      mi.innerHTML += '<div class="aitem">' +
        '<div class="aiav" style="background:' + a.bg + '">' + esc(a.initials) + '</div>' +
        '<div class="aiinfo"><div class="ainame">' + esc(a.username) + '</div><div class="aihandle">X WebView</div></div>' +
        '<button onclick="event.stopPropagation();removeXAccount(' + i + ')" style="padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:10px;font-family:inherit">Remove</button>' +
        '</div>';
    });
  }
  if (state.b) {
    if ((state.xs || []).length > 0) mi.innerHTML += '<div class="amenu-sep"></div>';
    mi.innerHTML += '<div style="padding:6px 13px;font-size:10px;font-weight:600;color:var(--text3)">Bluesky</div>';
    const avHtml = state.b.avatar ? '<img src="' + state.b.avatar + '">' : esc(state.b.initials);
    mi.innerHTML += '<div class="aitem"><div class="aiav" style="background:' + state.b.bg + ';overflow:hidden;padding:0">' + avHtml + '</div><div class="aiinfo"><div class="ainame">' + esc(state.b.displayName) + '</div><div class="aihandle">@' + esc(state.b.handle) + '</div></div><span class="aplat b">Bluesky</span></div>';
  }
}

function toggleAmenu() { document.getElementById('amenu').classList.toggle('open'); }
function closeAmenu() { document.getElementById('amenu').classList.remove('open'); }
document.addEventListener('click', e => { if (!e.target.closest('.sb')) closeAmenu(); });

// ─── DEFAULT COLUMNS ────────────────────────────
let colIdSeq = 0;
const colCursors = {}; // colId → cursor for pagination

// X画像ライトボックス用WebViewプリロードパス
// enterApp前に確定させてカラム生成時に確実に使えるようにする
let wvPreloadPath = '';
async function initWvPreloadPath() {
  if (IS_ELECTRON && window.electronAPI?.getWebviewPreloadPath) {
    wvPreloadPath = await window.electronAPI.getWebviewPreloadPath() || '';
  }
}
const refreshScheduler = window.SocialDeckRefreshScheduler.createRefreshScheduler();
const DEFAULT_INTERVAL_MS = refreshScheduler.DEFAULT_INTERVAL_MS;
const ANIME_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
xWebViewRuntime = window.SocialDeckXWebViewRuntime.createXWebViewRuntime({
  documentRef: document,
  storage: localStorage,
  isElectron: IS_ELECTRON,
  loginGate: xLoginGate,
  isLoginPending: partition => getXAccountByPartition(partition)?.loginPending === true,
  completeLogin: completeXLogin,
  getRefreshInterval: id => columnLifecycle.getRefreshInterval(id),
  setRefreshInterval: (id, interval) => columnLifecycle.setRefreshInterval(id, interval),
  defaultRefreshInterval: DEFAULT_INTERVAL_MS,
  createRefreshScript: destination => window.SocialDeckXTimelineRefresh.createRefreshScript(destination),
  getCanonicalUrl: getXNotificationColumnUrl,
  openImage: openImg,
});

async function silentRefreshBsky(cid, type, feedUri) {
  if (!state.b) return { status: 'deferred', detail: 'account-unavailable' };
  const feedEl = document.getElementById(`feed-${cid}`);
  if (!feedEl) return { status: 'deferred', detail: 'column-unavailable' };
  if (feedEl.querySelector('.feed-loading')) return { status: 'deferred', detail: 'loading' };

  try {
    let items = [];
    if (type === 'timeline') {
      const data = await bskyCallWithRefresh(jwt => bsky.timeline(jwt, 10));
      items = data.feed || [];
    } else if (type === 'feed' && feedUri) {
      const data = await bskyCallWithRefresh(jwt => bsky.feed(jwt, feedUri, 10));
      items = data.feed || [];
    } else if (type === 'notif') {
      const data = await bskyCallWithRefresh(jwt => bsky.notifications(jwt, 10));
      items = (data.notifications || []).map(n => ({ _notif: n }));
    }
    if (!items.length) return { status: 'succeeded', detail: 'no-changes' };

    window.SocialDeckBskyPostRuntime.syncPostMetrics(feedEl, items);

    const existingUris = new Set([...feedEl.querySelectorAll('.post[data-uri]')].map(el => el.dataset.uri));
    const firstNotifTime = feedEl.querySelector('.notif')?.dataset?.time;
    const newItems = items.filter(it => {
      if (it._notif) return !firstNotifTime || new Date(it._notif.indexedAt) > new Date(firstNotifTime);
      const uri = it.post?.uri;
      return !uri || !existingUris.has(uri);
    });
    if (!newItems.length) return { status: 'succeeded', detail: 'no-changes' };

    const html = newItems
      .filter(item => item._notif
        ? !muteRules.blocksNotification(item._notif)
        : !muteRules.blocksPost(item))
      .map(item => item._notif ? renderBskyNotif(item._notif) : renderBskyPost(item))
      .join('');
    if (!html) return { status: 'succeeded', detail: 'filtered' };

    const prevScrollTop = feedEl.scrollTop;
    const atTop = prevScrollTop < 50;
    const beforeCount = feedEl.children.length;
    feedEl.insertAdjacentHTML('afterbegin', html);
    const addedCount = feedEl.children.length - beforeCount;
    const addedEls = [];
    for (let i = 0; i < addedCount; i++) {
      const el = feedEl.children[i];
      if (el) { el.classList.add('sd-new'); addedEls.push(el); }
    }

    if (atTop) {
      requestAnimationFrame(() => feedEl.scrollTo({ top: 0, behavior: 'smooth' }));
    } else {
      requestAnimationFrame(() => {
        let addedHeight = 0;
        addedEls.forEach(el => { addedHeight += el.offsetHeight; });
        feedEl.scrollTop = prevScrollTop + addedHeight;
        requestAnimationFrame(() => {
          let h2 = 0;
          addedEls.forEach(el => { h2 += el.offsetHeight; });
          if (h2 !== addedHeight) feedEl.scrollTop = prevScrollTop + h2;
        });
      });
    }

    setTimeout(() => addedEls.forEach(el => el.classList.remove('sd-new')), 600);
    if (feedEl.scrollTop < 100) {
      const posts = feedEl.querySelectorAll('.post, .notif');
      for (let i = 300; i < posts.length; i++) posts[i].remove();
    }
    const badge = document.getElementById(`badge-${cid}`);
    if (badge) {
      badge.textContent = `+${newItems.length}`;
      badge.style.display = '';
      setTimeout(() => { badge.style.display = 'none'; }, 5000);
    }
    return { status: 'succeeded', detail: 'new-items' };
  } catch (error) {
    throw error;
  }
}

function addColBtnHTML() {
  return `<button class="add-col-btn" onclick="openAddMod()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>追加</button>`;
}

function renderDefaultCols() {
  columnLifecycle.clear({ removeElements: true });

  if (restoreColLayout()) return;

  // 初回起動: Blueskyのデフォルトカラムのみ追加
  if (state.b) {
    columnLifecycle.create({ networkId: 'b', definitionId: 'b-timeline-new', id: 'b-home' });
    columnLifecycle.create({ networkId: 'b', definitionId: 'b-notif-new', id: 'b-notif' });
  }
}

async function initializeXLoginStates() {
  if (!IS_ELECTRON || !window.electronAPI?.isXSessionAuthenticated) return;
  let changed = false;
  await Promise.all((state.xs || []).map(async (account, index) => {
    const partition = account.partition || `persist:x-${index}`;
    const authenticated = await window.electronAPI.isXSessionAuthenticated(partition);
    if (authenticated && account.loginPending) {
      delete account.loginPending;
      changed = true;
    } else if (!authenticated && account.loginPending !== true) {
      account.loginPending = true;
      changed = true;
    }
  }));
  if (changed) saveState();
  xWebViewRuntime.syncAccounts(state.xs || []);
}

function getXAccountByPartition(partition) {
  return (state.xs || []).find((account, index) =>
    (account.partition || `persist:x-${index}`) === partition
  );
}

function completeXLogin(partition) {
  const account = getXAccountByPartition(partition);
  if (account?.loginPending) {
    delete account.loginPending;
    saveState();
    xWebViewRuntime.syncAccounts(state.xs || []);
  }
}

// ─── WEBVIEW COLUMN (X) ─────────────────────────
function insertWebViewCol(cfg, before = null, partition = 'persist:x') {
  const cols = document.getElementById('cols');
  const addbtn = before || cols.querySelector('.add-col-btn');
  const div = document.createElement('div');
  div.className = 'col';
  div.id = `col-${cfg.id}`;
  if (cfg.network) div.dataset.network = cfg.network;
  if (cfg.definitionId) div.dataset.definitionId = cfg.definitionId;
  div.innerHTML = `
    <div class="col-head">
      <div class="col-ic ${cfg.icCls}">${cfg.icon}</div>
      <div class="col-info" style="cursor:pointer" title="先頭へスクロール / ダブルクリックで展開" draggable="false" onclick="wvScrollTop('${cfg.id}')" ondblclick="if(collapsedCols.has('${cfg.id}'))toggleColCollapse('${cfg.id}')">
        <div class="col-title">${cfg.title}</div>
        <div class="col-sub"><div class="ldot" style="background:#e7e9ea"></div>${cfg.sub}</div>
      </div>
      <div class="col-actions">
        <span class="col-refresh-state" id="refresh-state-${cfg.id}"></span>
        <button class="cbtn col-collapse-btn" title="折りたたむ" onclick="toggleColCollapse('${cfg.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg></button>
        <button class="cbtn" title="戻る" onclick="wvBack('${cfg.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button class="cbtn" id="rfr-${cfg.id}" title="更新" onclick="refreshColumn('${cfg.id}',this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
        <button class="cbtn" title="自動更新設定" onclick="openColSettings('${cfg.id}','wv')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg></button>
        <button class="cbtn" title="削除" onclick="removeCol('${cfg.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>
    <div class="col-webview" style="position:relative">
      <div class="webview-loading" id="wvload-${cfg.id}"><div class="spinner"></div>読み込み中…</div>
      <!-- スムーズリロード用オーバーレイ（リロード中に現在の画面を表示し続ける） -->
      <div id="wvov-${cfg.id}" style="display:none;position:absolute;inset:0;z-index:10;pointer-events:none;opacity:1;transition:opacity .4s ease"></div>
    </div>
  `;
  cols.insertBefore(div, addbtn);
  xWebViewRuntime.mountColumn({
    id: cfg.id,
    networkId: cfg.network || 'x',
    partition,
    targetUrl: cfg.url,
    host: div.querySelector('.col-webview'),
    preloadPath: wvPreloadPath,
  });

}


function getXNotificationColumnUrl(id) {
  const column = document.getElementById(`col-${id}`);
  if (column?.dataset.definitionId !== 'x-notif-new') return null;
  return networkAdapters.getColumnDefinition('x', 'x-notif-new')?.defaultParams?.url
    || 'https://x.com/notifications';
}

function wvBack(id) {
  xWebViewRuntime.back(id);
}

// ─── COLUMN COLLAPSE ─────────────────────────────
const collapsedCols = new Set();
function toggleColCollapse(id) {
  const col = document.getElementById(`col-${id}`);
  if (!col) return;
  const isCollapsed = collapsedCols.has(id);
  const btn = col.querySelector('.col-collapse-btn');

  if (isCollapsed) {
    // 展開
    collapsedCols.delete(id);
    const savedW = col.dataset.savedWidth || '';
    col.style.width = savedW || '';
    col.style.minWidth = savedW || '';
    col.querySelectorAll('.feed, .col-webview, .col-search-bar').forEach(el => { el.style.display = ''; });
    const titleEl = col.querySelector('.col-title');
    if (titleEl) { titleEl.style.writingMode = ''; titleEl.style.maxWidth = ''; }
    col.querySelectorAll('.col-actions .cbtn:not(.col-collapse-btn)').forEach(el => { el.style.display = ''; });
    col.querySelector('.col-info')?.style.setProperty('flex', '');
    if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>`;
    if (btn) btn.title = '折りたたむ';
    // 折りたたみ中クリック展開を解除
    col.style.cursor = '';
    col._sdCollapseClick = null;
    columnLifecycle.persist();
  } else {
    // 折りたたみ
    collapsedCols.add(id);
    col.dataset.savedWidth = col.style.width || '';
    col.style.width = '42px';
    col.style.minWidth = '42px';
    col.querySelectorAll('.feed, .col-webview, .col-search-bar').forEach(el => { el.style.display = 'none'; });
    const titleEl = col.querySelector('.col-title');
    if (titleEl) { titleEl.style.writingMode = 'vertical-rl'; titleEl.style.maxWidth = '20px'; }
    // 折りたたみボタン以外のアクションボタンを非表示
    col.querySelectorAll('.col-actions .cbtn:not(.col-collapse-btn)').forEach(el => { el.style.display = 'none'; });
    if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>`;
    if (btn) btn.title = '展開する';
    // 折りたたみ中はカラム全体クリックで展開
    col.style.cursor = 'pointer';
    if (!col._sdCollapseClick) {
      col._sdCollapseClick = (e) => {
        if (!collapsedCols.has(id)) return;
        // ボタンクリックはtoggleColCollapseが別途処理するので二重発火を防ぐ
        if (e.target.closest('button')) return;
        toggleColCollapse(id);
      };
      col.addEventListener('click', col._sdCollapseClick);
    }
    columnLifecycle.persist();
  }
}

function openFirstXWebViewDevTools() {
  if (!xWebViewRuntime.openDevTools()) toast('X WebView not found');
}

// カラムヘッダークリックで先頭へスクロール
// カラムヘッダークリックで先頭へ（元のURLに戻してリロード）
function wvScrollTop(id) {
  // 折りたたみ中はシングルクリックでも展開
  if (collapsedCols.has(id)) { toggleColCollapse(id); return; }

  const col = document.getElementById(`col-${id}`);
  if (!col) return;

  const layout = loadColLayout();
  const saved = layout.find(c => c.id === id);
  xWebViewRuntime.navigateToStart(id, saved?.url);
}

function bskyScrollTop(cid) {
  // 折りたたみ中はシングルクリックでも展開
  if (collapsedCols.has(cid)) { toggleColCollapse(cid); return; }
  const feedEl = document.getElementById(`feed-${cid}`);
  if (feedEl) feedEl.scrollTo({ top: 0, behavior: 'smooth' });
}

function animeScheduleScrollTop(cid) {
  if (collapsedCols.has(cid)) { toggleColCollapse(cid); return; }
  animeScheduleRuntime.scrollTop(cid);
}


async function refreshAfterCompose(target) {
  if (target.kind === 'x-account-columns') {
    await xWebViewRuntime.refreshAccount(target.accountId);
    return;
  }

  if (target.kind === 'bsky-timelines') {
    if (state.b?.did !== target.accountId) return;
    const timelineIds = [...document.querySelectorAll('.col[data-type="timeline"]')]
      .map(column => column.id?.replace('col-', ''))
      .filter(Boolean);
    await Promise.all(timelineIds.map(id => silentRefreshBsky(id, 'timeline', null)));
    return;
  }

  throw new Error(`Unsupported compose refresh target: ${target.kind}`);
}


// ─── BLUESKY COLUMN ─────────────────────────────
function insertBskyCol(cfg, before = null) {
  const cols = document.getElementById('cols');
  const addbtn = before || cols.querySelector('.add-col-btn');
  const cid = cfg.id || `b-${++colIdSeq}`;
  colCursors[cid] = null;

  const div = document.createElement('div');
  div.className = 'col';
  div.id = `col-${cid}`;
  if (cfg.network) div.dataset.network = cfg.network;
  if (cfg.definitionId) div.dataset.definitionId = cfg.definitionId;
  // Refresh plans and pagination use the column metadata.
  div.dataset.type = cfg.type || 'timeline';
  if (cfg.feedUri) div.dataset.feeduri = cfg.feedUri;

  const hasSearch = cfg.type === 'search';
  div.innerHTML = `
    <div class="col-head">
      <div class="col-ic ${cfg.icCls}">${cfg.icon}</div>
      <div class="col-info" style="cursor:pointer" title="先頭へスクロール / ダブルクリックで展開" draggable="false" onclick="bskyScrollTop('${cid}')" ondblclick="if(collapsedCols.has('${cid}'))toggleColCollapse('${cid}')">
        <div class="col-title">${cfg.title}</div>
        <div class="col-sub"><div class="ldot"></div>${cfg.sub}</div>
      </div>
      <div class="col-actions">
        <span class="cbadge" id="badge-${cid}" style="display:none"></span>
        <span class="col-refresh-state" id="refresh-state-${cid}"></span>
        <button class="cbtn" id="rfr-${cid}" title="更新" onclick="refreshColumn('${cid}',this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
        <button class="cbtn col-collapse-btn" title="折りたたむ" onclick="toggleColCollapse('${cid}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg></button>
        <button class="cbtn" title="自動更新設定" onclick="openColSettings('${cid}','bsky')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg></button>
        <button class="cbtn" title="削除" onclick="removeCol('${cid}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>
    ${hasSearch ? `<div class="col-search-bar"><input type="text" id="sq-${cid}" placeholder="Bluesky を検索…" onkeydown="if(event.key==='Enter')doSearch('${cid}')"><button onclick="doSearch('${cid}')">検索</button></div>` : ''}
    <div class="feed" id="feed-${cid}"><div class="feed-loading"><div class="spinner"></div>読み込み中…</div></div>
  `;
  cols.insertBefore(div, addbtn);

  // 自動ロードとデフォルト自動更新開始
  if (!hasSearch) {
    loadBskyFeed(cid, cfg.type, cfg.feedUri);
    columnLifecycle.setRefreshInterval(cid, DEFAULT_INTERVAL_MS);
  }
  // フォントサイズ設定を復元
  const savedFs = parseInt(localStorage.getItem(`col_fs_${cid}`));
  if (savedFs) {
    const feedEl = document.getElementById(`feed-${cid}`);
    if (feedEl) feedEl.style.fontSize = savedFs + 'px';
  }
}

function insertAnimeScheduleCol(cfg, before = null) {
  const cols = document.getElementById('cols');
  const addbtn = before || cols.querySelector('.add-col-btn');
  const cid = cfg.id;
  const div = document.createElement('div');
  div.className = 'col';
  div.id = `col-${cid}`;
  div.dataset.kind = 'schedule';
  div.dataset.network = cfg.network;
  div.dataset.definitionId = cfg.definitionId;
  div.innerHTML = `
    <div class="col-head">
      <div class="col-ic ${cfg.icCls}">${cfg.icon}</div>
      <div class="col-info" style="cursor:pointer" title="先頭へスクロール / ダブルクリックで展開" draggable="false" onclick="animeScheduleScrollTop('${cid}')" ondblclick="if(collapsedCols.has('${cid}'))toggleColCollapse('${cid}')">
        <div class="col-title">${esc(cfg.title)}</div>
        <div class="col-sub"><div class="ldot" style="background:#ffd166"></div><span id="anime-sub-${cid}">${esc(cfg.sub)}</span></div>
      </div>
      <div class="col-actions">
        <span class="col-refresh-state" id="refresh-state-${cid}"></span>
        <button class="cbtn" id="rfr-${cid}" title="更新" onclick="refreshColumn('${cid}',this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
        <button class="cbtn col-collapse-btn" title="折りたたむ" onclick="toggleColCollapse('${cid}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg></button>
        <button class="cbtn" title="自動更新設定" onclick="openColSettings('${cid}','schedule')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg></button>
        <button class="cbtn" title="削除" onclick="removeCol('${cid}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>
    <div class="feed anime-schedule" id="feed-${cid}"><div class="feed-loading"><div class="spinner"></div>放送予定を取得中…</div></div>
  `;
  cols.insertBefore(div, addbtn);
  columnLifecycle.setRefreshInterval(cid, ANIME_REFRESH_INTERVAL_MS);
  animeScheduleRuntime.load(cid).catch(() => {});

  const savedFs = parseInt(localStorage.getItem(`col_fs_${cid}`));
  if (savedFs) div.querySelector('.feed').style.fontSize = savedFs + 'px';
}

async function loadBskyFeed(cid, type, feedUri = null, append = false) {
  if (!state.b) return;
  const feedEl = document.getElementById(`feed-${cid}`);
  if (!feedEl) return;
  if (!append) { feedEl.innerHTML = `<div class="feed-loading"><div class="spinner"></div>読み込み中…</div>`; colCursors[cid] = null; }

  try {
    let items = [], newCursor = null;
    if (type === 'timeline') {
      const data = await bskyCallWithRefresh(jwt => bsky.timeline(jwt, 40, colCursors[cid]));
      items = data.feed || []; newCursor = data.cursor;
    } else if (type === 'feed' && feedUri) {
      const data = await bskyCallWithRefresh(jwt => bsky.feed(jwt, feedUri, 40, colCursors[cid]));
      items = data.feed || []; newCursor = data.cursor;
    } else if (type === 'notif') {
      const data = await bskyCallWithRefresh(jwt => bsky.notifications(jwt, 40));
      items = (data.notifications || []).map(n => ({ _notif: n }));
      if (!append) {
        bskyCallWithRefresh(jwt => bsky.updateSeen(jwt, new Date().toISOString()))
          .then(() => notificationRuntime.clearUnread())
          .catch(() => {});
      }
    }

    colCursors[cid] = newCursor;
    const html = items
      .filter(item => item._notif
        ? !muteRules.blocksNotification(item._notif)
        : !muteRules.blocksPost(item))
      .map(item => item._notif ? renderBskyNotif(item._notif) : renderBskyPost(item)).join('');

    if (append) {
      feedEl.querySelector('.load-more')?.remove();
      feedEl.insertAdjacentHTML('beforeend', html);
    } else {
      feedEl.innerHTML = html || `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">投稿がありません</div>`;
    }

    // フィードのスクロールで未読バッジをリセット
    const feedElForScroll = document.getElementById(`feed-${cid}`);
    if (feedElForScroll) {
      feedElForScroll.addEventListener('scroll', () => {
        const badge = document.getElementById(`badge-${cid}`);
        if (badge) badge.style.display = 'none';
      }, { once: true });
    }

    // もっと読むボタン
    if (newCursor && type !== 'notif') {
      feedEl.insertAdjacentHTML('beforeend', `<button class="load-more" onclick="loadBskyFeed('${cid}','${type}',${feedUri ? `'${feedUri}'` : 'null'},true)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="6 9 12 15 18 9"/></svg>もっと見る</button>`);
    }

    // バッジ更新
    const badge = document.getElementById(`badge-${cid}`);
    if (badge && items.length) { badge.textContent = items.length; badge.style.display = ''; setTimeout(() => { badge.style.display = 'none'; }, 5000); }
  } catch (e) {
    if (!append) feedEl.innerHTML = `<div class="feed-err">取得エラー: ${esc(e.message)}<br><button onclick="loadBskyFeed('${cid}','${type}',${feedUri ? `'${feedUri}'` : 'null'})">再試行</button></div>`;
    else toast(`エラー: ${e.message}`);
  }
}

async function doSearch(cid) {
  const q = document.getElementById(`sq-${cid}`)?.value?.trim();
  if (!q) return;
  const feedEl = document.getElementById(`feed-${cid}`);
  feedEl.innerHTML = `<div class="feed-loading"><div class="spinner"></div>検索中…</div>`;
  try {
    const data = await bsky.search(state.b.accessJwt, q, 40);
    const posts = data.posts || [];
    feedEl.innerHTML = posts.length
      ? posts.map(p => renderBskyPost({ post: p })).join('')
      : `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">「${esc(q)}」の結果は0件です</div>`;
  } catch (e) {
    feedEl.innerHTML = `<div class="feed-err">検索エラー: ${esc(e.message)}<br><button onclick="doSearch('${cid}')">再試行</button></div>`;
  }
}

function removeCol(id) {
  columnLifecycle.remove(id);
}

async function refreshColumn(id, button) {
  button?.classList.add('spin');
  try {
    await columnLifecycle.refreshNow(id, { force: true });
  } finally {
    button?.classList.remove('spin');
  }
}

// ─── BLUESKY POST RENDERING ──────────────────────

function renderBskyPost(item) {
  const post = item.post || item;
  const record = post.record || {};
  const author = post.author || {};
  const reposter = item.reason?.by || null;
  const uri = post.uri || '';
  const cid = post.cid || '';
  const body = formatText(record.text || '', record.facets);
  const time = relTime(record.createdAt);
  const likes = post.likeCount || 0;
  const rts = post.repostCount || 0;
  const replies = post.replyCount || 0;
  const liked = !!post.viewer?.like;
  const reposted = !!post.viewer?.repost;
  const likeUri = post.viewer?.like || '';
  const repostUri = post.viewer?.repost || '';

  let imgHtml = '';
  const embed = post.embed;
  const imgs = embed?.images || embed?.media?.images || [];
  if (imgs.length) {
    const cls = ['', 'n1', 'n2', 'n3', 'n4'][Math.min(imgs.length, 4)];
    const urlArr = imgs.slice(0, 4).map(img => img.fullsize || img.thumb);
    imgHtml = '<div class="p-imgs ' + cls + '" data-urls="' + esc(JSON.stringify(urlArr)) + '">' +
      urlArr.map((url, idx) => '<img src="' + esc(imgs[idx].thumb || imgs[idx].fullsize) + '" alt="' + esc(imgs[idx].alt || '') + '" loading="lazy" style="cursor:zoom-in" onclick="openImg(JSON.parse(this.closest(\'.p-imgs\').dataset.urls), ' + idx + ')">').join('') +
      '</div>';
  }

  const repostLabel = reposter ? '<div class="repost-label">' + SVG.rt + ' ' + esc(reposter.displayName || reposter.handle) + ' reposted</div>' : '';
  return '<div class="post" role="link" tabindex="0" data-uri="' + esc(uri) + '" data-cid="' + esc(cid) + '" data-likeuri="' + esc(likeUri) + '" data-reposturi="' + esc(repostUri) + '" onclick="openBskyPost(event,\'' + esc(uri) + '\',\'' + esc(author.handle) + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \')openBskyPost(event,\'' + esc(uri) + '\',\'' + esc(author.handle) + '\')" oncontextmenu="showPostMenu(event,\'' + esc(author.handle) + '\')">' +
    repostLabel +
    '<div class="post-top">' + renderAvatar(author) + '<div class="post-meta"><div class="meta-row"><span class="p-name" title="' + esc(author.displayName || author.handle) + '">' + esc(author.displayName || author.handle) + '</span><span class="p-handle">@' + esc(author.handle) + '</span><span class="p-time">' + time + '</span></div></div></div>' +
    '<div class="p-body">' + body + '</div>' + imgHtml +
    '<div class="p-acts">' +
    '<button class="pa rep" onclick="openReply(\'' + esc(uri) + '\',\'' + esc(cid) + '\',\'' + esc(author.handle) + '\')">' + SVG.reply + ' <span>' + replies + '</span></button>' +
    '<button class="pa rt ' + (reposted ? 'rted' : '') + '" onclick="showRtMenu(event,this,\'' + esc(uri) + '\',\'' + esc(cid) + '\',\'' + esc(author.handle) + '\')">' + SVG.rt + ' <span>' + rts + '</span></button>' +
    '<button class="pa lk ' + (liked ? 'liked' : '') + '" onclick="toggleLike(this,\'' + esc(uri) + '\',\'' + esc(cid) + '\')">' + SVG.heart.replace('none', liked ? 'currentColor' : 'none') + ' <span>' + likes + '</span></button>' +
    '</div></div>';
}

function renderBskyNotif(n) {
  const a = n.author || {};
  const tp = n.reason;
  const icons = { like: SVG.heart, repost: SVG.rt, follow: SVG.follow, reply: SVG.reply, mention: SVG.reply, quote: SVG.reply };
  const labels = { like: 'Like', repost: 'Repost', follow: 'Follow', reply: 'Reply', mention: 'Mention', quote: 'Quote' };
  const time = relTime(n.indexedAt);
  return '<div class="notif" data-time="' + esc(n.indexedAt) + '" onclick="showProfile(\'' + esc(a.did) + '\')">' +
    '<div class="ntype nt' + esc(tp) + '">' + (icons[tp] || SVG.bell) + ' ' + esc(labels[tp] || tp) + '</div>' +
    '<div class="nrow">' + renderAvatar(a, 28) + '<div class="ninfo"><div class="nwho">' + esc(a.displayName || a.handle) + '</div><div class="nex">@' + esc(a.handle) + '</div><div class="nago">' + time + '</div></div></div>' +
    '</div>';
}

let hoverCardTimer = null;
let hoverCardHideTimer = null;
const hoverCardCache = {}; // did → profile data

function hoverCardShow(event, did, handle) {
  if (!did && !handle) return;
  clearTimeout(hoverCardHideTimer);
  // 300ms後に表示（ちらつき防止）
  hoverCardTimer = setTimeout(() => _hoverCardRender(event.target, did, handle), 300);
}

function hoverCardHide() {
  clearTimeout(hoverCardTimer);
  // カード上にマウスが乗った場合は消さない
  hoverCardHideTimer = setTimeout(() => {
    const card = document.getElementById('bsky-hover-card');
    if (card && !card.matches(':hover')) _hoverCardRemove();
  }, 150);
}

function _hoverCardRemove() {
  const card = document.getElementById('bsky-hover-card');
  if (card) { card.style.opacity = '0'; setTimeout(() => card.remove(), 150); }
}

async function _hoverCardRender(target, did, handle) {
  if (!state.b) return;
  document.getElementById('bsky-hover-card')?.remove();
  const card = document.createElement('div');
  card.id = 'bsky-hover-card';
  card.style.cssText = 'position:fixed;z-index:1000;width:260px;background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-size:12px;color:var(--text1)';
  card.textContent = 'Loading...';
  document.body.appendChild(card);
  card.addEventListener('mouseenter', () => clearTimeout(hoverCardHideTimer));
  card.addEventListener('mouseleave', () => { hoverCardHideTimer = setTimeout(_hoverCardRemove, 150); });
  _hoverCardPosition(card, target);

  try {
    const profile = await bskyCallWithRefresh(jwt => bsky.getProfile(jwt, did || handle));
    hoverCardCache[profile.did] = profile;
    const avatar = profile.avatar ? '<img src="' + profile.avatar + '" style="width:42px;height:42px;border-radius:50%;object-fit:cover">' : '<div style="width:42px;height:42px;border-radius:50%;background:' + avBgFor(profile.handle) + '"></div>';
    card.innerHTML = '<div style="display:flex;gap:10px;align-items:center">' + avatar + '<div style="min-width:0"><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(profile.displayName || profile.handle) + '</div><div style="color:var(--text3)">@' + esc(profile.handle) + '</div></div></div>' +
      (profile.description ? '<div style="margin-top:8px;color:var(--text2);line-height:1.4">' + esc(profile.description).slice(0, 180) + '</div>' : '');
    _hoverCardPosition(card, target);
  } catch {
    card.textContent = 'Profile load failed';
  }
}

async function hoverCardToggleFollow(btnEl) {
  if (!state.b) return;
  const did      = btnEl.dataset.did;
  const handle   = btnEl.dataset.handle;
  const followUri = btnEl.dataset.followuri || '';
  const isFollowing = !!followUri;
  btnEl.disabled = true; btnEl.textContent = '…';
  try {
    if (isFollowing) {
      await bskyCallWithRefresh(jwt => bsky.unfollow(jwt, state.b.did, followUri));
      const key = did || handle;
      if (hoverCardCache[key]) hoverCardCache[key].viewer = { ...hoverCardCache[key].viewer, following: null };
      btnEl.style.borderColor = 'var(--accent)'; btnEl.style.background = 'var(--accent)'; btnEl.style.color = '#fff';
      btnEl.textContent = 'フォロー'; btnEl.dataset.followuri = ''; btnEl.disabled = false;
      toast(`@${handle} のフォローを解除しました`);
    } else {
      const res = await bskyCallWithRefresh(jwt => bsky.follow(jwt, state.b.did, did));
      const newFollowUri = res?.uri || '';
      const key = did || handle;
      if (hoverCardCache[key]) hoverCardCache[key].viewer = { ...hoverCardCache[key].viewer, following: newFollowUri };
      btnEl.style.borderColor = 'var(--border2)'; btnEl.style.background = 'transparent'; btnEl.style.color = 'var(--text2)';
      btnEl.textContent = 'フォロー中'; btnEl.dataset.followuri = newFollowUri; btnEl.disabled = false;
      toast(`@${handle} をフォローしました`);
    }
  } catch(e) {
    toast(`エラー: ${e.message}`);
    btnEl.disabled = false; btnEl.textContent = isFollowing ? 'フォロー中' : 'フォロー';
  }
}

function _hoverCardPosition(card, target) {
  const rect = target.getBoundingClientRect();
  const cardW = 280, cardH = 200;
  const vw = window.innerWidth, vh = window.innerHeight;

  let left = rect.left;
  let top = rect.bottom + 8;

  // 右端はみ出し補正
  if (left + cardW > vw - 10) left = vw - cardW - 10;
  // 下端はみ出し → 上に表示
  if (top + cardH > vh - 10) top = rect.top - cardH - 8;
  // 念のため左端補正
  if (left < 10) left = 10;

  card.style.left = left + 'px';
  card.style.top = top + 'px';
}

// ─── INTERACTIONS ────────────────────────────────
async function toggleLike(btn, uri, cid) {
  if (!state.b) return;
  const post = btn.closest('.post');
  const on = !btn.classList.contains('liked');
  // 楽観的UI更新
  btn.classList.toggle('liked', on);
  const svg = btn.querySelector('svg');
  if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none');
  const span = btn.querySelector('span');
  const currentLikes = parseInt(span?.textContent || '0');
  if (span) span.textContent = on ? currentLikes + 1 : Math.max(0, currentLikes - 1);
  try {
    if (on) {
      const res = await bsky.like(state.b.accessJwt, state.b.did, uri, cid);
      if (post && res.uri) post.dataset.likeuri = res.uri;
    } else {
      const likeUri = post?.dataset?.likeuri;
      if (likeUri) await bsky.unlike(state.b.accessJwt, state.b.did, likeUri);
      if (post) post.dataset.likeuri = '';
    }
    toast(on ? 'いいねしました' : 'いいねを取り消しました');
  } catch (e) {
    // 失敗時はロールバック
    btn.classList.toggle('liked', !on);
    if (svg) svg.setAttribute('fill', !on ? 'currentColor' : 'none');
    if (span) span.textContent = currentLikes;
    toast(`エラー: ${e.message}`);
  }
}

// ─── REPOST MENU ────────────────────────────────
function showRtMenu(event, btn, uri, cid, handle) {
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('rt-ctx-menu')?.remove();

  const post = btn.closest('.post');
  const isRted = btn.classList.contains('rted');

  const menu = document.createElement('div');
  menu.id = 'rt-ctx-menu';
  const rect = btn.getBoundingClientRect();
  menu.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom + 4}px;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:4px;z-index:500;min-width:160px;box-shadow:0 4px 20px rgba(0,0,0,.5)`;

  const rtLabel = isRted ? 'Undo repost' : 'Repost';
  menu.innerHTML = `
    <div onclick="toggleRepost(document.querySelector('[data-uri=\\'${uri}\\'] .pa.rt'),'${uri}','${cid}');document.getElementById('rt-ctx-menu')?.remove()"
      style="padding:7px 12px;font-size:12px;cursor:pointer;border-radius:5px;color:${isRted ? 'var(--red)' : 'var(--green)'};display:flex;align-items:center;gap:8px"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      ${SVG.rt} ${rtLabel}
    </div>
    <div onclick="openQuoteModal('${uri}','${cid}','${esc(handle)}');document.getElementById('rt-ctx-menu')?.remove()"
      style="padding:7px 12px;font-size:12px;cursor:pointer;border-radius:5px;color:var(--text1);display:flex;align-items:center;gap:8px"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
      引用リポスト
    </div>
  `;
  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 50);
}

// 引用リポストモーダル
let quoteTarget = null;
function openQuoteModal(uri, cid, handle) {
  quoteTarget = { uri, cid, handle };
  document.getElementById('quote-modal-ov')?.remove();

  const ov = document.createElement('div');
  ov.className = 'ov on'; ov.id = 'quote-modal-ov';
  ov.onclick = e => { if (e.target === ov) { ov.remove(); quoteTarget = null; } };

  const avBg = state.b?.bg || AVBG[0];
  const avInner = state.b?.avatar
    ? `<img src="${state.b.avatar}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`
    : (state.b?.initials || '?');

  ov.innerHTML = `
    <div class="cmodal">
      <div class="chead">
        <h2 style="display:flex;align-items:center;gap:8px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="color:#0085ff"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
          引用リポスト
        </h2>
        <button onclick="document.getElementById('quote-modal-ov')?.remove();quoteTarget=null"
          style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:2px 6px">✕</button>
      </div>
      <!-- 引用元プレビュー -->
      <div style="border:1px solid var(--border2);border-radius:8px;padding:9px 11px;margin-bottom:12px;font-size:12px;color:var(--text2)">
        <div style="font-weight:700;color:var(--text2);margin-bottom:3px">@${esc(handle)} の投稿を引用</div>
        <div style="color:var(--text3);font-size:11px">${esc(uri.split('/').pop())}</div>
      </div>
      <div class="comp-wrap">
        <div class="comp-av" style="background:${avBg};position:relative;overflow:hidden">${avInner}</div>
        <textarea class="comp-ta" id="quote-ta" placeholder="コメントを追加…" maxlength="300" oninput="updQuoteCC()"></textarea>
      </div>
      <div class="comp-foot">
        <span class="cc" id="quote-cct">0 / 300</span>
        <button class="send-btn" id="quote-sndb" onclick="doQuotePost()">引用して投稿</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  setTimeout(() => document.getElementById('quote-ta')?.focus(), 50);
}

function updQuoteCC() {
  const n = document.getElementById('quote-ta')?.value.length || 0;
  const el = document.getElementById('quote-cct');
  if (el) { el.textContent = `${n} / 300`; el.className = 'cc' + (n > 260 ? ' w' : '') + (n > 300 ? ' over' : ''); }
  const btn = document.getElementById('quote-sndb');
  if (btn) btn.disabled = n > 300;
}

async function doQuotePost() {
  if (!state.b || !quoteTarget) return;
  const text = document.getElementById('quote-ta')?.value.trim() || '';
  const btn = document.getElementById('quote-sndb');
  if (btn) { btn.disabled = true; btn.textContent = '投稿中…'; }
  try {
    const rawFacets = buildFacets(text);
    const resolvedFacets = text ? await resolveMentionDids(rawFacets, state.b.accessJwt) : [];
    await bskyCallWithRefresh(jwt => {
      const record = {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString(),
        embed: { $type: 'app.bsky.embed.record', record: { uri: quoteTarget.uri, cid: quoteTarget.cid } }
      };
      if (resolvedFacets.length) record.facets = resolvedFacets;
      return apiPost('com.atproto.repo.createRecord', { repo: state.b.did, collection: 'app.bsky.feed.post', record }, jwt);
    });
    document.getElementById('quote-modal-ov')?.remove();
    quoteTarget = null;
    toast('Quote posted');
    setTimeout(() => {
      document.querySelectorAll('.col').forEach(col => {
        if (col.dataset.type === 'timeline') {
          const cid2 = col.id?.replace('col-', '');
          if (cid2) silentRefreshBsky(cid2, 'timeline', null);
        }
      });
    }, 1000);
  } catch(e) {
    toast(`エラー: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = '引用して投稿'; }
  }
}

async function toggleRepost(btn, uri, cid) {
  if (!state.b) return;
  const post = btn.closest('.post');
  const on = !btn.classList.contains('rted');
  btn.classList.toggle('rted', on);
  const span = btn.querySelector('span');
  const cur = parseInt(span?.textContent || '0');
  if (span) span.textContent = on ? cur + 1 : Math.max(0, cur - 1);
  try {
    if (on) {
      const res = await bsky.repost(state.b.accessJwt, state.b.did, uri, cid);
      if (post && res.uri) post.dataset.reposturi = res.uri;
    } else {
      const repostUri = post?.dataset?.reposturi;
      if (repostUri) await bsky.unrepost(state.b.accessJwt, state.b.did, repostUri);
      if (post) post.dataset.reposturi = '';
    }
    toast(on ? 'リポストしました' : 'リポストを取り消しました');
  } catch (e) {
    btn.classList.toggle('rted', !on);
    if (span) span.textContent = cur;
    toast(`エラー: ${e.message}`);
  }
}

let replyTarget = null; // { uri, cid, rootUri, rootCid }

async function openReply(uri, cid, handle) {
  document.getElementById('bsky-post-detail')?.remove();
  replyTarget = { uri, cid, rootUri: uri, rootCid: cid };

  // 返信先プレビューを表示
  const mod = document.getElementById('compMod');
  let preview = mod.querySelector('.bsky-reply-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.className = 'bsky-reply-preview';
    preview.style.cssText = 'border:1px solid var(--border2);border-radius:8px;padding:8px 11px;margin-bottom:10px;font-size:11px;color:var(--text3);display:flex;align-items:center;gap:7px';
    const compWrap = mod.querySelector('.comp-wrap');
    compWrap.parentNode.insertBefore(preview, compWrap);
  }
  preview.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;flex-shrink:0"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg><span style="color:var(--text2)">@${esc(handle)}</span> への返信`;

  openComp();
  setTimeout(() => document.getElementById('cta')?.focus(), 50);

  if (state.b) {
    try {
      const thread = await bskyCallWithRefresh(jwt => bsky.getThread(jwt, uri, 40));
      let node = thread?.thread;
      while (node?.parent) node = node.parent;
      if (node?.post?.uri && replyTarget?.uri === uri) {
        replyTarget.rootUri = node.post.uri;
        replyTarget.rootCid = node.post.cid;
      }
    } catch {}
  }
}

function showProfile(did) {
  if (!did) return;
  const cached = hoverCardCache[did];
  if (cached?.handle) {
    const url = `https://bsky.app/profile/${cached.handle}`;
    if (IS_ELECTRON) window.electronAPI && require ? null : window.open(url, '_blank');
    // Electron環境ではshell.openExternalをIPC経由で呼べないためwebviewで開く
    // 代替: bsky.appをWebViewカラムとして追加
    openBskyProfileCol(cached.handle);
  } else {
    openBskyProfileCol(did);
  }
}

function openBskyProfileCol(handleOrDid) {
  const url = `https://bsky.app/profile/${handleOrDid}`;

  const existingCol = notificationCenter.findBlueskyProfileColumn(
    document.querySelectorAll('.col')
  );
  if (existingCol) {
    const cid = existingCol.id?.replace('col-', '');
    if (cid && collapsedCols.has(cid)) toggleColCollapse(cid);
    if (cid) {
      xWebViewRuntime.navigate(cid, url)
        .then(() => columnLifecycle.persist())
        .catch(error => console.warn('Bluesky profile could not be opened:', error));
    }
    existingCol.scrollIntoView({ behavior: 'smooth', inline: 'center' });
    toast('プロフィールカラムを切り替えました');
    return;
  }

  const id = 'bsky-profile';
  const result = columnLifecycle.create({
    networkId: 'b',
    definitionId: 'b-profile',
    id,
    params: { url, title: 'プロフィール' },
  });
  if (result.status !== 'created') {
    toast('プロフィールカラムを開けませんでした');
    return;
  }
  setTimeout(() => {
    const col = document.getElementById(`col-${id}`);
    if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'end' });
  }, 300);
  toast('プロフィールカラムを開きました');
}

async function openBskyPost(event, uri, handle) {
  if (event.target.closest('button,a,img,.p-imgs,input,textarea')) return;
  if (window.getSelection()?.toString()) return;
  event.preventDefault();

  document.getElementById('bsky-post-detail')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'ov on';
  overlay.id = 'bsky-post-detail';
  overlay.onclick = detailEvent => {
    if (detailEvent.target === overlay) overlay.remove();
  };
  overlay.innerHTML = `
    <div class="bsky-post-detail-modal">
      <div class="chead">
        <h2>ポスト</h2>
        <button class="cbtn" title="閉じる" onclick="document.getElementById('bsky-post-detail')?.remove()">&times;</button>
      </div>
      <div class="bsky-post-detail-body">
        <div class="feed-loading"><div class="spinner"></div>読み込み中...</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  try {
    const data = await bskyCallWithRefresh(jwt => bsky.getThread(jwt, uri, 6));
    const thread = data?.thread;
    const body = overlay.querySelector('.bsky-post-detail-body');
    if (!body || !thread?.post) throw new Error('ポストを取得できませんでした');

    const replies = (thread.replies || [])
      .filter(reply => reply?.post)
      .map(reply => `<div class="bsky-thread-reply">${renderBskyPost({ post: reply.post })}</div>`)
      .join('');
    body.innerHTML = `
      <div class="bsky-thread-main">${renderBskyPost({ post: thread.post })}</div>
      ${replies ? `<div class="bsky-thread-label">返信</div>${replies}` : '<div class="feed-empty">返信はありません</div>'}`;
  } catch (error) {
    const body = overlay.querySelector('.bsky-post-detail-body');
    if (body) body.innerHTML = `<div class="feed-err">${esc(error.message)}</div>`;
  }
}

// ─── COMPOSE ────────────────────────────────────
function renderCompUI() {
  const xBtn = document.getElementById('sb-post-x');
  const bBtn = document.getElementById('sb-post-b');
  if (xBtn) xBtn.style.display = (state.xs && state.xs.length > 0) ? 'flex' : 'none';
  if (bBtn) bBtn.style.display = state.b ? 'flex' : 'none';

  renderNotifIcons();

  const avEl = document.getElementById('comp-av');
  if (avEl && state.b) {
    avEl.style.background = state.b.bg || '';
    if (state.b.avatar) {
      avEl.innerHTML = `<img src="${state.b.avatar}"><span id="comp-av-txt" style="display:none"></span>`;
    } else {
      avEl.innerHTML = `<span id="comp-av-txt">${state.b.initials || '?'}</span>`;
    }
  }

  const xAvEl = document.getElementById('x-post-av');
  const activeXAcc = state.xs?.[state.activeX || 0];
  if (xAvEl && activeXAcc) {
    xAvEl.style.background = activeXAcc.bg || '';
    xAvEl.innerHTML = `<span id="x-post-av-txt">${activeXAcc.initials || 'X'}</span>`;
  }
}

function openComp() {
  composeCoordinator.resetCrossPost();
  updateCrossPostControls();
  renderComposePreview('b');
  document.getElementById('compMod').classList.add('on');
  setTimeout(() => document.getElementById('cta')?.focus(), 50);
}

let selectedXIdx = 0; // 投稿に使うXアカウントのindex

function openXPost() {
  composeCoordinator.resetCrossPost();
  const sel = document.getElementById('x-acc-select');
  const xs = state.xs || [];

  if (xs.length <= 1) {
    // 1アカウントのみなら選択UIを非表示
    sel.style.display = 'none';
    selectedXIdx = 0;
  } else {
    // 複数アカウントならボタンを表示
    sel.style.display = 'flex';
    sel.innerHTML = xs.map((a, i) => `
      <button id="x-acc-btn-${i}" onclick="selectXAcc(${i})"
        style="display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;border:2px solid ${i === selectedXIdx ? 'var(--accent)' : 'var(--border2)'};background:${i === selectedXIdx ? 'var(--accent-dim)' : 'transparent'};color:${i === selectedXIdx ? 'var(--accent)' : 'var(--text2)'};cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;transition:all .12s">
        <span style="width:20px;height:20px;border-radius:50%;background:${a.bg};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#000;flex-shrink:0">${a.initials}</span>
        ${esc(a.username)}
      </button>`).join('');
  }

  // アバターを選択中アカウントに更新
  updateXPostAv();
  updateXCrossPostControls();
  renderComposePreview('x');
  document.getElementById('xPostMod').classList.add('on');
  setTimeout(() => document.getElementById('x-cta')?.focus(), 50);
}

function selectXAcc(idx) {
  selectedXIdx = idx;
  // ボタンのスタイルを更新
  const xs = state.xs || [];
  xs.forEach((_, i) => {
    const btn = document.getElementById(`x-acc-btn-${i}`);
    if (!btn) return;
    const active = i === idx;
    btn.style.borderColor = active ? 'var(--accent)' : 'var(--border2)';
    btn.style.background = active ? 'var(--accent-dim)' : 'transparent';
    btn.style.color = active ? 'var(--accent)' : 'var(--text2)';
  });
  updateXPostAv();
}

function updateXPostAv() {
  const acc = state.xs?.[selectedXIdx];
  if (!acc) return;
  const avEl = document.getElementById('x-post-av');
  if (avEl) {
    avEl.style.background = acc.bg;
    avEl.innerHTML = `<span id="x-post-av-txt">${acc.initials}</span>`;
  }
  renderComposePreview('x');
}

// ─── X投稿 画像・動画管理 ────────────────────────
function setFFmpegStatus(msg) {
  const el = document.getElementById('x-ffmpeg-status');
  if (el) el.textContent = msg;
}

function fmtSec(s) {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── 画像追加 ──
function handleXImgDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-on');
  const files = [...e.dataTransfer.files];
  addXImgFiles(files);
}

function addXImgFiles(files) {
  const result = xComposeMediaDraft.addFiles(files);
  if (result.status === 'rejected') {
    toast(result.reason === 'mixed-media'
      ? 'Cannot attach images and video together'
      : 'Up to 4 images can be attached');
    return;
  }
  if (result.status === 'video-added') {
    setXVideo(result.file);
    const fi = document.getElementById('x-img-file');
    if (fi) fi.value = '';
    return;
  }
  if (result.status !== 'images-added') return;
  renderXImgPreviews();
  const drop = document.getElementById('x-img-drop');
  if (drop) drop.style.opacity = result.limitReached ? '0.4' : '1';
  const fi = document.getElementById('x-img-file');
  if (fi) fi.value = '';
  updXCC();
}

function removeXImg(idx) {
  xComposeMediaDraft.removeImage(idx);
  renderXImgPreviews();
  const drop = document.getElementById('x-img-drop');
  if (drop) drop.style.opacity = '1';
  updXCC();
}

function renderXImgPreviews() {
  const container = document.getElementById('x-img-preview');
  if (!container) return;
  container.querySelectorAll('img').forEach(img => {
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  });
  const { images } = xComposeMediaDraft.getSnapshot();
  container.innerHTML = images.map((image, i) => {
    const url = URL.createObjectURL(image.file);
    return `<div style="display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg3)">
      <img src="${url}" style="width:52px;height:52px;object-fit:cover;display:block;border-radius:4px;flex-shrink:0">
      <input type="text" placeholder="画像の説明（Bluesky同時投稿に使用）" maxlength="1000"
        value="${esc(image.altText)}" id="x-alt-${i}"
        oninput="updateXImgAlt(${i},this.value)"
        style="flex:1;min-width:0;background:transparent;border:none;color:var(--text2);font-family:inherit;font-size:11px;outline:none">
      <button onclick="removeXImg(${i})"
        style="width:18px;height:18px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;font-size:11px;line-height:1;padding:0;font-family:inherit;display:flex;align-items:center;justify-content:center;flex-shrink:0">x</button>
    </div>`;
  }).join('');
}

function updateXImgAlt(index, value) {
  xComposeMediaDraft.updateAlt(index, value);
  renderComposePreview('x');
}

// ── 動画追加・UI ──
function setXVideo(file) {
  const wrap = document.getElementById('x-video-wrap');
  const vid  = document.getElementById('x-video-preview');
  if (!wrap || !vid) return;

  if (vid.src?.startsWith('blob:')) URL.revokeObjectURL(vid.src);
  vid.src = URL.createObjectURL(file);

  vid.onloadedmetadata = () => {
    const dur = vid.duration;
    xComposeMediaDraft.setVideoDuration(dur);
    const inEl  = document.getElementById('x-trim-in');
    const outEl = document.getElementById('x-trim-out');
    if (inEl)  inEl.value  = 0;
    if (outEl) outEl.value = 100;
    updateTrimLabels();
    updateTrimHighlight();
    if (dur > composeMedia.MAX_VIDEO_SECONDS) {
      setFFmpegStatus(`⚠ 動画が ${fmtSec(dur)} あります。スライダーで2分20秒以内にトリミングしてください`);
    } else {
      setFFmpegStatus('');
    }
  };
  wrap.style.display = 'block';

  // ドロップエリアをdim
  const drop = document.getElementById('x-img-drop');
  if (drop) { drop.style.opacity = '0.4'; drop.style.pointerEvents = 'none'; }

  // ファイル名＋削除ボタンをプレビューエリアに表示
  const preview = document.getElementById('x-img-preview');
  if (preview) {
    preview.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:5px 9px;background:var(--bg3);border-radius:6px;font-size:11px;color:var(--text2);width:100%">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file.name)}</span>
      <button onclick="removeXVideo()" style="padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:10px;font-family:inherit;flex-shrink:0">削除</button>
    </div>`;
  }
  updateXCrossPostControls();
  updXCC();
}

function removeXVideo() {
  xComposeMediaDraft.removeVideo();
  clearXVideoUI();
  updateXCrossPostControls();
  updXCC();
}

function clearXVideoUI() {
  const vid = document.getElementById('x-video-preview');
  if (vid) {
    vid.pause();
    vid.currentTime = 0;
    if (vid.src?.startsWith('blob:')) URL.revokeObjectURL(vid.src);
    vid.src = '';
    vid.load();
  }
  const wrap = document.getElementById('x-video-wrap');
  if (wrap) wrap.style.display = 'none';
  const drop = document.getElementById('x-img-drop');
  if (drop) { drop.style.opacity = '1'; drop.style.pointerEvents = ''; }
  const preview = document.getElementById('x-img-preview');
  if (preview) preview.innerHTML = '';
  setFFmpegStatus('');
}

function onTrimIn(val) {
  const vid = document.getElementById('x-video-preview');
  if (!vid?.duration) return;
  const result = xComposeMediaDraft.setTrimPercent('start', val);
  if (!result) return;
  if (result.percent !== parseFloat(val)) {
    document.getElementById('x-trim-in').value = result.percent;
  }
  vid.currentTime = result.trim.startSeconds;
  updateTrimLabels();
  updateTrimHighlight();
}

function onTrimOut(val) {
  const vid = document.getElementById('x-video-preview');
  if (!vid?.duration) return;
  const result = xComposeMediaDraft.setTrimPercent('end', val);
  if (!result) return;
  if (result.percent !== parseFloat(val)) {
    document.getElementById('x-trim-out').value = result.percent;
  }
  vid.currentTime = result.trim.endSeconds;
  updateTrimLabels();
  updateTrimHighlight();
  const trimDur = result.trimDurationSeconds;
  if (trimDur > composeMedia.MAX_VIDEO_SECONDS) {
    setFFmpegStatus(`⚠ トリム後の長さが ${fmtSec(trimDur)} です。2分20秒（140秒）以内にしてください`);
  } else {
    setFFmpegStatus('');
  }
}

function updateTrimLabels() {
  const vid = document.getElementById('x-video-preview');
  const dur = vid?.duration || 0;
  const video = xComposeMediaDraft.getSnapshot().video;
  const trimStart = video?.trim.startSeconds || 0;
  const trimEnd = video?.trim.endSeconds || dur;
  const trimDur = video?.trimDurationSeconds || dur;
  const startEl = document.getElementById('x-trim-start-label');
  const endEl   = document.getElementById('x-trim-end-label');
  const durEl   = document.getElementById('x-trim-dur-label');
  if (startEl) startEl.textContent = fmtSec(trimStart);
  if (endEl)   endEl.textContent   = fmtSec(trimEnd);
  if (durEl) {
    durEl.textContent = fmtSec(trimDur || dur);
    durEl.style.color = (trimDur || dur) > 140 ? 'var(--red)' : 'inherit';
  }
}

function updateTrimHighlight() {
  const inEl  = document.getElementById('x-trim-in');
  const outEl = document.getElementById('x-trim-out');
  const hl    = document.getElementById('x-trim-highlight');
  if (!inEl || !outEl || !hl) return;
  const inPct  = parseFloat(inEl.value);
  const outPct = parseFloat(outEl.value);
  hl.style.left  = inPct + '%';
  hl.style.width = (outPct - inPct) + '%';
}

// ── リセット ──
function resetXImgUI() {
  const container = document.getElementById('x-img-preview');
  if (container) {
    container.querySelectorAll('img').forEach(img => {
      if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    });
    container.innerHTML = '';
  }
  xComposeMediaDraft.clear();
  const drop = document.getElementById('x-img-drop');
  if (drop) { drop.style.opacity = '1'; drop.style.pointerEvents = ''; }
  const fi = document.getElementById('x-img-file');
  if (fi) fi.value = '';
  clearXVideoUI();
  updateXCrossPostControls();
  updXCC();
}

function updXCC() {
  const media = xComposeMediaDraft.getSnapshot();
  const n = document.getElementById('x-cta').value.length;
  const el = document.getElementById('x-cct');
  el.textContent = n + ' / 280';
  el.className = 'cc' + (n > 250 ? ' w' : '') + (n > 280 ? ' over' : '');
  // テキストが空でも画像か動画があれば投稿可能
  document.getElementById('x-sndb').disabled = (n === 0 && media.images.length === 0 && !media.video) || n > 280;
  renderComposePreview('x');
}

function toggleComposePreview(networkId) {
  const preview = document.getElementById(networkId === 'x' ? 'x-compose-preview' : 'b-compose-preview');
  if (!preview) return;
  preview.classList.toggle('on');
  renderComposePreview(networkId);
}

function renderComposePreview(networkId) {
  const isX = networkId === 'x';
  const media = isX
    ? xComposeMediaDraft.getSnapshot()
    : bskyComposeMediaDraft.getSnapshot();
  const preview = document.getElementById(isX ? 'x-compose-preview' : 'b-compose-preview');
  if (!preview) return;

  const text = document.getElementById(isX ? 'x-cta' : 'cta')?.value || '';
  const account = isX ? state.xs?.[selectedXIdx] : state.b;
  const crossPosting = isX
    ? Boolean(document.getElementById('x-cross-post-b')?.checked && !media.video)
    : Boolean(!replyTarget && document.getElementById('cross-post-x')?.checked);
  const targets = isX
    ? ['X', ...(crossPosting ? ['Bluesky'] : [])]
    : ['Bluesky', ...(crossPosting ? ['X'] : [])];
  const imageCount = media.images.length;
  const altCount = media.images.filter(image => image.altText).length;
  const hasVideo = isX && Boolean(media.video);
  const accountName = isX
    ? (account?.username || 'Xアカウント')
    : (account?.displayName || account?.handle || 'Blueskyアカウント');
  const initials = account?.initials || (isX ? 'X' : 'B');
  const avatar = !isX && account?.avatar
    ? `<img src="${esc(account.avatar)}" alt="">`
    : esc(initials);
  const attachmentText = hasVideo
    ? '動画 1本'
    : imageCount > 0
      ? `画像 ${imageCount}枚 / ALT入力 ${altCount}枚`
      : '添付なし';

  preview.innerHTML = `
    <div class="compose-preview-head">
      <div class="compose-preview-avatar" style="background:${account?.bg || 'var(--bg3)'}">${avatar}</div>
      <div class="compose-preview-account">${esc(accountName)}</div>
      <div class="compose-preview-targets">${targets.map(target => `<span class="compose-preview-target">${target}</span>`).join('')}</div>
    </div>
    <div class="compose-preview-text">${text ? esc(text) : '<span style="color:var(--text3)">本文なし</span>'}</div>
    <div class="compose-preview-attachments">${attachmentText}</div>`;
}

function updateXCrossPostControls() {
  const controls = document.getElementById('x-cross-post-controls');
  const checkbox = document.getElementById('x-cross-post-b');
  const note = document.getElementById('x-cross-post-note');
  if (!controls || !checkbox || !note) return;

  const available = Boolean(state.b);
  controls.style.display = available ? 'flex' : 'none';
  if (!available) {
    checkbox.checked = false;
    checkbox.disabled = false;
    note.textContent = '';
    return;
  }

  const videoUnsupported = Boolean(xComposeMediaDraft.getSnapshot().video);
  checkbox.disabled = videoUnsupported;
  checkbox.checked = videoUnsupported
    ? false
    : Boolean(state.composePreferences?.crossPostFromX);
  note.textContent = videoUnsupported ? '動画の同時投稿は未対応です' : '';
}

function toggleXCrossPost() {
  composeCoordinator.resetCrossPost();
  state.composePreferences.crossPostFromX = document.getElementById('x-cross-post-b').checked;
  saveState();
  updXCC();
}

function setXCrossPostDraftLocked(locked) {
  const textarea = document.getElementById('x-cta');
  const checkbox = document.getElementById('x-cross-post-b');
  const imageArea = document.getElementById('x-img-area');
  const accountSelect = document.getElementById('x-acc-select');
  if (textarea) textarea.readOnly = locked;
  if (checkbox) checkbox.disabled = locked || Boolean(xComposeMediaDraft.getSnapshot().video);
  if (imageArea) imageArea.style.pointerEvents = locked ? 'none' : '';
  if (accountSelect) accountSelect.style.pointerEvents = locked ? 'none' : '';
}

function executeXComposeDelivery(delivery, context = {}) {
  return xWebViewRuntime.executeCompose(
    delivery,
    context,
    (preparedDelivery, preparedContext) =>
      networkAdapters.executeComposeDelivery(preparedDelivery, preparedContext),
  );
}

async function doXOriginCrossPost(text) {
  const media = xComposeMediaDraft.getSnapshot();
  const account = state.xs?.[selectedXIdx];
  if (!account) { toast('Xアカウントを選択してください'); return; }
  if (!state.b) { toast('Bluesky にログインしていません'); return; }

  const xRequest = composeRequests.createComposeRequest({
    networkId: 'x',
    accountId: account.username || account.partition,
    text,
    images: media.images.map(image => ({ file: image.file })),
    replyTo: null,
  });
  const bRequest = composeRequests.createComposeRequest({
    networkId: 'b',
    accountId: state.b.did,
    text,
    images: media.images,
    replyTo: null,
  });
  const xDelivery = networkAdapters.prepareComposeDelivery(xRequest);
  const bDelivery = networkAdapters.prepareComposeDelivery(bRequest);
  const xCompletion = networkAdapters.prepareComposeCompletion(xRequest);
  const bCompletion = networkAdapters.prepareComposeCompletion(bRequest);

  const hasUnknown = composeCoordinator.getStatus('x').hasUnknownCross;
  let retryUnknown = false;
  if (hasUnknown) {
    retryUnknown = confirm(
      '投稿先で未投稿であることを確認しましたか？\n再試行すると重複投稿になる可能性があります。'
    );
    if (!retryUnknown) return;
  }

  setComposeBusy('xPostMod', 'x-sndb', true, 'X + Blueskyへ送信中...');
  const result = await composeCoordinator.submitCrossPost([
    {
      id: 'x',
      request: xRequest,
      deliver: () => executeXComposeDelivery(xDelivery),
      completionPlan: xCompletion,
    },
    {
      id: 'b',
      request: bRequest,
      deliver: () => networkAdapters.executeComposeDelivery(bDelivery),
      completionPlan: bCompletion,
    },
  ], { retryUnknown });
  setComposeBusy('xPostMod', 'x-sndb', false);

  if (result.status === 'succeeded') {
    closeOv('xPostMod');
    toast('XとBlueskyへ投稿しました');
    return;
  }

  setXCrossPostDraftLocked(true);
  setComposeButtonLabel('x-sndb', result.status === 'unknown' ? '確認後に再試行' : '失敗分を再試行');
  const failed = result.results.filter(target => target.status !== 'succeeded')
    .map(target => target.id === 'x' ? 'X' : 'Bluesky')
    .join(' / ');
  toast(result.status === 'unknown'
    ? `${failed}の投稿結果を確認できませんでした`
    : `${failed}への投稿に失敗しました`);
}

async function doXPost() {
  const media = xComposeMediaDraft.getSnapshot();
  const crossPosting = Boolean(document.getElementById('x-cross-post-b')?.checked && state.b && !media.video);
  const composeStatus = composeCoordinator.getStatus('x');
  if (composeStatus.isSending) return;
  if (!crossPosting && composeStatus.hasUnknownSingle) {
    const confirmedMissing = confirm(
      'X上で投稿されていないことを確認しましたか？\n再試行すると重複投稿になる可能性があります。'
    );
    if (!confirmedMissing) return;
  }
  const text = document.getElementById('x-cta').value.trim();
  if (!text && media.images.length === 0 && !media.video) return;
  if (crossPosting) {
    await doXOriginCrossPost(text);
    return;
  }

  const acc = state.xs?.[selectedXIdx];
  if (!acc) { toast('Xアカウントを選択してください'); return; }

  // 動画の長さチェック
  if (media.video) {
    const trimDur = media.video.trimDurationSeconds;
    if (trimDur > 140) {
      toast(`動画が長すぎます（${fmtSec(trimDur)}）。2分20秒以内にトリミングしてください`);
      return;
    }
  }

  const request = composeRequests.createComposeRequest({
    networkId: 'x',
    accountId: acc.username || acc.partition,
    text,
    images: media.images.map(image => ({ file: image.file })),
    video: media.video
      ? {
          file: media.video.file,
          trim: media.video.trim,
        }
      : null,
  });
  const delivery = networkAdapters.prepareComposeDelivery(request);
  const completionPlan = networkAdapters.prepareComposeCompletion(request);

  setComposeBusy('xPostMod', 'x-sndb', true, '送信中…');
  const result = await composeCoordinator.submitSingle({
    networkId: 'x',
    request,
    deliver: () => executeXComposeDelivery(delivery, {
      videoPath: media.video?.path || null,
      videoDuration: media.video?.durationSeconds || 0,
    }),
    completionPlan,
  });

  setComposeBusy('xPostMod', 'x-sndb', false);
  if (result.status === 'succeeded') {
    closeOv('xPostMod');
    return;
  }

  if (result.status === 'unknown') {
    setComposeButtonLabel('x-sndb', '確認後に再試行');
    toast('投稿結果を確認できませんでした。X上で投稿状況を確認してください');
    return;
  }

  setFFmpegStatus('');
  setComposeButtonLabel('x-sndb', '再試行');
  toast('X post error: ' + result.error.message);
}

function updateCrossPostControls() {
  const controls = document.getElementById('cross-post-controls');
  const checkbox = document.getElementById('cross-post-x');
  const select = document.getElementById('cross-post-x-account');
  const accounts = state.xs || [];
  const available = !replyTarget && accounts.length > 0;
  controls.style.display = available ? 'flex' : 'none';
  if (!available) {
    checkbox.checked = false;
    select.style.display = 'none';
    composeCoordinator.resetCrossPost();
    updCC();
    return;
  }

  checkbox.checked = Boolean(state.composePreferences?.crossPostFromBluesky);
  select.innerHTML = accounts.map((account, index) => (
    `<option value="${index}">${esc(account.username)}</option>`
  )).join('');
  select.style.display = checkbox.checked ? 'block' : 'none';
  updCC();
}

function toggleCrossPost() {
  composeCoordinator.resetCrossPost();
  const checked = document.getElementById('cross-post-x').checked;
  state.composePreferences.crossPostFromBluesky = checked;
  saveState();
  document.getElementById('cross-post-x-account').style.display = checked
    ? 'block'
    : 'none';
  updCC();
}

function setCrossPostDraftLocked(locked) {
  const textarea = document.getElementById('cta');
  const checkbox = document.getElementById('cross-post-x');
  const select = document.getElementById('cross-post-x-account');
  const imageArea = document.getElementById('b-img-area');
  if (textarea) textarea.readOnly = locked;
  if (checkbox) checkbox.disabled = locked;
  if (select) select.disabled = locked;
  if (imageArea) imageArea.style.pointerEvents = locked ? 'none' : '';
}

function updCC() {
  const media = bskyComposeMediaDraft.getSnapshot();
  const n = document.getElementById('cta').value.length;
  const el = document.getElementById('cct');
  const crossPosting = !replyTarget && document.getElementById('cross-post-x')?.checked;
  const limit = crossPosting ? 280 : 300;
  document.getElementById('cta').maxLength = limit;
  el.textContent = `${n} / ${limit}`;
  el.className = 'cc' + (n > limit - 40 ? ' w' : '') + (n > limit ? ' over' : '');
  document.getElementById('sndb').disabled = (n === 0 && media.images.length === 0) || n > limit;
  renderComposePreview('b');
}

// ─── BLUESKY 画像添付 ────────────────────────────
function handleBImgDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-on');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  addBImgFiles(files);
}

function addBImgFiles(files) {
  const result = bskyComposeMediaDraft.addFiles(files);
  if (result.status === 'rejected') { toast('画像は最大4枚まで'); return; }
  if (result.status !== 'images-added') return;
  renderBImgPreviews();
  const fi = document.getElementById('b-img-file');
  if (fi) fi.value = '';
  updCC();
}

function removeBImg(idx) {
  bskyComposeMediaDraft.removeImage(idx);
  renderBImgPreviews();
  updCC();
}

function renderBImgPreviews() {
  const container = document.getElementById('b-img-preview');
  if (!container) return;
  container.querySelectorAll('img').forEach(img => {
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  });
  const { images } = bskyComposeMediaDraft.getSnapshot();
  container.innerHTML = images.map((image, i) => {
    const url = URL.createObjectURL(image.file);
    return `<div style="position:relative;width:100%;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--bg3);margin-bottom:5px;border:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;padding:5px 8px">
        <img src="${url}" style="width:52px;height:52px;object-fit:cover;border-radius:4px;flex-shrink:0">
        <input type="text" placeholder="Alt テキスト（画像の説明）" maxlength="1000"
          id="b-alt-${i}"
          style="flex:1;background:transparent;border:none;color:var(--text2);font-size:11px;font-family:inherit;outline:none;min-width:0"
          value="${esc(image.altText)}"
          oninput="updateBImgAlt(${i},this.value)">
        <button onclick="removeBImg(${i})"
          style="width:18px;height:18px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;font-size:10px;padding:0;font-family:inherit;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>
    </div>`;
  }).join('');
  const drop = document.getElementById('b-img-drop');
  if (drop) drop.style.opacity = images.length >= composeMedia.MAX_IMAGE_COUNT ? '0.4' : '1';
}

function updateBImgAlt(index, value) {
  bskyComposeMediaDraft.updateAlt(index, value);
  renderComposePreview('b');
}

function resetBImgUI() {
  const container = document.getElementById('b-img-preview');
  if (container) {
    container.querySelectorAll('img').forEach(img => {
      if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    });
    container.innerHTML = '';
  }
  bskyComposeMediaDraft.clear();
  const drop = document.getElementById('b-img-drop');
  if (drop) { drop.style.opacity = '1'; }
  const fi = document.getElementById('b-img-file');
  if (fi) fi.value = '';
}

function openImg(urls, startIndex = 0) {
  lightboxRuntime.open(urls, startIndex);
}

function lbMove(dir) {
  lightboxRuntime.move(dir);
}

function lbClose(e) {
  lightboxRuntime.close(e);
}

async function resolveMentionDids(facets, jwt) {
  return bskyRichText.resolveMentionDids(facets, async handle => {
    const res = await apiGet('com.atproto.identity.resolveHandle', { handle }, jwt);
    return res.did;
  });
}

async function doCrossPost(text) {
  const media = bskyComposeMediaDraft.getSnapshot();
  const accountIndex = Number(document.getElementById('cross-post-x-account')?.value || 0);
  const account = state.xs?.[accountIndex];
  if (!account) { toast('Xアカウントを選択してください'); return; }

  const bRequest = composeRequests.createComposeRequest({
    networkId: 'b',
    accountId: state.b.did,
    text,
    images: media.images,
    replyTo: null,
  });
  const xRequest = composeRequests.createComposeRequest({
    networkId: 'x',
    accountId: account.username || account.partition,
    text,
    images: media.images.map(image => ({ file: image.file })),
    replyTo: null,
  });
  const bDelivery = networkAdapters.prepareComposeDelivery(bRequest);
  const xDelivery = networkAdapters.prepareComposeDelivery(xRequest);
  const bCompletion = networkAdapters.prepareComposeCompletion(bRequest);
  const xCompletion = networkAdapters.prepareComposeCompletion(xRequest);

  const hasUnknown = composeCoordinator.getStatus('b').hasUnknownCross;
  let retryUnknown = false;
  if (hasUnknown) {
    retryUnknown = confirm('X上で投稿されていないことを確認しましたか？\n再試行すると重複投稿になる可能性があります。');
    if (!retryUnknown) return;
  }

  setComposeBusy('compMod', 'sndb', true, 'X + Blueskyへ送信中...');
  const result = await composeCoordinator.submitCrossPost([
    {
      id: 'x',
      request: xRequest,
      deliver: () => executeXComposeDelivery(xDelivery),
      completionPlan: xCompletion,
    },
    {
      id: 'b',
      request: bRequest,
      deliver: () => networkAdapters.executeComposeDelivery(bDelivery),
      completionPlan: bCompletion,
    },
  ], { retryUnknown });
  setComposeBusy('compMod', 'sndb', false);

  if (result.status === 'succeeded') {
    closeOv('compMod');
    toast('XとBlueskyへ投稿しました');
    return;
  }

  setCrossPostDraftLocked(true);
  setComposeButtonLabel('sndb', result.status === 'unknown' ? '確認後に再試行' : '失敗分を再試行');
  const failed = result.results.filter(target => target.status !== 'succeeded')
    .map(target => target.id === 'x' ? 'X' : 'Bluesky')
    .join(' / ');
  toast(result.status === 'unknown'
    ? 'Xの投稿結果を確認できませんでした'
    : `${failed}への投稿に失敗しました`);
}

async function doSend() {
  const media = bskyComposeMediaDraft.getSnapshot();
  if (composeCoordinator.getStatus('b').isSending) return;
  const text = document.getElementById('cta').value.trim();
  if (!text && media.images.length === 0) return;
  if (!state.b) { toast('Bluesky にログインしていません'); return; }
  if (!replyTarget && document.getElementById('cross-post-x')?.checked) {
    await doCrossPost(text);
    return;
  }

  const request = composeRequests.createComposeRequest({
    networkId: 'b',
    accountId: state.b.did,
    text,
    images: media.images,
    replyTo: replyTarget
      ? {
          root: {
            uri: replyTarget.rootUri || replyTarget.uri,
            cid: replyTarget.rootCid || replyTarget.cid,
          },
          parent: { uri: replyTarget.uri, cid: replyTarget.cid },
        }
      : null,
  });
  const delivery = networkAdapters.prepareComposeDelivery(request);
  const completionPlan = networkAdapters.prepareComposeCompletion(request);

  setComposeBusy('compMod', 'sndb', true, '送信中…');
  const result = await composeCoordinator.submitSingle({
    networkId: 'b',
    request,
    deliver: () => networkAdapters.executeComposeDelivery(delivery),
    completionPlan,
  });

  setComposeBusy('compMod', 'sndb', false);
  if (result.status === 'succeeded') {
    closeOv('compMod');
    return;
  }

  setComposeButtonLabel('sndb', '再試行');
  toast(`Post error: ${result.error.message}`);
}

// ─── ADD COLUMN MODAL ───────────────────────────
function buildOptGrid() {
  const og = document.getElementById('opt-grid');
  og.innerHTML = '';

  // X: アカウントごとにセクションを分けて表示
  if (state.xs && state.xs.length > 0) {
    const xDefinitions = networkAdapters.getColumnDefinitions('x');
    state.xs.forEach((acc, idx) => {
      og.innerHTML += `<div style="grid-column:1/-1;font-size:10px;font-weight:600;color:var(--text3);letter-spacing:.06em;margin-top:${idx > 0 ? 10 : 0}px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="display:inline-flex;align-items:center;gap:5px">
          <span style="width:14px;height:14px;border-radius:50%;background:${acc.bg};display:inline-flex;align-items:center;justify-content:center;font-size:7px;color:#000;font-weight:700">${acc.initials}</span>
          X · ${esc(acc.username)}
        </span>
      </div>`;
      xDefinitions.forEach(def => {
        og.innerHTML += mkOptX(def.id, def.icon, def.label, def.description, idx);
      });
    });
  }

  // Bluesky
  if (state.b) {
    if (state.xs && state.xs.length > 0) {
      og.innerHTML += `<div style="grid-column:1/-1;font-size:10px;font-weight:600;color:var(--text3);letter-spacing:.06em;margin-top:10px;padding:4px 0;border-bottom:1px solid var(--border)">Bluesky · @${state.b.handle}</div>`;
    }
    networkAdapters.getColumnDefinitions('b').filter(def => def.picker !== false).forEach(def => {
      og.innerHTML += mkOpt(def.id, def.icon, def.label, def.description, false, 'b');
    });
  }

  og.innerHTML += `<div style="grid-column:1/-1;font-size:10px;font-weight:600;color:var(--text3);letter-spacing:.06em;margin-top:10px;padding:4px 0;border-bottom:1px solid var(--border)">情報</div>`;
  networkAdapters.getColumnDefinitions('anime').filter(def => def.picker !== false).forEach(def => {
    og.innerHTML += mkOpt(def.id, def.icon, def.label, def.description, false, 'anime');
  });
}

function mkOptX(type, icon, name, desc, accountIdx) {
  return `<button class="opt" onclick="addColFromModal('${type}','x',${accountIdx})">
    <div style="width:16px;height:16px;margin-bottom:5px">${icon}</div>
    <div class="oname">${name}</div>
    <div class="odesc">${desc}</div>
  </button>`;
}

function mkOpt(id, icon, name, desc, disabled, plat) {
  return `<button class="opt${disabled ? ' disabled' : ''}" onclick="addColFromModal('${id}','${plat}')">
    <div style="width:16px;height:16px;margin-bottom:5px">${icon}</div>
    <div class="oname">${name}</div>
    <div class="odesc">${desc}</div>
  </button>`;
}

let extraColN = 0;
function nextColumnId(prefix) {
  let id;
  do {
    extraColN += 1;
    id = `${prefix}-${extraColN}`;
  } while (document.getElementById(`col-${id}`));
  return id;
}

function addColFromModal(definitionId, network, accountIdx) {
  closeOv('addMod');
  // X: アカウントindexをIDに含めて一意にする
  const id = network === 'x'
    ? nextColumnId(`x${accountIdx}-${definitionId}`)
    : nextColumnId(definitionId);
  const xAccount = network === 'x' ? state.xs?.[accountIdx ?? 0] : null;
  const result = columnLifecycle.create({
    networkId: network,
    definitionId,
    id,
    account: xAccount ? { ...xAccount, index: accountIdx ?? 0 } : null,
  });

  if (result.status === 'input-required' && result.plan.input === 'x-list') {
    openXListDialog(accountIdx);
    return;
  }
  if (result.status !== 'created') {
    toast('Column type is unavailable');
    return;
  }

  const cols = document.getElementById('cols');
  const lastCol = cols.querySelector('.col:last-of-type');
  if (lastCol) lastCol.scrollIntoView({ behavior: 'smooth', inline: 'end' });
  toast('Column added');
}

function openColSettings(id, colType) {
  const ms = columnLifecycle.getRefreshInterval(id, DEFAULT_INTERVAL_MS);
  const cur = Math.round(ms / 1000);
  const curFs = parseInt(localStorage.getItem(`col_fs_${id}`)) || 13;
  document.getElementById('col-settings-ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'ov on'; ov.id = 'col-settings-ov';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div class="modal" style="width:300px">
    <h2 style="margin-bottom:14px">Column settings</h2>
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Auto refresh interval</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      ${[15,30,60,120,300,0].map(s=>`<button onclick="applyInterval('${id}',${s*1000})"
        style="padding:5px 11px;border-radius:6px;border:1px solid ${cur===s?'var(--accent)':'var(--border2)'};background:${cur===s?'var(--accent-dim)':'transparent'};color:${cur===s?'var(--accent)':'var(--text2)'};cursor:pointer;font-size:12px;font-family:inherit">
        ${s===0?'OFF':s<60?s+' sec':s/60+' min'}</button>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Font size</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      ${[11,12,13,14,15,16].map(fs=>`<button onclick="applyColFontSize('${id}','${colType}',${fs})"
        style="padding:5px 11px;border-radius:6px;border:1px solid ${curFs===fs?'var(--accent)':'var(--border2)'};background:${curFs===fs?'var(--accent-dim)':'transparent'};color:${curFs===fs?'var(--accent)':'var(--text2)'};cursor:pointer;font-size:12px;font-family:inherit">
        ${fs}px</button>`).join('')}
    </div>
    <button onclick="document.getElementById('col-settings-ov').remove()" class="btn-cancel">Close</button>
  </div>`;
  document.body.appendChild(ov);
}
function applyInterval(id, ms) {
  columnLifecycle.setRefreshInterval(id, ms);
  const label = ms===0?'OFF':ms<60000?(ms/1000)+' sec':(ms/60000)+' min';
  toast('Auto refresh: '+label);
  document.getElementById('col-settings-ov')?.remove();
  columnLifecycle.persist();
}

function applyColFontSize(id, colType, fs) {
  localStorage.setItem(`col_fs_${id}`, fs);
  if (colType === 'wv') {
    xWebViewRuntime.setFontSize(id, fs);
  } else {
    // Bskyのfeedにfont-sizeを適用
    const feed = document.getElementById(`feed-${id}`);
    if (feed) feed.style.fontSize = fs + 'px';
  }
  toast(`文字サイズ: ${fs}px`);
  document.getElementById('col-settings-ov')?.remove();
}

function showPostMenu(e, handle) {
  e.preventDefault();
  document.getElementById('post-ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'post-ctx-menu';
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:4px;z-index:500;min-width:160px;box-shadow:0 4px 20px rgba(0,0,0,.5)`;
  menu.innerHTML = `
    <div onclick="addNgUser('${esc(handle)}')" style="padding:7px 12px;font-size:12px;cursor:pointer;border-radius:5px;color:var(--text1);display:flex;align-items:center;gap:8px"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
      @${esc(handle)} をミュート
    </div>
    <div onclick="copyHandle('${esc(handle)}')" style="padding:7px 12px;font-size:12px;cursor:pointer;border-radius:5px;color:var(--text1);display:flex;align-items:center;gap:8px"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      ハンドルをコピー
    </div>
  `;
  document.body.appendChild(menu);
  const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
  setTimeout(() => document.addEventListener('click', closeMenu), 50);
}
function addNgUser(handle) {
  const { value: clean } = muteRules.add('user', handle);
  if (!clean) return;
  toast(`@${clean} をミュートしました`);
  document.getElementById('post-ctx-menu')?.remove();
  refilterBskyCols(); // 即時反映
}
function copyHandle(handle) {
  navigator.clipboard?.writeText('@' + handle).then(() => toast('コピーしました'));
  document.getElementById('post-ctx-menu')?.remove();
}

function renderNotifIcons() {
  const el = document.getElementById('sb-notif-icons');
  if (!el) return;
  el.innerHTML = '';
  if (!(state.xs || []).length && !state.b) return;

  const unreadCount = state.b ? notificationRuntime.getUnreadCount() : 0;
  const btn = document.createElement('button');
  btn.className = 'si';
  btn.title = '通知センター';
  btn.id = 'sb-notif-b';
  btn.innerHTML = `
    <span style="position:relative;display:flex;align-items:center;justify-content:center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span id="bsky-notif-badge" style="position:absolute;top:-6px;right:-7px;min-width:14px;height:14px;border-radius:7px;background:var(--red);color:#fff;font-size:8px;font-weight:700;display:${unreadCount > 0 ? 'flex' : 'none'};align-items:center;justify-content:center;padding:0 2px;line-height:1">${unreadCount > 99 ? '99+' : unreadCount}</span>
    </span>`;
  btn.onclick = openNotificationCenter;
  el.appendChild(btn);

  if (state.b) startNotifPoll();
}

let notificationCenterItems = [];
let xNotificationCenterItems = [];
let visibleNotificationCenterItems = [];
let xNotificationCenterErrors = [];
let notificationCenterNetwork = 'all';

function openNotificationCenter() {
  notificationCenterNetwork = 'all';
  document.querySelectorAll('.notif-center-tab').forEach(button => {
    button.classList.toggle('on', button.dataset.network === 'all');
  });
  document.getElementById('notifCenterMod').classList.add('on');
  renderNotificationCenter();
  loadNotificationCenter();
}

function setNotificationNetwork(networkId) {
  notificationCenterNetwork = networkId;
  document.querySelectorAll('.notif-center-tab').forEach(button => {
    button.classList.toggle('on', button.dataset.network === networkId);
  });
  renderNotificationCenter();
}

async function openAbout() {
  const modal = document.getElementById('aboutMod');
  const version = document.getElementById('about-version');
  if (!modal || !version) return;
  try {
    const appVersion = await window.electronAPI?.getAppVersion?.();
    version.textContent = `Version ${appVersion || '開発版'}`;
  } catch {
    version.textContent = 'Version 開発版';
  }
  modal.classList.add('on');
}

function checkForUpdates() {
  const button = document.getElementById('check-update-btn');
  const status = document.getElementById('update-status');
  if (button) button.disabled = true;
  if (status) status.textContent = '更新を確認しています…';
  window.electronAPI?.checkForUpdates?.();
}

function installUpdate() {
  window.electronAPI?.installUpdate?.();
}

function renderUpdateStatus(update) {
  const status = document.getElementById('update-status');
  const checkButton = document.getElementById('check-update-btn');
  const installButton = document.getElementById('install-update-btn');
  if (!status || !checkButton || !installButton || !update) return;

  checkButton.disabled = update.status === 'checking' || update.status === 'downloading';
  installButton.style.display = update.status === 'downloaded' ? '' : 'none';

  const messages = {
    checking: '更新を確認しています…',
    available: `Version ${update.version} を取得しています…`,
    downloading: `更新をダウンロードしています… ${update.percent ?? 0}%`,
    downloaded: `Version ${update.version} を適用できます。`,
    'not-available': '最新バージョンです。',
    development: '更新確認はインストール版で利用できます。',
    error: update.message || '更新を確認できませんでした。',
  };
  status.textContent = messages[update.status] || '';
}

async function loadNotificationCenter() {
  const list = document.getElementById('notif-center-list');
  if (list) list.innerHTML = '<div class="notif-center-state">通知を読み込んでいます…</div>';
  if (E2E_FIXTURES && E2E_FIXTURES.useNotificationReaders !== true) {
    notificationCenterItems = (E2E_FIXTURES.blueskyNotifications || [])
      .map(notificationCenter.normalizeBskyNotification);
    xNotificationCenterItems = (E2E_FIXTURES.xNotifications || []).map(raw => {
      const accountIndex = Number(raw.accountIndex) || 0;
      return notificationCenter.normalizeXNotification(raw, {
        accountIndex,
        account: state.xs?.[accountIndex] || {},
      });
    });
    xNotificationCenterErrors = [];
    renderNotificationCenter();
    return;
  }
  const blueskyTask = state.b
    ? bskyCallWithRefresh(jwt => bsky.notifications(jwt, 80))
      .then(data => { notificationCenterItems = (data.notifications || []).map(notificationCenter.normalizeBskyNotification); })
    : Promise.resolve().then(() => { notificationCenterItems = []; });
  const xTask = loadXNotificationCenter();
  const [blueskyResult] = await Promise.allSettled([blueskyTask, xTask]);
  renderNotificationCenter();
  if (blueskyResult.status === 'rejected' && notificationCenterNetwork === 'b' && list) {
    list.innerHTML = `<div class="notif-center-state">Bluesky通知を取得できませんでした<br>${esc(blueskyResult.reason?.message || '')}</div>`;
  }
}

async function loadXNotificationsForAccount(account, accountIndex) {
  const rawItems = await xWebViewRuntime.listNotifications({
    accountId: account.username || account.partition || `persist:x-${accountIndex}`,
    host: document.getElementById('notif-center-x-readers'),
    script: notificationCenter.buildXNotificationExtractionScript(40),
  });
  return (rawItems || []).map(raw => notificationCenter.normalizeXNotification(raw, {
    account,
    accountIndex,
  }));
}

async function loadXNotificationCenter() {
  if (!IS_ELECTRON || !(state.xs || []).length) {
    xNotificationCenterItems = [];
    xNotificationCenterErrors = [];
    return;
  }
  const results = await Promise.allSettled(
    state.xs.map((account, index) => loadXNotificationsForAccount(account, index))
  );
  xNotificationCenterItems = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  xNotificationCenterErrors = results.flatMap((result, index) => result.status === 'rejected'
    ? [{ accountIndex: index, message: result.reason?.message || '取得できませんでした' }]
    : []);
}

function renderNotificationCenter() {
  const xArea = document.getElementById('notif-center-x');
  const list = document.getElementById('notif-center-list');
  if (!xArea || !list) return;

  const showX = ['all', 'x'].includes(notificationCenterNetwork) && (state.xs || []).length > 0;
  xArea.classList.toggle('show', showX);
  xArea.innerHTML = showX
    ? (state.xs || []).map((account, index) => `
      <button class="notif-x-account" data-x-index="${index}">
        <span style="background:${account.bg || 'var(--text2)'}">${esc(account.initials || 'X')}</span>
        ${esc(account.username)} の通知カラム
      </button>`).join('')
    : '';
  xArea.querySelectorAll('[data-x-index]').forEach(button => {
    button.addEventListener('click', () => {
      closeOv('notifCenterMod');
      goToNotifCol('x', Number(button.dataset.xIndex));
    });
  });

  const reasonSelect = document.getElementById('notif-center-reason');
  const unreadInput = document.getElementById('notif-center-unread');
  if (reasonSelect) reasonSelect.disabled = false;
  if (unreadInput) {
    unreadInput.disabled = notificationCenterNetwork === 'x' || !state.b;
    if (notificationCenterNetwork === 'x') unreadInput.checked = false;
  }
  document.querySelector('.notif-center-tools .mark-read').disabled = notificationCenterNetwork === 'x' || !state.b;

  if (notificationCenterNetwork === 'b' && !state.b) {
    list.innerHTML = '<div class="notif-center-state">Blueskyにログインすると通知がここに表示されます</div>';
    return;
  }

  const sourceItems = notificationCenterNetwork === 'x'
    ? xNotificationCenterItems
    : notificationCenterNetwork === 'b'
      ? notificationCenterItems
      : [...xNotificationCenterItems, ...notificationCenterItems].sort((left, right) => {
          const leftTime = Date.parse(left.indexedAt) || 0;
          const rightTime = Date.parse(right.indexedAt) || 0;
          return rightTime - leftTime;
        });
  const filtered = notificationCenter.filterNotifications(sourceItems, {
    reason: reasonSelect?.value || 'all',
    unreadOnly: Boolean(unreadInput?.checked),
  });
  visibleNotificationCenterItems = filtered;
  if (!filtered.length) {
    const xFailed = ['all', 'x'].includes(notificationCenterNetwork) && xNotificationCenterErrors.length > 0;
    list.innerHTML = xFailed
      ? '<div class="notif-center-state">X通知を取得できませんでした。上のボタンから通知カラムを開いて確認できます</div>'
      : '<div class="notif-center-state">条件に一致する通知はありません</div>';
    return;
  }

  const labels = {
    like: 'さんがあなたの投稿をいいねしました',
    repost: 'さんがあなたの投稿をリポストしました',
    follow: 'さんがあなたをフォローしました',
    reply: 'さんがあなたに返信しました',
    mention: 'さんがあなたをメンションしました',
    quote: 'さんがあなたの投稿を引用しました',
  };
  list.innerHTML = filtered.map((item, index) => {
    const actor = item.author || {};
    const excerptText = item.networkId === 'x' ? item.text : item.raw?.record?.text;
    const excerpt = excerptText ? `<div class="notif-handle">${esc(excerptText)}</div>` : `<div class="notif-handle">@${esc(actor.handle || '')}</div>`;
    const avatar = item.networkId === 'x'
      ? `<div class="av" style="width:32px;height:32px;background:${item.account?.bg || avBgFor(actor.handle)};font-size:9px">${actor.avatar ? `<img src="${esc(actor.avatar)}" loading="lazy">` : esc((actor.displayName || actor.handle || 'X').slice(0, 2).toUpperCase())}</div>`
      : renderAvatar(actor, 32);
    const timeLabel = item.indexedAt ? relTime(item.indexedAt) : (item.account?.username || 'X');
    return `<div class="notif-center-item ${item.isRead === false ? 'unread' : ''}" data-notification-index="${index}" role="button" tabindex="0">
      ${avatar}
      <div class="notif-copy"><div class="notif-title"><strong>${esc(actor.displayName || actor.handle || 'ユーザー')}</strong>${esc(labels[item.reason] || 'さんから通知があります')}</div>${excerpt}</div>
      <div class="notif-time">${esc(timeLabel)}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-notification-index]').forEach(element => {
    const activate = () => openNotificationCenterItem(Number(element.dataset.notificationIndex));
    element.addEventListener('click', activate);
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
    });
  });
}

function openNotificationCenterItem(index) {
  const item = visibleNotificationCenterItems[index];
  if (!item) return;
  closeOv('notifCenterMod');
  if (item.networkId === 'x') {
    openXNotificationCenterItem(item);
    return;
  }
  if (item.targetUri) {
    const handle = ['like', 'repost'].includes(item.reason) ? state.b?.handle : item.author?.handle;
    openBskyPost({ target: document.body, preventDefault() {} }, item.targetUri, handle || state.b?.handle || 'post');
    return;
  }
  if (item.author?.did) showProfile(item.author.did);
}

async function openXNotificationCenterItem(item) {
  const account = state.xs?.[item.accountIndex];
  if (!account) return;
  const targetCol = goToNotifCol('x', item.accountIndex);
  const columnId = targetCol?.id?.replace(/^col-/, '');
  if (!columnId) return;

  try {
    const result = await xWebViewRuntime.openNotificationTarget({
      columnId,
      item,
      notificationUrl: 'https://x.com/notifications',
      activationScript: notificationCenter.buildXNotificationActivationScript(item.raw),
    });
    if (result.status === 'not-found') {
      toast('対象のポストを通知ページで見つけられませんでした');
    }
  } catch (error) {
    console.warn('X notification target could not be opened:', error);
    toast('対象のポストを開けませんでした');
  }
}

async function markNotificationCenterRead() {
  if (!state.b) return;
  try {
    await bskyCallWithRefresh(jwt => bsky.updateSeen(jwt, new Date().toISOString()));
    notificationCenterItems = notificationCenterItems.map(item => ({ ...item, isRead: true }));
    notificationRuntime.clearUnread();
    renderNotificationCenter();
    toast('Bluesky通知をすべて既読にしました');
  } catch (error) {
    toast('既読にできませんでした: ' + error.message);
  }
}

function scrollToNotifCol(baseId, xIdx, acc) {
  const cols = document.getElementById('cols');

  let targetCol = null;
  if (xIdx >= 0 && acc) {
    const partition = acc.partition || `persist:x-${xIdx}`;
    targetCol = notificationCenter.findXNotificationColumn(
      cols.querySelectorAll('.col'),
      partition
    );
  } else {
    // Bluesky通知
    targetCol = document.getElementById(`col-${baseId}`);
  }

  if (targetCol) {
    // 既存カラムにスクロール
    targetCol.scrollIntoView({ behavior: 'smooth', inline: 'start' });
    targetCol.style.outline = '2px solid var(--accent)';
    setTimeout(() => { targetCol.style.outline = ''; }, 1200);
  } else {
    // カラムがなければ追加
    if (xIdx >= 0 && acc) {
      const id = nextColumnId(`x${xIdx}-x-notif-new`);
      const result = columnLifecycle.create({
        networkId: 'x',
        definitionId: 'x-notif-new',
        id,
        account: { ...acc, index: xIdx },
      });
      if (result.status !== 'created') {
        toast('Notifications column could not be added');
        return;
      }
      setTimeout(() => {
        const newCol = document.getElementById(`col-${id}`);
        if (newCol) newCol.scrollIntoView({ behavior: 'smooth', inline: 'start' });
      }, 300);
      toast(`${acc.username} notifications column added`);
    } else {
      // Bluesky通知カラムを追加
      const result = columnLifecycle.create({
        networkId: 'b', definitionId: 'b-notif-new', id: 'b-notif',
      });
      if (result.status !== 'created') {
        toast('Notifications column could not be added');
        return;
      }
      setTimeout(() => {
        const newCol = document.getElementById('col-b-notif');
        if (newCol) newCol.scrollIntoView({ behavior: 'smooth', inline: 'start' });
      }, 300);
      toast('Bluesky notifications column added');
    }
  }
}

// Bluesky未読通知数をポーリング
function startNotifPoll() {
  notificationRuntime.startPoll(fetchBskyUnread);
}

async function fetchBskyUnread() {
  if (!state.b) return 0;
  const data = await bskyCallWithRefresh(jwt =>
    apiGet('app.bsky.notification.getUnreadCount', {}, jwt)
  );
  return data.count || 0;
}

// ─── SCROLL TO START ────────────────────────────
function scrollColsToStart() {
  const cols = document.getElementById('cols');
  cols.scrollTo({ left: 0, behavior: 'smooth' });
}

async function refreshAll() {
  await columnLifecycle.refreshAll({ force: true });
  toast('Refreshing all feeds...');
}

// ─── UTILS ─────────────────────────────────────
// ─── NOTIF SHORTCUTS & SCROLL ───────────────────

function goToNotifCol(plat, xIdx) {
  let targetCol = null;

  if (plat === 'x') {
    const acc = state.xs?.[xIdx];
    if (!acc) return;
    const xPart = acc.partition || `persist:x-${xIdx}`;
    targetCol = notificationCenter.findXNotificationColumn(
      document.querySelectorAll('.col'),
      xPart
    );
    if (!targetCol) {
      const id = `x${xIdx}-notif-auto`;
      const result = columnLifecycle.create({
        networkId: 'x',
        definitionId: 'x-notif-new',
        id,
        account: { ...acc, index: xIdx, partition: xPart },
      });
      if (result.status !== 'created') {
        toast('Notifications column could not be added');
        return;
      }
      targetCol = document.getElementById(`col-${id}`);
      toast(`${acc.username} notifications column added`);
    }
  } else {
    document.querySelectorAll('.col').forEach(col => {
      const feed = col.querySelector('.feed');
      if (feed && feed.id && feed.id.includes('notif')) targetCol = col;
    });
    if (!targetCol) {
      const id = 'b-notif-auto';
      const result = columnLifecycle.create({
        networkId: 'b', definitionId: 'b-notif-new', id,
      });
      if (result.status !== 'created') {
        toast('Notifications column could not be added');
        return;
      }
      targetCol = document.getElementById(`col-${id}`);
      toast('Bluesky notifications column added');
    }
  }

  // カラムにスクロール
  if (targetCol) {
    targetCol.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    targetCol.style.outline = '2px solid var(--accent)';
    setTimeout(() => { targetCol.style.outline = ''; }, 1200);
  }
  return targetCol;
}

// Bluesky未読通知数を取得してバッジ更新
async function fetchBskyUnreadCount() {
  if (!state.b) return;
  try {
    notificationRuntime.setUnreadCount(await fetchBskyUnread());
  } catch {}
}

// Bluesky通知を既読化してバッジを消す
async function markBskyNotifsRead() {
  if (!state.b) return;
  try {
    await bskyCallWithRefresh(jwt =>
      bsky.updateSeen(jwt, new Date().toISOString())
    );
    notificationRuntime.clearUnread();
    toast('Notifications marked as read');
  } catch (e) {
    toast('Mark read error: ' + e.message);
  }
}

async function goToNotifColAndRead() {
  goToNotifCol('b');
  await markBskyNotifsRead();
}

// ─── MEMORY MANAGEMENT ──────────────────────────

function startMemoryCleaner() {
  memoryCleaner.start();
}

function getMemInterval() {
  return memoryCleaner.getInterval();
}

async function runMemoryClear(showToast = true) {
  await memoryCleaner.clear();
  if (showToast) toast('Memory cleared');
}

function openMemSettings() {
  document.getElementById('mem-settings-ov')?.remove();
  const cur = getMemInterval();
  const ov = document.createElement('div');
  ov.className = 'ov on'; ov.id = 'mem-settings-ov';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `
    <div class="modal" style="width:300px">
      <h2 style="margin-bottom:6px">Memory auto clear</h2>
      <p style="font-size:12px;color:var(--text2);margin-bottom:14px">Reduce memory growth during long sessions.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
        ${[[15*60000,'15 min'],[30*60000,'30 min'],[60*60000,'1 hour'],[120*60000,'2 hours'],[0,'OFF']].map(([ms, label]) => `
          <button onclick="applyMemInterval(${ms})"
            style="padding:5px 11px;border-radius:6px;border:1px solid ${cur===ms?'var(--accent)':'var(--border2)'};background:${cur===ms?'var(--accent-dim)':'transparent'};color:${cur===ms?'var(--accent)':'var(--text2)'};cursor:pointer;font-size:12px;font-family:inherit">
            ${label}
          </button>`).join('')}
      </div>
      <button onclick="runMemoryClear(true);document.getElementById('mem-settings-ov').remove()"
        style="width:100%;padding:8px;border-radius:7px;background:var(--bg3);border:1px solid var(--border);color:var(--text2);font-family:inherit;font-size:12px;cursor:pointer;margin-bottom:8px">
        Clear now
      </button>
      <button onclick="document.getElementById('mem-settings-ov').remove()" class="btn-cancel">Close</button>
    </div>`;
  document.body.appendChild(ov);
}

function applyMemInterval(ms) {
  memoryCleaner.setIntervalMs(ms);
  const label = ms === 0 ? 'OFF' : ms < 3600000 ? (ms/60000)+' min' : (ms/3600000)+' hour';
  toast(`Memory auto clear: ${label}`);
  document.getElementById('mem-settings-ov')?.remove();
}

function scrollToStart() {
  document.getElementById('cols')?.scrollTo({ left: 0, behavior: 'smooth' });
}

function openXListDialog(accountIdx) {
  document.getElementById('x-list-dialog-ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'ov on'; ov.id = 'x-list-dialog-ov';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };

  const acc = state.xs?.[accountIdx ?? 0];
  const accLabel = acc ? ` (${acc.username})` : '';

  ov.innerHTML = `
    <div class="modal" style="width:400px">
      <h2 style="margin-bottom:6px;display:flex;align-items:center;gap:8px">
        ${SVG.x.replace('viewBox', 'width="15" height="15" viewBox')}
        Add X list${esc(accLabel)}
      </h2>
      <p style="font-size:12px;color:var(--text2);margin-bottom:16px">Enter a list URL or list ID.</p>
      <div class="lf" style="margin-bottom:6px">
        <label>List URL / ID</label>
        <input type="text" id="x-list-input" placeholder="https://x.com/i/lists/123456789 or 123456789"
          style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;font-size:13px;color:var(--text1);font-family:inherit;outline:none"
          onkeydown="if(event.key==='Enter')confirmXList(${accountIdx})">
      </div>
      <div class="lf" style="margin-bottom:16px">
        <label>Column name (optional)</label>
        <input type="text" id="x-list-name" placeholder="My list"
          style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;font-size:13px;color:var(--text1);font-family:inherit;outline:none"
          onkeydown="if(event.key==='Enter')confirmXList(${accountIdx})">
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('x-list-dialog-ov').remove()" class="btn-cancel" style="flex:1">Cancel</button>
        <button onclick="confirmXList(${accountIdx})" style="flex:1;padding:9px;border-radius:7px;background:var(--accent);border:none;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">Add</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  setTimeout(() => document.getElementById('x-list-input')?.focus(), 50);
}

function confirmXList(accountIdx) {
  const raw = document.getElementById('x-list-input')?.value?.trim();
  const nameInput = document.getElementById('x-list-name')?.value?.trim();
  if (!raw) { toast('Enter a list URL or ID'); return; }

  let listId = raw;
  const m = raw.match(/lists\/([0-9]+)/);
  if (m) listId = m[1];
  // 数字のみでなければエラー
  if (!/^[0-9]+$/.test(listId)) { toast('Enter a valid list URL or ID'); return; }

  const url = `https://x.com/i/lists/${listId}`;
  const title = nameInput || `List ${listId}`;
  const acc = state.xs?.[accountIdx ?? 0];
  const xPart = acc?.partition || `persist:x-${accountIdx ?? 0}`;
  const accLabel = acc ? ` - ${acc.username}` : '';

  const id = nextColumnId(`x${accountIdx}-list-${listId}`);
  const result = columnLifecycle.create({
    networkId: 'x',
    definitionId: 'x-list-new',
    id,
    account: acc ? { ...acc, index: accountIdx ?? 0, partition: xPart } : null,
    params: { url, title, sub: `X${accLabel}` },
  });
  if (result.status !== 'created') {
    toast('List column could not be added');
    return;
  }

  document.getElementById('x-list-dialog-ov')?.remove();
  const cols = document.getElementById('cols');
  const lastCol = cols.querySelector('.col:last-of-type');
  if (lastCol) lastCol.scrollIntoView({ behavior: 'smooth', inline: 'end' });
  toast('List column added');
}

function openAddMod() { buildOptGrid(); document.getElementById('addMod').classList.add('on'); }
// ─── MENTION SUGGEST ────────────────────────────
let _mentionTimer = null;
let _mentionLastQ = '';

async function onCompTextareaInput(e) {
  updCC();
  const ta = e.target;
  const val = ta.value;
  const pos = ta.selectionStart;

  // カーソル前の @word を検出
  const before = val.slice(0, pos);
  const m = before.match(/@([a-zA-Z0-9._-]*)$/);

  const box = document.getElementById('mention-suggest');
  if (!m || m[1].length < 1) {
    if (box) box.style.display = 'none';
    return;
  }
  const q = m[1];
  if (q === _mentionLastQ) return;
  _mentionLastQ = q;

  clearTimeout(_mentionTimer);
  _mentionTimer = setTimeout(async () => {
    if (!state.b || q.length < 1) return;
    try {
      const data = await bsky.searchActors(state.b.accessJwt, q, 6);
      const actors = data.actors || [];
      if (!actors.length) { if (box) box.style.display = 'none'; return; }

      // ボックス作成 or 再利用
      let suggest = document.getElementById('mention-suggest');
      if (!suggest) {
        suggest = document.createElement('div');
        suggest.id = 'mention-suggest';
        suggest.style.cssText = 'position:fixed;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:4px;z-index:600;min-width:220px;max-width:300px;box-shadow:0 4px 20px rgba(0,0,0,.5);max-height:220px;overflow-y:auto';
        document.body.appendChild(suggest);
      }

      const rect = ta.getBoundingClientRect();
      suggest.style.left = Math.min(rect.left + 8, window.innerWidth - 310) + 'px';
      suggest.style.top  = (rect.bottom + 4) + 'px';

      suggest.innerHTML = actors.map(a => {
        const av = a.avatar ? `<img src="${esc(a.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : (a.handle || '?').slice(0, 2).toUpperCase();
        const bg = avBgFor(a.handle);
        return `<div onclick="insertMention('${esc(a.handle)}')"
          style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:5px;cursor:pointer;transition:background .1s"
          onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
          <div style="width:28px;height:28px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">${av}</div>
          <div style="min-width:0">
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.displayName || a.handle)}</div>
            <div style="font-size:10px;color:var(--text3)">@${esc(a.handle)}</div>
          </div>
        </div>`;
      }).join('');

      suggest.style.display = 'block';
    } catch {}
  }, 200);
}

function insertMention(handle) {
  const ta = document.getElementById('cta');
  if (!ta) return;
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const after = ta.value.slice(pos);
  const replaced = before.replace(/@([a-zA-Z0-9._-]*)$/, `@${handle} `);
  ta.value = replaced + after;
  ta.selectionStart = ta.selectionEnd = replaced.length;
  ta.focus();
  updCC();
  const suggest = document.getElementById('mention-suggest');
  if (suggest) suggest.style.display = 'none';
  _mentionLastQ = '';
}

document.addEventListener('click', e => {
  const suggest = document.getElementById('mention-suggest');
  if (suggest && !e.target.closest('#mention-suggest') && !e.target.closest('#cta')) {
    suggest.style.display = 'none';
  }
});

function setComposeButtonLabel(buttonId, label = null) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
  button.textContent = label || button.dataset.defaultLabel;
}

function setComposeBusy(modalId, buttonId, busy, busyLabel = '送信中…') {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.setAttribute('aria-busy', String(busy));
    const content = modal.querySelector('.cmodal');
    if (content) content.style.pointerEvents = busy ? 'none' : '';
  }

  const button = document.getElementById(buttonId);
  if (button) button.disabled = busy;
  setComposeButtonLabel(buttonId, busy ? busyLabel : null);
  if (!busy) {
    if (buttonId === 'x-sndb') updXCC();
    if (buttonId === 'sndb') updCC();
  }
}

function isComposeSending(modalId) {
  if (modalId === 'xPostMod') {
    return composeCoordinator.getStatus('x').isSending;
  }
  if (modalId === 'compMod') {
    return composeCoordinator.getStatus('b').isSending;
  }
  return false;
}

function closeOv(id, e) {
  if (isComposeSending(id)) return;
  if (!e || e.target.classList.contains('ov')) {
    document.getElementById(id).classList.remove('on');
    if (id === 'xPostMod') {
      composeCoordinator.reset('x');
      setXCrossPostDraftLocked(false);
      resetXImgUI();
      document.getElementById('x-cta').value = '';
      updateXCrossPostControls();
      setComposeButtonLabel('x-sndb');
      updXCC();
    }
    if (id === 'compMod') {
      composeCoordinator.reset('b');
      setCrossPostDraftLocked(false);
      resetBImgUI();
      const cta = document.getElementById('cta');
      if (cta) { cta.value = ''; updCC(); }
      replyTarget = null;
      updateCrossPostControls();
      document.querySelector('.bsky-reply-preview')?.remove();
      setComposeButtonLabel('sndb');
    }
  }
}

// ─── アプリ内メニュー ────────────────────────────
function toggleAmDrop(id, e) {
  e.stopPropagation();
  const drop = document.getElementById(id);
  const item = drop?.closest('.am-item');
  const isOpen = item?.classList.contains('open');
  document.querySelectorAll('.am-item.open').forEach(el => el.classList.remove('open'));
  if (!isOpen && item) item.classList.add('open');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.am-item.open').forEach(el => el.classList.remove('open'));
});

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('sh');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('sh'), 2800);
}

// ─── KEYBOARD SHORTCUTS ─────────────────────────
document.addEventListener('keydown', e => {
  const lb = document.getElementById('lightbox');
  if (lb?.classList.contains('on')) {
    if (e.key === 'ArrowLeft') { lbMove(-1); return; }
    if (e.key === 'ArrowRight') { lbMove(1); return; }
    if (e.key === 'Escape') { lbClose(); return; }
  }

  if (e.key === 'Enter' && !document.getElementById('login-screen').classList.contains('hidden')) {
    if (document.querySelector('.ltab.xt.active')) loginX();
    else loginBluesky();
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.ov.on').forEach(o => {
      if (o.id === 'xPostMod' || o.id === 'compMod') closeOv(o.id);
      else o.classList.remove('on');
    });
    document.getElementById('quote-modal-ov')?.remove();
    quoteTarget = null;
  }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'n') { e.preventDefault(); openAddMod(); }
    if (e.key === 'r') { e.preventDefault(); refreshAll(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const xMod = document.getElementById('xPostMod');
      const bMod = document.getElementById('compMod');
      const qMod = document.getElementById('quote-modal-ov');
      if (qMod) {
        const btn = document.getElementById('quote-sndb');
        if (btn && !btn.disabled) doQuotePost();
      } else if (xMod?.classList.contains('on')) {
        const btn = document.getElementById('x-sndb');
        if (btn && !btn.disabled) doXPost();
      } else if (bMod?.classList.contains('on')) {
        const btn = document.getElementById('sndb');
        if (btn && !btn.disabled) doSend();
      }
    }
  }
});

if (IS_ELECTRON) {
  window.electronAPI.on('add-column', () => openAddMod());
  window.electronAPI.on('refresh-all', () => refreshAll());
  window.electronAPI.on('scroll-left', () => { document.getElementById('cols').scrollBy({ left: -400, behavior: 'smooth' }); });
  window.electronAPI.on('scroll-right', () => { document.getElementById('cols').scrollBy({ left: 400, behavior: 'smooth' }); });
  window.electronAPI.on('show-about', () => openAbout());
  window.electronAPI.onUpdateStatus?.(renderUpdateStatus);

  window.addEventListener('resize', () => {
    const btn = document.getElementById('win-max-btn');
    if (!btn) return;
    const isMax = window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight;
    btn.innerHTML = isMax
      ? `<svg viewBox="0 0 10 10" width="10" height="10"><path d="M2 0h8v8M0 2h8v8" fill="none" stroke="currentColor" stroke-width="1"/></svg>`
      : `<svg viewBox="0 0 10 10" width="10" height="10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
  });
}

// ─── DRAG & DROP ─────────────────────────────────
let dragSrc = null;
fileDragShield.attach();

function initDnD() {
  const cols = document.getElementById('cols');
  let lastDragOverCol = null;

  cols.addEventListener('dragstart', e => {
    const head = e.target.closest('.col-head');
    const interactive = e.target.closest('button,a,input,textarea,select,[contenteditable="true"],.feed,.post,.notif,.col-webview,.col-resize');
    if (!head || interactive) { e.preventDefault(); return; }
    const col = head.closest('.col'); if (!col) return;
    dragSrc = col;
    requestAnimationFrame(() => { col.style.opacity = '0.4'; });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', col.id);
    document.querySelectorAll('.col').forEach(c => {
      if (!c.querySelector('.col-drag-shield')) {
        const shield = document.createElement('div');
        shield.className = 'col-drag-shield';
        shield.style.cssText = 'position:absolute;inset:0;z-index:20;pointer-events:none;background:transparent';
        c.style.position = 'relative';
        c.appendChild(shield);
      }
    });
  });

  cols.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.style.opacity = '';
    if (lastDragOverCol) { lastDragOverCol.classList.remove('drag-over'); lastDragOverCol = null; }
    dragSrc = null;
    document.querySelectorAll('.col-drag-shield').forEach(s => s.remove());
  });

  cols.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const col = e.target.closest('.col');
    if (!col || col === dragSrc) {
      if (lastDragOverCol) { lastDragOverCol.classList.remove('drag-over'); lastDragOverCol = null; }
      return;
    }
    if (lastDragOverCol !== col) {
      if (lastDragOverCol) lastDragOverCol.classList.remove('drag-over');
      col.classList.add('drag-over');
      lastDragOverCol = col;
    }
  });

  cols.addEventListener('dragleave', e => {
    if (!cols.contains(e.relatedTarget)) {
      if (lastDragOverCol) { lastDragOverCol.classList.remove('drag-over'); lastDragOverCol = null; }
    }
  });

  cols.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.col');
    if (lastDragOverCol) { lastDragOverCol.classList.remove('drag-over'); lastDragOverCol = null; }
    if (!target || !dragSrc || target === dragSrc) return;

    // ドロップ先と位置をスワップ
    const cols2 = [...cols.querySelectorAll('.col')];
    const srcIdx = cols2.indexOf(dragSrc);
    const tgtIdx = cols2.indexOf(target);
    if (srcIdx < tgtIdx) {
      target.insertAdjacentElement('afterend', dragSrc);
    } else {
      cols.insertBefore(dragSrc, target);
    }
    dragSrc.style.opacity = '';
    toast('カラムを移動しました');
    columnLifecycle.persist();
  });
}
function makeDraggable(col) {
  col.draggable = false;
  const head = col.querySelector('.col-head');
  if (head) {
    head.draggable = true;
    head.style.cursor = 'grab';
  }
  addResizeHandle(col);
}
const colObserver = new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes)
    if (n.nodeType===1 && n.classList?.contains('col')) { makeDraggable(n); addResizeHandle(n); }
});

// ─── COLUMN RESIZE ────────────────────────────────
function addResizeHandle(col) {
  if (col.querySelector('.col-resize')) return;
  const handle = document.createElement('div');
  handle.className = 'col-resize';
  handle.title = 'ドラッグで幅を変更';
  col.appendChild(handle);
  let startX, startW;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startW = col.offsetWidth;
    const onMove = ev => {
      const w = Math.max(260, Math.min(600, startW + ev.clientX - startX));
      col.style.width = w + 'px';
      col.style.minWidth = w + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      columnLifecycle.persist();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── INIT ───────────────────────────────────────
state = E2E_FIXTURES?.state ? structuredClone(E2E_FIXTURES.state) : stateStore.load();
if (state.x && !(state.xs && state.xs.length > 0)) {
  state.xs = [{ ...state.x, partition: 'persist:x-0' }];
  state.activeX = 0;
  delete state.x;
  saveState();
}
updateLoginUI();
initDnD();
colObserver.observe(document.getElementById('cols'), { childList: true });

if ((state.xs && state.xs.length > 0) || state.b) {
  if (state.b?.refreshJwt) {
    refreshBskyToken().catch(() => {});
  }
  Promise.all([syncXNetworkAccounts(), initWvPreloadPath(), initializeXLoginStates()]).finally(() => {
    enterApp();
    if (state.b) {
      setTimeout(() => fetchBskyUnreadCount(), 3000);
      setInterval(() => fetchBskyUnreadCount(), 5 * 60 * 1000);
    }
    setTimeout(() => document.querySelectorAll('#cols .col').forEach(makeDraggable), 300);
  });
}

// ─── VISIBILITY-BASED REFRESH THROTTLE ──────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // バックグラウンド: 全タイマーを一時停止
    columnLifecycle.pauseRefresh();
    notificationRuntime.stopPoll();
    memoryCleaner.stop();
  } else {
    // フォアグラウンド復帰: タイマーを再開のみ（即時更新はしない）
    // ShareX等のキャプチャツールがフォーカスを一瞬奪うと誤発火するため
    columnLifecycle.resumeRefresh();
    if (state.b) startNotifPoll();
    startMemoryCleaner();
  }
});

startMemoryCleaner();

// ═══════════════════════════════════════════════
//  WIDGET MODE — デスクトップTLウィジェット
// ═══════════════════════════════════════════════
const IS_WIDGET = new URLSearchParams(location.search).get('widget') === '1';

if (IS_WIDGET) {
  initWidgetMode();
}

async function initWidgetMode() {
  document.body.classList.add('widget-mode');

  // ウィジェット用スタイルを注入
  const ws = document.createElement('style');
  ws.textContent = `
    body.widget-mode { background: transparent !important; }
    body.widget-mode .sidebar,
    body.widget-mode .topbar,
    body.widget-mode #login-screen { display: none !important; }
    body.widget-mode .main { margin: 0 !important; }
    body.widget-mode #cols {
      padding: 0 !important;
      gap: 0 !important;
      background: transparent !important;
    }
    body.widget-mode .col {
      width: 100% !important;
      min-width: 100% !important;
      height: calc(100vh - 34px) !important;
      border-radius: 0 0 10px 10px !important;
      border: 1px solid var(--border) !important;
      border-top: none !important;
    }
    body.widget-mode .col .col-actions .cbtn { display: none !important; }
    body.widget-mode .col .col-actions .cbtn.wg-keep { display: flex !important; }
    /* ドラッグハンドルバー */
    #widget-bar {
      height: 34px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-bottom: 1px solid var(--border2);
      border-radius: 10px 10px 0 0;
      -webkit-app-region: drag;
      user-select: none;
    }
    #widget-bar .wg-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text2);
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      overflow: hidden;
      white-space: nowrap;
    }
    #widget-bar button {
      -webkit-app-region: no-drag;
      width: 22px;
      height: 22px;
      border-radius: 5px;
      border: none;
      background: transparent;
      color: var(--text3);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
      flex-shrink: 0;
    }
    #widget-bar button:hover { background: var(--bg3); color: var(--text1); }
    #widget-bar button.active { color: var(--accent); }
    #widget-bar button svg { width: 13px; height: 13px; }
    #widget-bar input[type="range"] {
      -webkit-app-region: no-drag;
      width: 60px;
      accent-color: var(--accent);
    }
  `;
  document.head.appendChild(ws);

  // ドラッグハンドルバーを挿入
  const bar = document.createElement('div');
  bar.id = 'widget-bar';

  let colOptions = '';
  try {
    const fullLayout = columnRuntime.readStoredLayout();
    const selId = columnRuntime.getWidgetColumnId() || fullLayout[0]?.id;
    colOptions = fullLayout.map(c =>
      `<option value="${c.id}" ${c.id === selId ? 'selected' : ''}>${(c.title || c.id)}${c.sub ? ' · ' + c.sub : ''}</option>`
    ).join('');
  } catch {}

  bar.innerHTML = `
    <div class="wg-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
      <select id="wg-col-select" onchange="wgSelectCol(this.value)"
        style="-webkit-app-region:no-drag;background:var(--bg3);border:1px solid var(--border);border-radius:5px;color:var(--text2);font-size:10px;font-family:inherit;padding:2px 4px;max-width:150px">
        ${colOptions}
      </select>
    </div>
    <input type="range" min="30" max="100" value="100" title="Opacity" id="wg-opacity"
      oninput="window.electronAPI?.widgetSetOpacity(this.value / 100)">
    <button id="wg-top-btn" title="Always on top" onclick="wgToggleTop()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>
    </button>
    <button title="Close" onclick="window.electronAPI?.closeWidget()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  document.body.prepend(bar);

  if (IS_ELECTRON) {
    try {
      const op = await window.electronAPI.widgetGetOpacity();
      const slider = document.getElementById('wg-opacity');
      if (slider && op) { slider.value = Math.round(op * 100); window.electronAPI.widgetSetOpacity(op); }
      const isTop = await window.electronAPI.widgetGetTop();
      if (isTop) document.getElementById('wg-top-btn')?.classList.add('active');
    } catch {}
  }
}

async function wgToggleTop() {
  if (!IS_ELECTRON) return;
  const next = await window.electronAPI.widgetToggleTop();
  const btn = document.getElementById('wg-top-btn');
  if (btn) btn.classList.toggle('active', next);
  toast(next ? 'Always on top enabled' : 'Always on top disabled');
}

function wgSelectCol(colId) {
  columnRuntime.setWidgetColumnId(colId);
  location.reload();
}
