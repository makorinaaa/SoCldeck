// ═══════════════════════════════════════════════
//  SOCIALDECK — renderer.js
//  Bluesky AT Protocol + X WebView
// ═══════════════════════════════════════════════

const IS_ELECTRON = typeof window.electronAPI !== 'undefined';
const composeMedia = window.SocialDeckComposeMedia;

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

// トークンリフレッシュ（自動呼び出し用）
let _refreshPromise = null; // 並列リフレッシュ防止
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

const legacyBsky = {
  login: (id, pw) => apiPost('com.atproto.server.createSession', { identifier: id, password: pw }),
  refresh: (rt) => apiPost('com.atproto.server.refreshSession', {}, rt),
  timeline: (jwt, limit = 40, cursor = null) => apiGet('app.bsky.feed.getTimeline', cursor ? { limit, cursor } : { limit }, jwt),
  feed: (jwt, feed, limit = 40, cursor = null) => apiGet('app.bsky.feed.getFeed', cursor ? { feed, limit, cursor } : { feed, limit }, jwt),
  notifications: (jwt, limit = 30) => apiGet('app.bsky.notification.listNotifications', { limit }, jwt),
  search: (jwt, q, limit = 30) => apiGet('app.bsky.feed.searchPosts', { q, limit }, jwt),
  searchActors: (jwt, q, limit = 8) => apiGet('app.bsky.actor.searchActors', { q, limit }, jwt),
  getProfile: (jwt, actor) => apiGet('app.bsky.actor.getProfile', { actor }, jwt),
  like: (jwt, did, uri, cid) => apiPost('com.atproto.repo.createRecord', { repo: did, collection: 'app.bsky.feed.like', record: { $type: 'app.bsky.feed.like', subject: { uri, cid }, createdAt: new Date().toISOString() } }, jwt),
  unlike: (jwt, did, likeUri) => apiPost('com.atproto.repo.deleteRecord', { repo: did, collection: 'app.bsky.feed.like', rkey: likeUri.split('/').pop() }, jwt),
  repost: (jwt, did, uri, cid) => apiPost('com.atproto.repo.createRecord', { repo: did, collection: 'app.bsky.feed.repost', record: { $type: 'app.bsky.feed.repost', subject: { uri, cid }, createdAt: new Date().toISOString() } }, jwt),
  unrepost: (jwt, did, repostUri) => apiPost('com.atproto.repo.deleteRecord', { repo: did, collection: 'app.bsky.feed.repost', rkey: repostUri.split('/').pop() }, jwt),
  post: (jwt, did, text, replyRef = null) => {
    const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString() };
    if (replyRef) record.reply = replyRef;
    return apiPost('com.atproto.repo.createRecord', { repo: did, collection: 'app.bsky.feed.post', record }, jwt);
  },
  follow: (jwt, did, targetDid) => apiPost('com.atproto.repo.createRecord', { repo: did, collection: 'app.bsky.graph.follow', record: { $type: 'app.bsky.graph.follow', subject: targetDid, createdAt: new Date().toISOString() } }, jwt),
  unfollow: (jwt, did, followUri) => apiPost('com.atproto.repo.deleteRecord', { repo: did, collection: 'app.bsky.graph.follow', rkey: followUri.split('/').pop() }, jwt),
  getRelationships: (jwt, actor, others) => apiGet('app.bsky.graph.getRelationships', { actor, others }, jwt),
  quotePost: (jwt, did, text, quotedUri, quotedCid, embed) => {
    const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString(),
      embed: embed
        ? { $type: 'app.bsky.embed.recordWithMedia', record: { $type: 'app.bsky.embed.record', record: { uri: quotedUri, cid: quotedCid } }, media: embed }
        : { $type: 'app.bsky.embed.record', record: { uri: quotedUri, cid: quotedCid } }
    };
    return apiPost('com.atproto.repo.createRecord', { repo: did, collection: 'app.bsky.feed.post', record }, jwt);
  },
  getThread: (jwt, uri, depth = 6) => apiGet('app.bsky.feed.getPostThread', { uri, depth }, jwt),
  getPreferences: (jwt) => apiGet('app.bsky.actor.getPreferences', {}, jwt),
  updateSeen: (jwt, seenAt) => apiPost('app.bsky.notification.updateSeen', { seenAt }, jwt),
  getSavedFeeds: async (jwt) => {
    const prefs = await bsky.getPreferences(jwt);
    const saved = (prefs.preferences || []).find(p => p.$type === 'app.bsky.actor.defs#savedFeedsPrefV2');
    return saved?.items || [];
  },
};

const SVG = {
  x: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.389 6.231H2.763l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  bsky: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  rt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  reply: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  follow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>`,
};

// ─── COLUMN PERSISTENCE ──────────────────────────
const columnRuntime = window.SocialDeckColumnRuntime.createColumnRuntime();
const COL_KEY = columnRuntime.layoutKey;

function saveColLayout() {
  // ウィジェットモードでは保存しない（メインウィンドウのレイアウトを壊さないため）
  if (new URLSearchParams(location.search).get('widget') === '1') return;
  const cols = document.getElementById('cols');
  if (!cols) return;
  const layout = [];
  cols.querySelectorAll('.col').forEach(col => {
    const d = col.dataset;
    const wv = col.querySelector('webview');
    if (wv) {
      // WebViewカラム
      const wvId = col.id.replace('col-', '');
      // X系のURLは現在のページ（返信・ツイート詳細等）ではなくホームに正規化して保存
      let savedUrl = normalizeXUrl(wv.src);
      layout.push({
        kind: 'wv',
        id: wvId,
        url: savedUrl,
        partition: wv.partition,
        title: col.querySelector('.col-title')?.textContent || '',
        sub: col.querySelector('.col-sub')?.textContent?.trim() || '',
        icCls: col.querySelector('.col-ic')?.className?.replace('col-ic ', '') || 'ic-x',
        width: col.style.width || '',
        interval: autoRefreshIntervals[wvId] ?? DEFAULT_INTERVAL_MS,
        collapsed: collapsedCols.has(wvId),
      });
    } else if (d.type) {
      // Bskyカラム
      const bskyId = col.id.replace('col-', '');
      layout.push({
        kind: 'bsky',
        id: bskyId,
        type: d.type,
        feedUri: d.feeduri || '',
        title: col.querySelector('.col-title')?.textContent || '',
        sub: col.querySelector('.col-sub')?.textContent?.trim() || '',
        icCls: col.querySelector('.col-ic')?.className?.replace('col-ic ', '') || 'ic-b',
        width: col.style.width || '',
        interval: autoRefreshIntervals[bskyId] ?? DEFAULT_INTERVAL_MS,
        collapsed: collapsedCols.has(bskyId),
      });
    }
  });
  columnRuntime.writeStoredLayout(layout);
}

function normalizeXUrl(url) {
  return columnRuntime.normalizeXUrl(url);
}

function loadColLayout() {
  return columnRuntime.getLayoutForCurrentMode();
  try {
    const layout = JSON.parse(localStorage.getItem(COL_KEY)) || [];
    // 起動時マイグレーション: X系URLを正規化して保存し直す
    let dirty = false;
    layout.forEach(col => {
      if (col.kind === 'wv' && col.url) {
        const fixed = normalizeXUrl(col.url);
        if (fixed !== col.url) { col.url = fixed; dirty = true; }
      }
    });
    if (dirty) localStorage.setItem(COL_KEY, JSON.stringify(layout));

    // ウィジェットモード: 選択された1カラムのみに絞る（他カラムのWebViewを起動させない）
    if (new URLSearchParams(location.search).get('widget') === '1' && layout.length > 0) {
      const selId = columnRuntime.getWidgetColumnId();
      const selected = layout.find(c => c.id === selId) || layout[0];
      // 折りたたみ状態は無視して展開表示
      return [{ ...selected, collapsed: false, width: '' }];
    }

    return layout;
  } catch { return []; }
}

function restoreColLayout() {
  const layout = loadColLayout();
  if (!layout.length) return false;

  layout.forEach(col => {
    if (col.kind === 'wv') {
      // iconはURLから推測
      let icon = SVG.x, icCls = col.icCls || 'ic-x';
      if (col.partition === 'persist:bsky') { icon = SVG.gear; }
      else if (col.url?.includes('notifications')) { icon = SVG.bell; icCls = 'ic-n'; }
      else if (col.url?.includes('search')) { icCls = 'ic-s'; }
      else if (col.url?.includes('settings')) { icon = SVG.gear; icCls = 'ic-s'; }
      insertWebViewCol({
        id: col.id, title: col.title, sub: col.sub,
        url: col.url, icCls, icon,
      }, null, col.partition || 'persist:x-0');
      // 自動更新間隔を復元（insertWebViewColがDEFAULTで設定するのを上書き）
      if (col.interval !== undefined) {
        clearAutoRefresh(col.id);
        setAutoRefreshWv(col.id, col.interval);
      }
      if (col.width) {
        const el = document.getElementById(`col-${col.id}`);
        if (el) { el.style.width = col.width; el.style.minWidth = col.width; }
      }
      if (col.collapsed) {
        // 次フレームで折りたたみ（DOM挿入後に実行）
        setTimeout(() => toggleColCollapse(col.id), 0);
      }
    } else if (col.kind === 'bsky') {
      let icon = SVG.bsky, icCls = col.icCls || 'ic-b';
      if (col.type === 'notif') { icon = SVG.bell; icCls = 'ic-n'; }
      else if (col.type === 'search') { icCls = 'ic-s'; }
      insertBskyCol({
        id: col.id, title: col.title, sub: col.sub,
        type: col.type, feedUri: col.feedUri || null, icCls, icon,
      });
      // 自動更新間隔を復元（insertBskyColがDEFAULTで設定するのを上書き）
      if (col.interval !== undefined) {
        clearAutoRefresh(col.id);
        setAutoRefresh(col.id, col.interval, col.type, col.feedUri || null);
      }
      if (col.width) {
        const el = document.getElementById(`col-${col.id}`);
        if (el) { el.style.width = col.width; el.style.minWidth = col.width; }
      }
      if (col.collapsed) {
        setTimeout(() => toggleColCollapse(col.id), 0);
      }
    }
  });
  return true;
}

// ─── NG WORD / MUTE ──────────────────────────────
const NG_KEY = 'socialdeck_ng';
function loadNg() {
  try { return JSON.parse(localStorage.getItem(NG_KEY)) || { words: [], users: [] }; } catch { return { words: [], users: [] }; }
}
function saveNg(ng) { localStorage.setItem(NG_KEY, JSON.stringify(ng)); }
let ngData = loadNg();

function isNgPost(item) {
  const post = item.post || item;
  // チェック対象テキストを収集（本文＋引用元の本文）
  const texts = [post.record?.text || ''];
  // チェック対象ユーザーを収集（投稿者＋リポスト者＋引用元の投稿者）
  const authors = [
    { handle: post.author?.handle, displayName: post.author?.displayName },
  ];

  // リポストの場合: リポストした人もチェック
  const reasonBy = item.reason?.by;
  if (reasonBy) {
    authors.push({ handle: reasonBy.handle, displayName: reasonBy.displayName });
  }

  // 引用埋め込みの場合: 引用元の本文と投稿者もチェック
  const embed = post.embed;
  if (embed) {
    const qrec = embed.record?.value ? embed.record : embed.record?.record;
    if (qrec?.value?.text) texts.push(qrec.value.text);
    if (qrec?.author) authors.push({ handle: qrec.author.handle, displayName: qrec.author.displayName });
  }

  // NGワード
  for (const w of ngData.words) {
    if (!w) continue;
    const lw = w.toLowerCase();
    if (texts.some(t => t.toLowerCase().includes(lw))) return true;
  }
  // ミュートユーザー
  for (const u of ngData.users) {
    if (!u) continue;
    const lu = u.toLowerCase();
    if (authors.some(a =>
      (a.handle || '').toLowerCase().includes(lu) ||
      (a.displayName || '').toLowerCase().includes(lu)
    )) return true;
  }
  return false;
}
function isNgNotif(n) {
  const handle = (n.author?.handle || '').toLowerCase();
  for (const u of ngData.users) {
    if (u && handle.includes(u.toLowerCase())) return true;
  }
  return false;
}

function openNgSettings() {
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
  const val = input?.value.trim().replace(/^@/, '');
  if (!val) return;
  if (type === 'word') { if (!ngData.words.includes(val)) ngData.words.push(val); }
  else { if (!ngData.users.includes(val)) ngData.users.push(val); }
  saveNg(ngData);
  openNgSettings(); // 再描画
  refilterBskyCols(); // 表示中の投稿に即時反映
  toast(`NG${type === 'word' ? 'ワード' : 'ユーザー'}「${val}」を追加しました`);
}

function removeNg(type, idx) {
  if (type === 'word') ngData.words.splice(idx, 1);
  else ngData.users.splice(idx, 1);
  saveNg(ngData);
  openNgSettings();
  refilterBskyCols(); // NG解除も即時反映（次回更新で再表示される）
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
let state = { xs: [], activeX: 0, b: null };
const stateStore = window.SocialDeckStateStore.createStateStore();
const AVBG = ['linear-gradient(135deg,#4e9af0,#6a5cf0)', 'linear-gradient(135deg,#e05c7a,#9a5cf0)', 'linear-gradient(135deg,#3dc98a,#4e9af0)', 'linear-gradient(135deg,#f5c842,#e05c7a)', 'linear-gradient(135deg,#9a5cf0,#e05c7a)', 'linear-gradient(135deg,#4e9af0,#3dc98a)', 'linear-gradient(135deg,#e05c7a,#f5c842)', 'linear-gradient(135deg,#3dc98a,#6a5cf0)'];


function loadState() {
  // v4フォーマットを試す
  try {
    const v4 = JSON.parse(localStorage.getItem(LS_KEY));
    if (v4 && Array.isArray(v4.xs)) return v4;
  } catch {}
  // v3からの移行
  try {
    const v3 = JSON.parse(localStorage.getItem('socialdeck_v3'));
    if (v3) {
      const migrated = { xs: [], activeX: 0, b: v3.b || null };
      if (v3.x) {
        migrated.xs.push({ ...v3.x, partition: 'persist:x-0' });
      }
      return migrated;
    }
  } catch {}
  return { xs: [], activeX: 0, b: null };
}
function saveState() { stateStore.save(state); }

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
  const xStatus = document.getElementById('x-status');
  const bStatus = document.getElementById('b-status');

  // ── X アカウント一覧表示 ──
  const xAccounts = state.xs || [];
  if (xAccounts.length > 0) {
    const listHtml = xAccounts.map((a, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
        <div style="width:24px;height:24px;border-radius:50%;background:${a.bg};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#000;flex-shrink:0">${a.initials}</div>
        <span style="flex:1;font-size:12px;color:var(--text1)">${esc(a.username)}</span>
        <button onclick="removeXAccount(${i})" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:11px;font-family:inherit">削除</button>
      </div>`).join('');
    xStatus.className = 'lsbar ok';
    xStatus.innerHTML = `<div style="width:100%">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> <span style="font-size:12px">${xAccounts.length}アカウント登録済み</span></div>
      ${listHtml}
    </div>`;
  } else {
    xStatus.className = 'lsbar none';
    xStatus.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> X アカウントは未接続`;
  }

  // ── Bluesky ──
  if (state.b) {
    bStatus.className = 'lsbar ok';
    bStatus.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> 接続済み: <span class="sname">@${state.b.handle}</span>`;
    document.getElementById('b-login-btn').style.display = 'none';
    document.getElementById('b-logout-btn').style.display = 'block';
  } else {
    bStatus.className = 'lsbar none';
    bStatus.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Bluesky アカウントは未接続`;
    document.getElementById('b-login-btn').style.display = 'flex';
    document.getElementById('b-logout-btn').style.display = 'none';
  }

  const canEnter = xAccounts.length > 0 || state.b;
  document.getElementById('lenter').disabled = !canEnter;
  document.getElementById('lfoot-msg').textContent = canEnter
    ? [xAccounts.length > 0 ? `X(${xAccounts.length})` : '', state.b ? 'Bluesky' : ''].filter(Boolean).join(' + ') + ' でログイン済み'
    : 'アカウントを追加してください';
}

function loginX() {
  const user = document.getElementById('x-user').value.trim();
  document.getElementById('x-err').textContent = '';
  if (!user) { document.getElementById('x-err').textContent = '表示名を入力してください'; return; }
  const clean = user.replace(/^@/, '');
  const username = '@' + clean;

  // 同じユーザー名が既に登録済みなら弾く
  if ((state.xs || []).some(a => a.username === username)) {
    document.getElementById('x-err').textContent = 'このアカウントは既に登録されています';
    return;
  }

  const idx = (state.xs || []).length;
  const partition = nextXPartition();
  const bg = AVBG[idx % AVBG.length];
  if (!state.xs) state.xs = [];
  state.xs.push({ username, initials: clean.slice(0, 2).toUpperCase(), bg, partition });
  state.activeX = idx;
  saveState();
  document.getElementById('x-user').value = '';
  updateLoginUI();
  toast(`${username} を追加しました`);
  const app = document.getElementById('app');
  if (!app.style.display || app.style.display === 'none') { enterApp(); } else { renderApp(); }
}

async function removeXAccount(idx) {
  if (!confirm(`${state.xs[idx]?.username} をログアウトしますか？`)) return;
  const partition = state.xs[idx]?.partition || `persist:x-${idx}`;
  // WebViewセッションをクリア
  if (IS_ELECTRON && window.electronAPI?.clearXSession) {
    await window.electronAPI.clearXSession(partition);
  }
  state.xs.splice(idx, 1);
  // activeX を調整
  if (state.activeX >= state.xs.length) state.activeX = Math.max(0, state.xs.length - 1);
  saveState();
  updateLoginUI();
  // アプリが開いていれば再レンダリング
  const app = document.getElementById('app');
  if (app.style.display !== 'none' && app.style.display !== '') renderApp();
  toast('Xアカウントを削除しました');
}

function logoutX() {
  // 後方互換性のため残す（現在はremoveXAccountを使用）
  if (state.xs && state.xs.length > 0) removeXAccount(0);
}

async function loginBluesky() {
  const handle = document.getElementById('b-user').value.trim();
  const pass = document.getElementById('b-pass').value.trim();
  const errEl = document.getElementById('b-err');
  const btn = document.getElementById('b-login-btn');
  errEl.textContent = '';
  if (!handle) { errEl.textContent = 'ハンドルを入力してください'; return; }
  if (!pass) { errEl.textContent = 'アプリパスワードを入力してください'; return; }

  btn.disabled = true;
  btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> 認証中…`;

  try {
    const session = await bsky.login(handle, pass);
    state.b = {
      handle: session.handle, did: session.did,
      accessJwt: session.accessJwt, refreshJwt: session.refreshJwt,
      displayName: session.displayName || session.handle,
      avatar: null, bg: AVBG[1],
      initials: (session.displayName || session.handle).slice(0, 2).toUpperCase(),
    };
    // アバター取得
    try {
      const profile = await bsky.getProfile(session.accessJwt, session.handle);
      state.b.avatar = profile.avatar || null;
      state.b.displayName = profile.displayName || session.handle;
    } catch {}

    saveState();
    document.getElementById('b-pass').value = '';
    updateLoginUI();
    toast(`@${session.handle} でログインしました！`);
    const app2 = document.getElementById('app');
    if (!app2.style.display || app2.style.display === 'none') { enterApp(); } else { renderApp(); }
  } catch (e) {
    errEl.textContent = `エラー: ${e.message}`;
    document.getElementById('b-status').className = 'lsbar err';
    document.getElementById('b-status').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg> Bluesky でログイン`;
  }
}

function logoutBluesky() {
  state.b = null; saveState(); updateLoginUI();
  document.getElementById('b-user').value = '';
  toast('Bluesky からログアウトしました');
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
  if (!confirm('すべてのアカウントからログアウトしますか？')) return;
  // Xの全WebViewセッションをクリア
  if (IS_ELECTRON && window.electronAPI?.clearAllXSessions) {
    await window.electronAPI.clearAllXSessions();
  }
  // 全カラムの自動更新を停止
  refreshScheduler.clearAll();
  state = { xs: [], activeX: 0, b: null };
  saveState();
  columnRuntime.clearStoredLayout(); // カラムレイアウトもリセット
  closeAmenu();
  // 通知ポーリングを停止
  if (notifPollTimer) { clearInterval(notifPollTimer); notifPollTimer = null; }
  bskyUnreadCount = 0;
  document.getElementById('cols').innerHTML = addColBtnHTML();
  document.getElementById('app').style.display = 'none';
  updateLoginUI();
  document.getElementById('login-screen').classList.remove('hidden');
  toast('すべてのアカウントからログアウトしました');
}

// ─── APP RENDER ────────────────────────────────
function renderApp() {
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
  // Xアカウントはアバター表示のみ（クリックでアカウントメニュー）
  if ((state.xs || []).length > 0) {
    const first = state.xs[0];
    el.innerHTML += `<div class="sbav" style="background:${first.bg}" title="Xアカウント管理" onclick="toggleAmenu()">${first.initials}<div class="adot x"></div></div>`;
  }
  if (state.b) {
    const inner = state.b.avatar ? `<img src="${state.b.avatar}">` : state.b.initials;
    el.innerHTML += `<div class="sbav" style="background:${state.b.bg}" title="@${state.b.handle}" onclick="toggleAmenu()">${inner}<div class="adot b"></div></div>`;
  }

  // amenu items: Xアカウント一覧（削除のみ、切り替えなし）
  const mi = document.getElementById('amenu-items');
  mi.innerHTML = '';
  if ((state.xs || []).length > 0) {
    mi.innerHTML += `<div style="padding:6px 13px;font-size:10px;font-weight:600;color:var(--text3)">X アカウント</div>`;
    state.xs.forEach((a, i) => {
      mi.innerHTML += `<div class="aitem">
        <div class="aiav" style="background:${a.bg}">${a.initials}</div>
        <div class="aiinfo"><div class="ainame">${esc(a.username)}</div><div class="aihandle">X · WebView</div></div>
        <button onclick="event.stopPropagation();removeXAccount(${i})" style="padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:10px;font-family:inherit">削除</button>
      </div>`;
    });
  }
  if (state.b) {
    if ((state.xs || []).length > 0) mi.innerHTML += `<div class="amenu-sep"></div>`;
    mi.innerHTML += `<div style="padding:6px 13px;font-size:10px;font-weight:600;color:var(--text3)">Bluesky</div>`;
    const avHtml = state.b.avatar ? `<img src="${state.b.avatar}">` : state.b.initials;
    mi.innerHTML += `<div class="aitem"><div class="aiav" style="background:${state.b.bg};overflow:hidden;padding:0">${avHtml}</div><div class="aiinfo"><div class="ainame">${esc(state.b.displayName)}</div><div class="aihandle">@${state.b.handle}</div></div><span class="aplat b">Bluesky</span></div>`;
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
const autoRefreshTimers = refreshScheduler.timers;
const autoRefreshIntervals = refreshScheduler.intervals;
const DEFAULT_INTERVAL_MS = refreshScheduler.DEFAULT_INTERVAL_MS;

// カラムごとに初回発火をずらすためのカウンター
function setAutoRefresh(cid, ms, type, feedUri) {
  refreshScheduler.set(cid, ms, () => {
    silentRefreshBsky(cid, type, feedUri);
  });
}
function clearAutoRefresh(id) {
  refreshScheduler.clear(id);
}
async function silentRefreshBsky(cid, type, feedUri) {
  if (!state.b) return;
  const feedEl = document.getElementById(`feed-${cid}`);
  if (!feedEl) return;
  if (feedEl.querySelector('.feed-loading')) return;

  try {
    let items = [];
    if (type === 'timeline') { const d = await bskyCallWithRefresh(jwt => bsky.timeline(jwt, 10)); items = d.feed || []; }
    else if (type === 'feed' && feedUri) { const d = await bskyCallWithRefresh(jwt => bsky.feed(jwt, feedUri, 10)); items = d.feed || []; }
    else if (type === 'notif') { const d = await bskyCallWithRefresh(jwt => bsky.notifications(jwt, 10)); items = (d.notifications||[]).map(n=>({_notif:n})); }
    if (!items.length) return;

    // 現在フィードに表示中の全URIをセットで取得して重複を完全排除
    const existingUris = new Set(
      [...feedEl.querySelectorAll('.post[data-uri]')].map(el => el.dataset.uri)
    );
    // 通知はdata-uriがないため先頭要素のindexedAtで判定
    const firstNotifTime = feedEl.querySelector('.notif')?.dataset?.time;

    const newItems = items.filter(it => {
      if (it._notif) {
        // 通知: 既存の先頭より新しいものだけ
        if (!firstNotifTime) return true;
        return new Date(it._notif.indexedAt) > new Date(firstNotifTime);
      }
      const uri = it.post?.uri;
      if (!uri) return true;
      return !existingUris.has(uri);
    });
    if (!newItems.length) return;

    const html = newItems
      .filter(item => item._notif ? !isNgNotif(item._notif) : !isNgPost(item))
      .map(item => item._notif ? renderBskyNotif(item._notif) : renderBskyPost(item)).join('');
    if (!html) return;

    const prevScrollTop = feedEl.scrollTop;
    const atTop = prevScrollTop < 50;

    // 挿入前の新着要素数を記録（挿入後に新規分だけへ .sd-new を付けるため）
    const beforeCount = feedEl.children.length;
    feedEl.insertAdjacentHTML('afterbegin', html);
    const afterCount = feedEl.children.length;
    const addedCount = afterCount - beforeCount;

    // 新規挿入分にフェードインクラスを付与
    const addedEls = [];
    for (let i = 0; i < addedCount; i++) {
      const el = feedEl.children[i];
      if (el) { el.classList.add('sd-new'); addedEls.push(el); }
    }

    if (atTop) {
      // 最上部にいる場合: 新着が見えるよう滑らかにトップへ
      requestAnimationFrame(() => {
        feedEl.scrollTo({ top: 0, behavior: 'smooth' });
      });
    } else {
      // 下方を見ている場合: 表示中の投稿がずれないようスクロール量を補正
      // 画像読み込み前の高さで計算されるズレを防ぐため2フレーム後に再計測
      requestAnimationFrame(() => {
        let addedHeight = 0;
        addedEls.forEach(el => { addedHeight += el.offsetHeight; });
        feedEl.scrollTop = prevScrollTop + addedHeight;
        // 画像読込後の再補正
        requestAnimationFrame(() => {
          let h2 = 0;
          addedEls.forEach(el => { h2 += el.offsetHeight; });
          if (h2 !== addedHeight) feedEl.scrollTop = prevScrollTop + h2;
        });
      });
    }

    // フェードイン後にクラス除去（アニメ完了）
    setTimeout(() => addedEls.forEach(el => el.classList.remove('sd-new')), 600);

    // DOM上限: スクロール位置が先頭近くなら末尾を削除してメモリ節約
    if (feedEl.scrollTop < 100) {
      const MAX_POSTS = 300;
      const posts = feedEl.querySelectorAll('.post, .notif');
      if (posts.length > MAX_POSTS) {
        for (let i = MAX_POSTS; i < posts.length; i++) posts[i].remove();
      }
    }

    const badge = document.getElementById(`badge-${cid}`);
    if (badge) { badge.textContent = `+${newItems.length}`; badge.style.display = ''; setTimeout(() => { badge.style.display = 'none'; }, 5000); }
  } catch(e) {}
}

function addColBtnHTML() {
  return `<button class="add-col-btn" onclick="openAddMod()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>追加</button>`;
}

function renderDefaultCols() {
  const cols = document.getElementById('cols');
  cols.querySelectorAll('.col').forEach(c => c.remove());

  // 保存済みレイアウトがあれば復元
  if (restoreColLayout()) return;

  // 初回起動: Blueskyのデフォルトカラムのみ追加
  if (state.b) {
    insertBskyCol({ id: 'b-home', title: 'ホーム', sub: 'Bluesky', type: 'timeline', icCls: 'ic-b', icon: SVG.bsky });
    insertBskyCol({ id: 'b-notif', title: '通知', sub: 'Bluesky', type: 'notif', icCls: 'ic-n', icon: SVG.bell });
  }
}

// ─── WEBVIEW COLUMN (X) ─────────────────────────
function insertWebViewCol(cfg, before = null, partition = 'persist:x') {
  const cols = document.getElementById('cols');
  const addbtn = before || cols.querySelector('.add-col-btn');
  const div = document.createElement('div');
  div.className = 'col';
  div.id = `col-${cfg.id}`;
  div.innerHTML = `
    <div class="col-head">
      <div class="col-ic ${cfg.icCls}">${cfg.icon}</div>
      <div class="col-info" style="cursor:pointer" title="先頭へスクロール / ダブルクリックで展開" draggable="false" onclick="wvScrollTop('${cfg.id}')" ondblclick="if(collapsedCols.has('${cfg.id}'))toggleColCollapse('${cfg.id}')">
        <div class="col-title">${cfg.title}</div>
        <div class="col-sub"><div class="ldot" style="background:#e7e9ea"></div>${cfg.sub}</div>
      </div>
      <div class="col-actions">
        <button class="cbtn col-collapse-btn" title="折りたたむ" onclick="toggleColCollapse('${cfg.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg></button>
        <button class="cbtn" title="戻る" onclick="wvBack('${cfg.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button class="cbtn" id="rfr-${cfg.id}" title="更新" onclick="wvReload('${cfg.id}', { silent: true })"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
        <button class="cbtn" title="自動更新設定" onclick="openColSettings('${cfg.id}','wv')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg></button>
        <button class="cbtn" title="削除" onclick="removeCol('${cfg.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>
    <div class="col-webview" style="position:relative">
      <div class="webview-loading" id="wvload-${cfg.id}"><div class="spinner"></div>読み込み中…</div>
      <webview
        id="wv-${cfg.id}"
        src="${cfg.url}"
        style="flex:1;display:none"
        partition="${partition}"
        webpreferences="backgroundThrottling=false"
        ${wvPreloadPath ? `preload="${wvPreloadPath}"` : ''}
      ></webview>
      <!-- スムーズリロード用オーバーレイ（リロード中に現在の画面を表示し続ける） -->
      <div id="wvov-${cfg.id}" style="display:none;position:absolute;inset:0;z-index:10;pointer-events:none;opacity:1;transition:opacity .4s ease"></div>
    </div>
  `;
  cols.insertBefore(div, addbtn);

  // webview イベント
  const wv = div.querySelector('webview');
  if (wv) {
    // 全ページ共通スタイル（サイドバー・ヘッダー非表示・スクロールバー等）
    const XSTYLES_BASE = `
      [data-testid="sidebarColumn"]{display:none!important}
      [data-testid="DMDrawer"]{display:none!important}
      header[role="banner"]{display:none!important}
      .r-1mhb1uw{display:none!important}
      body{overflow-x:hidden!important}
      [data-testid="WhoToFollow"]{display:none!important}
      [data-testid="UserRecommendations"]{display:none!important}
      *{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent}
      *::-webkit-scrollbar{width:3px;height:3px}
      *::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px}
      *::-webkit-scrollbar-track{background:transparent}
    `;

    // ホームの投稿欄を非表示（SocialDeckモーダルを使うため）
    const XSTYLES_HOME_COMPOSE = `
      [data-testid="tweetButtonInline"]{display:none!important}
      [data-testid="tweetTextarea_0"]{display:none!important}
      [data-testid="tweetTextarea_0_label"]{display:none!important}
      [data-testid="toolBar"]{display:none!important}
      [data-testid="tweetTextarea_0RichTextInputContainer"]{display:none!important}
      div:has(>[data-testid="tweetTextarea_0"]){display:none!important}
    `;

    // WebView内でstyleタグをDOMベースで制御するスクリプト
    // 返信ダイアログはURLが変わらずDOMのみ変化するため、
    // data-testid="tweetButton" の出現/消滅で返信モードを判定する
    // （ホーム投稿欄には tweetButtonInline のみ存在し tweetButton は存在しない）
    const X_STYLE_SCRIPT = `
      (function() {
        // ベーススタイルを挿入（1回だけ）
        if (!document.getElementById('__sd_base_style')) {
          const s = document.createElement('style');
          s.id = '__sd_base_style';
          s.textContent = ${JSON.stringify(XSTYLES_BASE)};
          document.head.appendChild(s);
        }

        // 投稿欄非表示スタイルのON/OFF制御
        function setComposeHide(hide) {
          let cs = document.getElementById('__sd_compose_style');
          if (!cs) {
            cs = document.createElement('style');
            cs.id = '__sd_compose_style';
            document.head.appendChild(cs);
          }
          cs.textContent = hide ? ${JSON.stringify(XSTYLES_HOME_COMPOSE)} : '';
        }

        function checkCompose() {
          // tweetButton（返信・新規投稿確定ボタン）が存在する = 返信ダイアログが開いている
          // ホームの投稿欄には tweetButtonInline のみ存在し tweetButton は存在しない
          const isReplyOpen = !!document.querySelector('[data-testid="tweetButton"]');
          setComposeHide(!isReplyOpen);
        }

        // 初回チェック
        checkCompose();

        // DOM変化を監視して自動切り替え（50msデバウンスで負荷軽減）
        if (window._sdStyleObserver) {
          window._sdStyleObserver.disconnect();
        }
        let _sdComposeDebounce = null;
        window._sdStyleObserver = new MutationObserver(() => {
          clearTimeout(_sdComposeDebounce);
          _sdComposeDebounce = setTimeout(checkCompose, 50);
        });
        window._sdStyleObserver.observe(document.body, { childList: true, subtree: true });
      })();
    `;

    const applyXStyles = () => {
      wv.executeJavaScript(X_STYLE_SCRIPT).catch(() => {});
    };

    // ── 新着自動読み込みスクリプト ──
    // 1. 可視性偽装: Xが常に「見られている」と認識し新着ポーリングを継続する
    //    (バックグラウンド時にXがポーリングを止めてバナーが出なくなる問題への対策)
    // 2. バナー不可視化＆自動クリック: 「新しいポストを表示」バナーをCSSで隠し、
    //    出現をMutationObserverで検知して即クリック → 新着が静かにTLに積まれる
    const X_AUTOLOAD_SCRIPT = `
      (function() {
        // ── 可視性偽装（1回だけ） ──
        if (!window._sdVisSpoofed) {
          window._sdVisSpoofed = true;
          try {
            Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
            Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
            // visibilitychangeイベントの発火を無効化（hiddenへの遷移をXに知らせない）
            document.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); }, true);
            // requestAnimationFrameもバックグラウンドで止まるため、フォールバックを提供
            window.addEventListener('blur', function(e) { e.stopImmediatePropagation(); }, true);
          } catch(err) {}
        }

        // ── バナー不可視化CSS（1回だけ） ──
        if (!document.getElementById('__sd_banner_hide')) {
          var s = document.createElement('style');
          s.id = '__sd_banner_hide';
          // バナーを視覚的に隠すがクリックは可能な状態にする
          s.textContent = '[data-testid$="-newTweetsButton"]{opacity:0!important;pointer-events:none!important;height:0!important;min-height:0!important;overflow:hidden!important}';
          document.head.appendChild(s);
        }

        // ── バナー自動クリック監視（1回だけ） ──
        function findBanner() {
          return document.querySelector('[data-testid$="-newTweetsButton"]')
            || Array.from(document.querySelectorAll('[role="button"]')).find(function(b) {
                return /新しいポスト|新しいツイート|Show \\d+ posts?/i.test(b.textContent || '');
            });
        }
        function clickBanner() {
          var b = findBanner();
          if (b) {
            var scroller = document.scrollingElement || document.documentElement;
            var atTop = scroller.scrollTop < 60;
            b.click();
            // 最上部にいたときだけトップを維持（新着の先頭が見える）
            if (atTop) setTimeout(function(){ window.scrollTo({top:0,behavior:'auto'}); }, 120);
            return true;
          }
          return false;
        }

        if (!window._sdBannerObserver) {
          // 初回チェック
          clickBanner();
          window._sdBannerObserver = new MutationObserver(function() {
            clearTimeout(window._sdBannerDebounce);
            window._sdBannerDebounce = setTimeout(clickBanner, 200);
          });
          window._sdBannerObserver.observe(document.body, { childList: true, subtree: true });
        }
      })();
    `;

    const applyXAutoload = () => {
      wv.executeJavaScript(X_AUTOLOAD_SCRIPT).catch(() => {});
    };

    // 広告非表示をMutationObserverで安全に実施
    const X_AD_SCRIPT = `
      (function() {
        // 既存のObserverを切断して再接続（ページ遷移後も確実に動作させる）
        if (window._sdAdObserver) {
          window._sdAdObserver.disconnect();
          window._sdAdObserver = null;
        }

        function hideAds() {
          document.querySelectorAll('[data-testid="placementTracking"]').forEach(pt => {
            const cell = pt.closest('[data-testid="cellInnerDiv"]');
            if (!cell || cell.style.display === 'none') return;
            const tweet = pt.closest('[data-testid="tweet"]');
            if (!tweet) cell.style.display = 'none';
          });
        }

        hideAds();
        let _adTimer = null;
        window._sdAdObserver = new MutationObserver(() => {
          if (_adTimer) return;
          _adTimer = setTimeout(() => { _adTimer = null; hideAds(); }, 500);
        });
        window._sdAdObserver.observe(document.body, { childList: true, subtree: true });
      })();
    `;

    // X画像クリックをSocialDeckのライトボックスに繋ぐスクリプト
    const X_IMG_SCRIPT = `
      (function() {
        // 既存リスナーを削除して毎回最新版を登録
        if (window._sdImgHandlerFn) {
          document.removeEventListener('click', window._sdImgHandlerFn, true);
        }

        function isVideoPhoto(photo) {
          if (photo.querySelector('video')) return true;
          if (photo.querySelector('[data-testid="gifPlayer"]')) return true;
          if (photo.closest('[data-testid="videoPlayer"]')) return true;
          if (photo.closest('[data-testid="gifPlayer"]')) return true;
          if (photo.closest('[data-testid="videoComponent"]')) return true;
          // 再生ボタンが兄弟要素にあれば動画
          if (photo.parentElement?.querySelector('[data-testid="playButton"]')) return true;
          // imgのalt属性が「動画」を含む（例: 埋め込み動画）
          const imgAlt = photo.querySelector('img')?.getAttribute('alt') || '';
          if (imgAlt.includes('動画') || imgAlt.toLowerCase().includes('video') || imgAlt.includes('gif') || imgAlt.includes('GIF')) return true;
          // 動画サムネイルはamplify_video_thumbのURLを持つ
          const img = photo.querySelector('img');
          if (img?.src?.includes('amplify_video_thumb')) return true;
          if (img?.src?.includes('ext_tw_video_thumb')) return true;
          if (img?.src?.includes('tweet_video_thumb')) return true;
          // 3階層上のコンテナに動画要素があれば動画
          const container = photo.parentElement?.parentElement?.parentElement;
          if (container?.querySelector('video, [data-testid="videoPlayer"], [data-testid="gifPlayer"], [data-testid="playButton"]')) return true;
          return false;
        }

        window._sdImgHandlerFn = e => {
          // videoPlayer・gifPlayer・再生ボタン自体のクリックは除外
          if (e.target.closest('[data-testid="videoPlayer"]')) return;
          if (e.target.closest('[data-testid="gifPlayer"]')) return;
          if (e.target.closest('[data-testid="playButton"]')) return;
          if (e.target.closest('[data-testid="videoComponent"]')) return;

          const imgEl = e.target.closest('[data-testid="tweetPhoto"]');
          if (!imgEl) return;

          // 動画・GIF判定
          if (isVideoPhoto(imgEl)) return;

          // pbs.twimg.com の画像のみ収集（動画と判定されないphotoのみ）
          const tweet = imgEl.closest('[data-testid="tweet"]') || document.body;
          const allImgs = [...tweet.querySelectorAll('[data-testid="tweetPhoto"]')]
            .filter(photo => !isVideoPhoto(photo))
            .map(photo => {
              const img = photo.querySelector('img');
              if (!img || !img.src.includes('pbs.twimg.com/media/')) return null;
              return img.src.split('&name=')[0] + '&name=large';
            })
            .filter(Boolean);

          if (!allImgs.length) return;

          const clickedImg = imgEl.querySelector('img');
          const clickedBase = (clickedImg?.src || '').split('&name=')[0];
          let idx = allImgs.findIndex(u => u.split('&name=')[0] === clickedBase);
          if (idx < 0) idx = 0;

          e.preventDefault();
          e.stopPropagation();
          window.postMessage(JSON.stringify({ _sdType: 'x-img-open', urls: allImgs, idx }), '*');
        };
        document.addEventListener('click', window._sdImgHandlerFn, true);
      })();
    `;

    // X返信ボタンをSocialDeckの投稿モーダルに繋ぐスクリプト
    // dom-ready: スピナーを消してwebviewを表示
    let _domReadyOnce = false;
    wv.addEventListener('dom-ready', () => {
      document.getElementById(`wvload-${cfg.id}`).style.display = 'none';
      wv.style.display = 'flex';
      wv.style.flex = '1';
      applyXStyles();
      applyXAutoload();
      wv.executeJavaScript(X_AD_SCRIPT).catch(() => {});
      wv.executeJavaScript(X_IMG_SCRIPT).catch(() => {});
      // 自動更新タイマーは初回のみ設定（ShareX等による dom-ready 再発火でリセットされないように）
      if (!_domReadyOnce) {
        _domReadyOnce = true;
        if (autoRefreshIntervals[cfg.id] === undefined) {
          setAutoRefreshWv(cfg.id, DEFAULT_INTERVAL_MS);
        }
      }
    });

    // did-finish-load: スタイル再注入・広告除去・オーバーレイフェードアウト
    wv.addEventListener('did-finish-load', () => {
      wvSilentReloading.delete(cfg.id);
      setWvRefreshBusy(cfg.id, false);
      wv.style.opacity = wv.dataset.sdPrevOpacity || '';
      delete wv.dataset.sdPrevOpacity;
      applyXStyles();
      applyXAutoload();
      const savedFs = parseInt(localStorage.getItem(`col_fs_${cfg.id}`));
      if (savedFs && savedFs !== 13) {
        wv.insertCSS(`* { font-size: ${savedFs}px !important; }`).catch(() => {});
      }
      wv.executeJavaScript(X_AD_SCRIPT).catch(() => {});
      wv.executeJavaScript(X_IMG_SCRIPT).catch(() => {});
      // ナビゲーション完了後にレイアウトを保存（正規化済みURLが使われる）
      saveColLayout();

      const ov = document.getElementById(`wvov-${cfg.id}`);
      if (ov && ov.style.display !== 'none') {
        ov.style.opacity = '0';
        setTimeout(() => {
          ov.style.display = 'none';
          ov.style.backgroundImage = '';
          ov.style.opacity = '1';
        }, 420);
      }
    });

    // WebViewからのipc-messageを受信
    wv.addEventListener('ipc-message', e => {
      if (e.channel === 'x-img-open') {
        try {
          const { urls, idx } = JSON.parse(e.args[0]);
          if (urls && urls.length) openImg(urls, idx);
        } catch {}
      }
    });

    wv.addEventListener('did-fail-load', () => {
      wvSilentReloading.delete(cfg.id);
      setWvRefreshBusy(cfg.id, false);
      wv.style.opacity = wv.dataset.sdPrevOpacity || '';
      delete wv.dataset.sdPrevOpacity;
      document.getElementById(`wvload-${cfg.id}`).innerHTML = `<div style="color:var(--red);font-size:12px;text-align:center;padding:20px">読み込みに失敗しました<br><button onclick="wvReload('${cfg.id}')" style="margin-top:8px;padding:4px 10px;border-radius:5px;background:transparent;border:1px solid var(--red);color:var(--red);cursor:pointer;font-size:11px">再試行</button></div>`;
    });
  }
}

function wvBack(id) { const wv = document.getElementById(`wv-${id}`); if (wv?.canGoBack()) wv.goBack(); }

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
    saveColLayout();
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
    saveColLayout();
  }
}

function openFirstXWebViewDevTools() {
  // カラムの順番通りに最初のx.com/homeのWebViewを取得
  const cols = document.getElementById('cols');
  let target = null;
  cols?.querySelectorAll('.col').forEach(col => {
    if (target) return;
    const wv = col.querySelector('webview');
    if (wv?.src?.includes('x.com')) {
      if (!target) target = wv;
      if (wv.src.includes('x.com/home')) target = wv;
    }
  });
  // 最初のx.com/homeを確実に取得
  cols?.querySelectorAll('.col').forEach(col => {
    const wv = col.querySelector('webview');
    if (wv?.src?.includes('x.com/home') && !target?.src?.includes('x.com/home')) target = wv;
  });
  if (target) target.openDevTools();
  else toast('XカラムのWebViewが見つかりません');
}

// カラムヘッダークリックで先頭へスクロール
// カラムヘッダークリックで先頭へ（元のURLに戻してリロード）
function wvScrollTop(id) {
  // 折りたたみ中はシングルクリックでも展開
  if (collapsedCols.has(id)) { toggleColCollapse(id); return; }

  const col = document.getElementById(`col-${id}`);
  const wv = document.getElementById(`wv-${id}`);
  if (!wv || !col) return;

  const layout = loadColLayout();
  const saved = layout.find(c => c.id === id);
  const originalUrl = saved?.url || wv.src;

  if (wv.src === originalUrl) {
    wvReload(id);
  } else {
    wv.src = originalUrl;
  }
}

function bskyScrollTop(cid) {
  // 折りたたみ中はシングルクリックでも展開
  if (collapsedCols.has(cid)) { toggleColCollapse(cid); return; }
  const feedEl = document.getElementById(`feed-${cid}`);
  if (feedEl) feedEl.scrollTo({ top: 0, behavior: 'smooth' });
}

// スムーズリロード: キャプチャ → オーバーレイ表示 → reload → フェードアウト
let xPostingNow = false;
const wvReloadQueue = new Set();
const wvSilentReloading = new Set();

function setWvRefreshBusy(id, busy) {
  const btn = document.getElementById(`rfr-${id}`);
  if (btn) btn.classList.toggle('updating', !!busy);
  const sub = document.querySelector(`#col-${id} .col-sub`);
  if (!sub) return;
  if (busy) {
    if (!sub.dataset.origText) sub.dataset.origText = sub.innerHTML;
    sub.innerHTML = '<div class="ldot" style="background:var(--accent)"></div>更新中...';
  } else if (sub.dataset.origText) {
    sub.innerHTML = sub.dataset.origText;
    delete sub.dataset.origText;
  }
}

async function wvReload(id, opts = {}) {
  const wv = document.getElementById(`wv-${id}`);
  if (!wv) return;

  if (xPostingNow) {
    wvReloadQueue.add(id);
    return;
  }

  const ov = document.getElementById(`wvov-${id}`);
  const silent = opts.silent !== false;
  if (silent) {
    wvSilentReloading.add(id);
    setWvRefreshBusy(id, true);
  }

  if (silent && ov && wv.style.display !== 'none') {
    try {
      const dataUrl = await wv.capturePage().then(img => img.toDataURL());
      ov.style.backgroundImage = `url(${dataUrl})`;
      ov.style.backgroundSize = '100% auto';
      ov.style.backgroundRepeat = 'no-repeat';
      ov.style.backgroundPosition = 'top left';
      ov.style.display = 'block';
      ov.style.opacity = '1';
      wv.dataset.sdPrevOpacity = wv.style.opacity || '';
      wv.style.opacity = '0';
    } catch (e) {
      ov.style.backgroundImage = '';
      ov.style.backgroundColor = '#000';
      ov.style.display = 'block';
      ov.style.opacity = '1';
      wv.dataset.sdPrevOpacity = wv.style.opacity || '';
      wv.style.opacity = '0';
    }
  }

  wv.reload();
  if (silent) {
    setTimeout(() => {
      if (wvSilentReloading.has(id)) {
        wvSilentReloading.delete(id);
        setWvRefreshBusy(id, false);
        wv.style.opacity = wv.dataset.sdPrevOpacity || '';
        delete wv.dataset.sdPrevOpacity;
      }
    }, 30000);
  }
}

function flushWvReloadQueue() {
  if (wvReloadQueue.size === 0) return;
  const ids = [...wvReloadQueue];
  wvReloadQueue.clear();
  ids.forEach(id => wvReload(id, { silent: true }));
}

// ソフトリロード: ページ全体を再読み込みせず、Xの「新しいポスト」ボタンをクリックして
// 新着を読み込む。スクロール位置とセッションが維持されるため視点が飛ばない。
// 成功したらtrue、ボタンが無い/失敗ならfalseを返す（呼び出し側でフォールバック判断）
async function softReloadX(id) {
  const wv = document.getElementById(`wv-${id}`);
  if (!wv || wv.style.display === 'none') return false;
  if (xPostingNow) { wvReloadQueue.add(id); return true; }

  try {
    const result = await wv.executeJavaScript(`
      (function() {
        return new Promise(function(resolve) {
          // 「新しいポストを表示」バナーボタンを探す
          function findBanner() {
            return document.querySelector('[data-testid="cellInnerDiv"] [role="button"][data-testid$="-newTweetsButton"]')
              || Array.from(document.querySelectorAll('[role="button"]')).find(function(b) {
                  return /新しいポスト|新しいツイート|Show .* posts?/i.test(b.textContent || '');
              });
          }

          var scroller = document.scrollingElement || document.documentElement;
          var atTop = scroller.scrollTop < 60;
          var banner = findBanner();

          // バナーが既にある → クリックして反映
          if (banner) {
            banner.click();
            if (atTop) setTimeout(function(){ window.scrollTo({top:0,behavior:'smooth'}); }, 150);
            resolve('clicked');
            return;
          }

          // 最上部でバナーが無い → Xに新着ロードを促す
          if (atTop) {
            var origTop = scroller.scrollTop;
            // ごく短い下→上のプル動作で新着取得をトリガー
            window.scrollTo({ top: origTop + 60, behavior: 'auto' });
            setTimeout(function() {
              window.scrollTo({ top: origTop, behavior: 'auto' });
              // 少し待ってバナー出現をチェック
              setTimeout(function() {
                var b2 = findBanner();
                if (b2) {
                  b2.click();
                  setTimeout(function(){ window.scrollTo({top:0,behavior:'smooth'}); }, 150);
                  resolve('clicked');
                } else {
                  // バナーが出ない → フォールバックを要求
                  resolve('none');
                }
              }, 800);
            }, 60);
            return;
          }

          // 下の方を見ている → 何もしない（視点維持、次回バナー出現時に取得）
          resolve('scrolled');
        });
      })();
    `);
    // 'clicked' と 'scrolled' は成功扱い。'none' はフォールバック要求
    return result === 'clicked';
  } catch {
    return false;
  }
}

function setAutoRefreshWv(id, ms) {
  refreshScheduler.set(id, ms, async () => {
    // まずソフトリロードを試み、効かない場合のみ従来のフルリロード
    const ok = await softReloadX(id);
    if (!ok) wvReload(id, { silent: true });
  });
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
  // refreshBskyCol が type と feedUri を読み取れるように dataset に保存
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
        <button class="cbtn" id="rfr-${cid}" title="更新" onclick="refreshBskyCol('${cid}',this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
        <button class="cbtn col-collapse-btn" title="折りたたむ" onclick="toggleColCollapse('${cid}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg></button>
        <button class="cbtn" title="自動更新設定" onclick="openColSettings('${cid}','bsky','${cfg.type||`timeline`}','${cfg.feedUri||``}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg></button>
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
    setAutoRefresh(cid, DEFAULT_INTERVAL_MS, cfg.type, cfg.feedUri);
  }
  // フォントサイズ設定を復元
  const savedFs = parseInt(localStorage.getItem(`col_fs_${cid}`));
  if (savedFs) {
    const feedEl = document.getElementById(`feed-${cid}`);
    if (feedEl) feedEl.style.fontSize = savedFs + 'px';
  }
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
      // 通知読み込み完了後に既読マーク（ベストエフォート）
      if (!append) {
        bskyCallWithRefresh(jwt => bsky.updateSeen(jwt, new Date().toISOString()))
          .then(() => {
            bskyUnreadCount = 0;
            const badge = document.getElementById('bsky-notif-badge');
            if (badge) badge.style.display = 'none';
            const btn = document.getElementById('sb-notif-b');
            if (btn) btn.style.color = '';
          })
          .catch(() => {});
      }
    }

    colCursors[cid] = newCursor;
    const html = items
      .filter(item => item._notif ? !isNgNotif(item._notif) : !isNgPost(item))
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

function refreshBskyCol(cid, btn) {
  btn.classList.add('spin');
  const col = document.getElementById(`col-${cid}`);
  const type = col?.dataset?.type || 'timeline';
  const feedUri = col?.dataset?.feeduri || null;
  loadBskyFeed(cid, type, feedUri).finally(() => btn.classList.remove('spin'));
}

function removeCol(id) {
  clearAutoRefresh(id);
  const el = document.getElementById(`col-${id}`);
  if (el) el.remove();
  saveColLayout();
}

// ─── BLUESKY POST RENDERING ──────────────────────


function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function relTime(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return `${Math.floor(s)}秒`;
  if (s < 3600) return `${Math.floor(s / 60)}分`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間`;
  return `${Math.floor(s / 86400)}日`;
}

function avBgFor(handle) { return AVBG[Math.abs((handle || '').charCodeAt(0) || 0) % AVBG.length]; }

function renderAvatar(author, size = 34) {
  const bg = avBgFor(author.handle);
  const init = esc((author.displayName || author.handle || '?').slice(0, 2).toUpperCase());
  const img = author.avatar ? `<img src="${esc(author.avatar)}" loading="lazy" onerror="this.style.display='none'">` : '';
  const did = esc(author.did || '');
  const handle = esc(author.handle || '');
  return `<div class="av" style="width:${size}px;height:${size}px;background:${bg};font-size:${size < 32 ? 9 : 11}px;cursor:pointer"
    data-did="${did}" data-handle="${handle}"
    onmouseenter="hoverCardShow(event,'${did}','${handle}')"
    onmouseleave="hoverCardHide()"
  >${img}${img ? '' : init}<div class="pdot">${SVG.bsky.replace('viewBox', 'width="7" height="7" viewBox')}</div></div>`;
}

function formatText(text, facets) {
  if (!facets || !facets.length) return esc(text).replace(/\n/g, '<br>');
  // facets でリンク・メンション・タグを処理
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  let result = '', pos = 0;
  const sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);
  const dec = new TextDecoder();
  for (const facet of sorted) {
    if (facet.index.byteStart > pos) result += esc(dec.decode(bytes.slice(pos, facet.index.byteStart))).replace(/\n/g, '<br>');
    const seg = dec.decode(bytes.slice(facet.index.byteStart, facet.index.byteEnd));
    const feat = facet.features?.[0];
    if (feat?.$type === 'app.bsky.richtext.facet#link') {
      result += `<a href="${esc(feat.uri)}" target="_blank">${esc(seg)}</a>`;
    } else if (feat?.$type === 'app.bsky.richtext.facet#mention') {
      result += `<a href="#" onclick="event.preventDefault();showProfile('${esc(feat.did)}')">${esc(seg)}</a>`;
    } else if (feat?.$type === 'app.bsky.richtext.facet#tag') {
      result += `<a href="#" style="color:var(--accent)" onclick="event.preventDefault()">${esc(seg)}</a>`;
    } else {
      result += esc(seg);
    }
    pos = facet.index.byteEnd;
  }
  if (pos < bytes.length) result += esc(dec.decode(bytes.slice(pos))).replace(/\n/g, '<br>');
  return result;
}

function renderBskyPost(item) {
  const post = item.post;
  if (!post) return '';
  const author = post.author;
  const record = post.record;
  if (!record) return '';

  const isRepost = item.reason?.$type === 'app.bsky.feed.defs#reasonRepost';
  const reposter = isRepost ? item.reason.by : null;

  const body = formatText(record.text || '', record.facets);
  const time = relTime(record.createdAt);
  const likes = post.likeCount || 0;
  const rts = (post.repostCount || 0);
  const replies = post.replyCount || 0;
  const liked = !!post.viewer?.like;
  const reposted = !!post.viewer?.repost;
  const uri = post.uri, cid = post.cid;

  // 画像
  let imgHtml = '';
  const embed = post.embed;
  if (embed) {
    const imgs = embed.images || embed.media?.images || [];
    if (imgs.length) {
      const cls = ['', 'n1', 'n2', 'n3', 'n4'][Math.min(imgs.length, 4)];
      // data-urls属性にURLをJSON格納してonclickから取得
      // グローバル変数方式はリロード後に参照が切れるためこちらを使用
      const urlArr = imgs.slice(0, 4).map(img => img.fullsize || img.thumb);
      imgHtml = `<div class="p-imgs ${cls}" data-urls="${esc(JSON.stringify(urlArr))}">${urlArr.map((url, idx) => {
        const img = imgs[idx];
        return `<img src="${esc(img.thumb || img.fullsize)}" alt="${esc(img.alt || '')}" loading="lazy"
          style="cursor:zoom-in"
          onclick="openImg(JSON.parse(this.closest('.p-imgs').dataset.urls), ${idx})">`;
      }).join('')}</div>`;
    }
    // 引用ポスト
    if (embed.$type === 'app.bsky.embed.record#view' && embed.record?.value) {
      const q = embed.record;
      const qtext = esc((q.value?.text || '').slice(0, 120));
      const qauthor = q.author;
      imgHtml += `<div class="p-quote"><div class="p-quote-author">${esc(qauthor?.displayName || qauthor?.handle || '?')}</div><div class="p-quote-text">${qtext}</div></div>`;
    }
    if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
      const qrec = embed.record?.record;
      if (qrec?.value) {
        imgHtml += `<div class="p-quote"><div class="p-quote-author">${esc(qrec.author?.displayName || qrec.author?.handle || '?')}</div><div class="p-quote-text">${esc((qrec.value?.text || '').slice(0, 120))}</div></div>`;
      }
    }
    // 外部リンクカード
    const extLink = embed.external || embed.media?.external;
    if (extLink && !imgs.length) {
      const thumb = extLink.thumb?.ref?.$link ? '' : (extLink.thumb || '');
      const thumbHtml = thumb ? `<img src="${esc(thumb)}" style="width:100%;height:100px;object-fit:cover;display:block;background:var(--bg3)" onerror="this.style.display='none'">` : '';
      imgHtml += `<a href="${esc(extLink.uri || '#')}" target="_blank" style="display:block;border:1px solid var(--border2);border-radius:8px;overflow:hidden;text-decoration:none;margin-top:2px">
        ${thumbHtml}
        <div style="padding:8px 10px;background:var(--bg2)">
          <div style="font-size:11px;color:var(--text3);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(extLink.uri ? new URL(extLink.uri).hostname : '')}</div>
          <div style="font-size:12px;font-weight:600;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(extLink.title || extLink.uri || '')}</div>
          ${extLink.description ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(extLink.description.slice(0, 100))}</div>` : ''}
        </div>
      </a>`;
    }
  }

  const repostLabel = reposter ? `<div class="repost-label">${SVG.rt} ${esc(reposter.displayName || reposter.handle)} さんがリポスト</div>` : '';

  const likeUri = post.viewer?.like || '';
  const repostUri = post.viewer?.repost || '';

  return `<div class="post" data-uri="${esc(uri)}" data-cid="${esc(cid)}" data-likeuri="${esc(likeUri)}" data-reposturi="${esc(repostUri)}" oncontextmenu="showPostMenu(event,'${esc(author.handle)}')">
    ${repostLabel}
    <div class="post-top">
      ${renderAvatar(author)}
      <div class="post-meta">
        <div class="meta-row">
          <span class="p-name" title="${esc(author.displayName || author.handle)}">${esc(author.displayName || author.handle)}</span>
          <span class="p-handle">@${esc(author.handle)}</span>
          <span class="p-time">${time}前</span>
        </div>
      </div>
    </div>
    <div class="p-body">${body}</div>
    ${imgHtml}
    <div class="p-acts">
      <button class="pa rep" onclick="openReply('${esc(uri)}','${esc(cid)}','${esc(author.handle)}')">${SVG.reply} ${replies}</button>
      <button class="pa rt ${reposted ? 'rted' : ''}" onclick="showRtMenu(event,this,'${esc(uri)}','${esc(cid)}','${esc(author.handle)}')">${SVG.rt} <span>${rts}</span></button>
      <button class="pa lk ${liked ? 'liked' : ''}" onclick="toggleLike(this,'${esc(uri)}','${esc(cid)}',${likes})">${SVG.heart.replace('none', liked ? 'currentColor' : 'none')} <span>${likes}</span></button>
    </div>
  </div>`;
}

function renderBskyNotif(n) {
  const a = n.author;
  const tp = n.reason;
  const icons = { like: SVG.heart, repost: SVG.rt, follow: SVG.follow, reply: SVG.reply, mention: SVG.reply, quote: SVG.reply };
  const cls = { like: 'ntlk', repost: 'ntrt', follow: 'ntfw', reply: 'ntrp', mention: 'ntrp', quote: 'ntrp' };
  const lbl = { like: 'いいね', repost: 'リポスト', follow: 'フォロー', reply: '返信', mention: 'メンション', quote: '引用' };
  const excerpt = n.record?.text ? esc(n.record.text.slice(0, 60)) + (n.record.text.length > 60 ? '…' : '') : '';
  return `<div class="notif" data-time="${esc(n.indexedAt || '')}">
    <div class="ntype ${cls[tp] || 'ntfw'}">${icons[tp] || icons.follow} ${esc(a.displayName || a.handle)} が${lbl[tp] || tp}</div>
    <div class="nrow">${renderAvatar(a, 28)}<div class="ninfo"><div class="nwho">${esc(a.displayName || a.handle)}</div>${excerpt ? `<div class="nex">${excerpt}</div>` : ''}<div class="nago">${relTime(n.indexedAt)}前</div></div></div>
  </div>`;
}

// ─── BLUESKY HOVER CARD ──────────────────────────
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
  const existing = document.getElementById('bsky-hover-card');
  if (existing) existing.remove();

  // カードを作成（ローディング状態）
  const card = document.createElement('div');
  card.id = 'bsky-hover-card';
  card.style.cssText = `
    position:fixed;z-index:9000;
    width:280px;background:var(--bg2);border:1px solid var(--border2);
    border-radius:12px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,.5);
    font-size:12px;color:var(--text1);
    opacity:0;transition:opacity .15s;pointer-events:all;
  `;
  card.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:var(--text3)"><div class="spinner" style="width:14px;height:14px;border-width:2px"></div>読み込み中…</div>`;
  card.addEventListener('mouseenter', () => clearTimeout(hoverCardHideTimer));
  card.addEventListener('mouseleave', () => { hoverCardHideTimer = setTimeout(_hoverCardRemove, 150); });
  document.body.appendChild(card);

  // 位置を決定
  _hoverCardPosition(card, target);
  requestAnimationFrame(() => { card.style.opacity = '1'; });

  // プロフィール取得（キャッシュ優先、上限50件）
  const key = did || handle;
  let profile = hoverCardCache[key];
  if (!profile) {
    try {
      profile = await bskyCallWithRefresh(jwt => bsky.getProfile(jwt, did || handle));
      // キャッシュが50件を超えたら古いものから削除
      const keys = Object.keys(hoverCardCache);
      if (keys.length >= 50) delete hoverCardCache[keys[0]];
      hoverCardCache[key] = profile;
    } catch (e) {
      if (document.getElementById('bsky-hover-card') === card) {
        card.innerHTML = `<div style="color:var(--red);font-size:11px">プロフィール取得エラー</div>`;
      }
      return;
    }
  }

  // カードが差し替えられていたら描画しない
  if (document.getElementById('bsky-hover-card') !== card) return;

  const avBg = avBgFor(profile.handle);
  const avInit = esc((profile.displayName || profile.handle || '?').slice(0, 2).toUpperCase());
  const avImg = profile.avatar ? `<img src="${esc(profile.avatar)}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:50%">` : '';
  const bannerStyle = profile.banner ? `background:url(${esc(profile.banner)}) center/cover` : `background:var(--bg3)`;
  const desc = profile.description ? esc(profile.description.slice(0, 120)) + (profile.description.length > 120 ? '…' : '') : '';

  const isFollowing = !!profile.viewer?.following;
  const followUri = profile.viewer?.following || '';
  const isMe = state.b?.did === profile.did;
  const followBtn = isMe ? '' : `
    <button id="hc-follow-btn"
      data-did="${esc(profile.did)}" data-handle="${esc(profile.handle)}" data-followuri="${esc(followUri)}"
      onclick="hoverCardToggleFollow(this)"
      style="padding:4px 13px;border-radius:20px;border:1px solid ${isFollowing ? 'var(--border2)' : 'var(--accent)'};background:${isFollowing ? 'transparent' : 'var(--accent)'};color:${isFollowing ? 'var(--text2)' : '#fff'};font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;transition:all .12s">
      ${isFollowing ? 'フォロー中' : 'フォロー'}
    </button>`;

  card.innerHTML = `
    <div style="height:48px;border-radius:8px;margin:-16px -16px 0;${bannerStyle}"></div>
    <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-top:-20px;margin-bottom:8px">
      <div style="position:relative;width:44px;height:44px;border-radius:50%;background:${avBg};border:3px solid var(--bg2);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">${avImg}${avImg ? '' : avInit}</div>
      <div style="display:flex;align-items:center;gap:8px">
        ${followBtn}
        <div style="font-size:11px;color:var(--text2)">
          <span><b style="color:var(--text1)">${profile.followersCount ?? '—'}</b> FF</span>
        </div>
      </div>
    </div>
    <div style="font-weight:700;font-size:13px;margin-bottom:2px">${esc(profile.displayName || profile.handle)}</div>
    <div style="color:var(--text3);font-size:11px;margin-bottom:${desc ? 6 : 0}px">@${esc(profile.handle)}</div>
    ${desc ? `<div style="color:var(--text2);font-size:11px;line-height:1.5">${desc}</div>` : ''}
    <div style="margin-top:8px;font-size:11px;color:var(--text3);display:flex;gap:12px">
      <span><b style="color:var(--text1)">${profile.followersCount ?? '—'}</b> フォロワー</span>
      <span><b style="color:var(--text1)">${profile.followsCount ?? '—'}</b> フォロー</span>
      <span><b style="color:var(--text1)">${profile.postsCount ?? '—'}</b> 投稿</span>
    </div>
  `;

  // 再度位置調整（コンテンツが入った後）
  _hoverCardPosition(card, target);
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
  const cardW = 280, cardH = 200; // 概算
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
async function toggleLike(btn, uri, cid, baseLikes) {
  if (!state.b) return;
  const post = btn.closest('.post');
  const on = !btn.classList.contains('liked');
  // 楽観的UI更新
  btn.classList.toggle('liked', on);
  const svg = btn.querySelector('svg');
  if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none');
  const span = btn.querySelector('span');
  if (span) span.textContent = on ? baseLikes + 1 : baseLikes;
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
    if (span) span.textContent = baseLikes;
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

  const rtLabel = isRted ? 'リポストを取り消す' : 'リポスト';
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
    toast('引用リポストしました！');
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

  // バックグラウンドでrootを取得
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
  // DIDからhandleを取得してbsky.appで開く（キャッシュ優先）
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

  // 既に同じプロフィールのカラムがあればそこへスクロール
  const existing = Array.from(document.querySelectorAll('webview')).find(w => w.src === url);
  if (existing) {
    const col = existing.closest('.col');
    if (col) {
      // 折りたたみ中なら展開
      const cid = col.id?.replace('col-', '');
      if (cid && collapsedCols.has(cid)) toggleColCollapse(cid);
      col.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      toast('既存のプロフィールカラムを表示しました');
      return;
    }
  }

  extraColN++;
  const id = `bsky-prof-${extraColN}`;
  insertWebViewCol({ id, title: 'プロフィール', sub: 'Bluesky', url, icCls: 'ic-b', icon: SVG.bsky }, null, 'persist:bsky');
  setTimeout(() => {
    const col = document.getElementById(`col-${id}`);
    if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'end' });
  }, 300);
  saveColLayout();
  toast('プロフィールカラムを開きました');
}

// ─── COMPOSE ────────────────────────────────────
function renderCompUI() {
  // サイドバー投稿ボタンの表示切り替え
  const xBtn = document.getElementById('sb-post-x');
  const bBtn = document.getElementById('sb-post-b');
  if (xBtn) xBtn.style.display = (state.xs && state.xs.length > 0) ? 'flex' : 'none';
  if (bBtn) bBtn.style.display = state.b ? 'flex' : 'none';

  // 通知アイコンを描画（sb-notif-iconsに一本化）
  renderNotifIcons();

  // Bluesky投稿モーダルのアバター設定
  const avEl = document.getElementById('comp-av');
  if (avEl && state.b) {
    avEl.style.background = state.b.bg || '';
    if (state.b.avatar) {
      avEl.innerHTML = `<img src="${state.b.avatar}"><span id="comp-av-txt" style="display:none"></span>`;
    } else {
      avEl.innerHTML = `<span id="comp-av-txt">${state.b.initials || '?'}</span>`;
    }
  }

  // X投稿モーダルのアバター設定
  const xAvEl = document.getElementById('x-post-av');
  const activeXAcc = state.xs?.[state.activeX || 0];
  if (xAvEl && activeXAcc) {
    xAvEl.style.background = activeXAcc.bg || '';
    xAvEl.innerHTML = `<span id="x-post-av-txt">${activeXAcc.initials || 'X'}</span>`;
  }
}

function openComp() {
  document.getElementById('compMod').classList.add('on');
  setTimeout(() => document.getElementById('cta')?.focus(), 50);
}

let selectedXIdx = 0; // 投稿に使うXアカウントのindex

function openXPost() {
  // アカウント選択UIを構築
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
}

// ─── X投稿 画像・動画管理 ────────────────────────
let xImgFiles = [];    // File[] 最大4枚
let xVideoFile = null; // 動画File（1本）
let xVideoPath = null; // 動画のローカルパス（Electron環境）
let xTrimIn = 0;       // トリム開始秒
let xTrimOut = 0;      // トリム終了秒

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
  const arr = composeMedia.toFiles(files);

  // 動画ファイルが混ざっている場合は動画優先
  const videoFile = composeMedia.firstVideo(arr);
  if (videoFile) {
    if (xImgFiles.length > 0) { toast('動画と画像は同時に添付できません（X仕様）'); return; }
    setXVideo(videoFile);
    const fi = document.getElementById('x-img-file');
    if (fi) fi.value = '';
    return;
  }

  // 動画選択済みなら画像は不可
  if (xVideoFile) { toast('動画と画像は同時に添付できません（X仕様）'); return; }

  const imageFiles = composeMedia.imageFiles(arr);
  const remaining = composeMedia.availableImageSlots(xImgFiles.length);
  if (remaining <= 0) { toast('画像は最大4枚まで'); return; }
  xImgFiles.push(...imageFiles.slice(0, remaining));
  renderXImgPreviews();
  const drop = document.getElementById('x-img-drop');
  if (drop) drop.style.opacity = xImgFiles.length >= 4 ? '0.4' : '1';
  const fi = document.getElementById('x-img-file');
  if (fi) fi.value = '';
  updXCC();
}

function removeXImg(idx) {
  xImgFiles.splice(idx, 1);
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
  container.innerHTML = xImgFiles.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `<div style="position:relative;width:72px;height:72px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--bg3)">
      <img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block">
      <button onclick="removeXImg(${i})"
        style="position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;border:none;background:rgba(0,0,0,0.75);color:#fff;cursor:pointer;font-size:11px;line-height:1;padding:0;font-family:inherit;display:flex;align-items:center;justify-content:center">✕</button>
    </div>`;
  }).join('');
}

// ── 動画追加・UI ──
function setXVideo(file) {
  xVideoFile = file;
  // Electron環境ではFileオブジェクトからローカルパスを取得できる
  xVideoPath = IS_ELECTRON && file.path ? file.path : null;

  const wrap = document.getElementById('x-video-wrap');
  const vid  = document.getElementById('x-video-preview');
  if (!wrap || !vid) return;

  if (vid.src?.startsWith('blob:')) URL.revokeObjectURL(vid.src);
  vid.src = URL.createObjectURL(file);

  vid.onloadedmetadata = () => {
    const dur = vid.duration;
    xTrimIn = 0;
    xTrimOut = dur;
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
  updXCC();
}

function removeXVideo() {
  const vid = document.getElementById('x-video-preview');
  if (vid) {
    vid.pause();
    vid.currentTime = 0;
    if (vid.src?.startsWith('blob:')) URL.revokeObjectURL(vid.src);
    vid.src = '';
    vid.load();
  }
  xVideoFile = null;
  xVideoPath = null;
  xTrimIn = 0; xTrimOut = 0;
  const wrap = document.getElementById('x-video-wrap');
  if (wrap) wrap.style.display = 'none';
  const drop = document.getElementById('x-img-drop');
  if (drop) { drop.style.opacity = '1'; drop.style.pointerEvents = ''; }
  const preview = document.getElementById('x-img-preview');
  if (preview) preview.innerHTML = '';
  setFFmpegStatus('');
  updXCC();
}

function onTrimIn(val) {
  const vid = document.getElementById('x-video-preview');
  if (!vid?.duration) return;
  const outEl = document.getElementById('x-trim-out');
  const outVal = parseFloat(outEl.value);
  const nextVal = composeMedia.clampTrimPercent({ value: val, otherValue: outVal, direction: 'in' });
  if (nextVal !== parseFloat(val)) {
    val = nextVal;
    document.getElementById('x-trim-in').value = val;
  }
  xTrimIn = (parseFloat(val) / 100) * vid.duration;
  vid.currentTime = xTrimIn;
  updateTrimLabels();
  updateTrimHighlight();
}

function onTrimOut(val) {
  const vid = document.getElementById('x-video-preview');
  if (!vid?.duration) return;
  const inEl = document.getElementById('x-trim-in');
  const inVal = parseFloat(inEl.value);
  const nextVal = composeMedia.clampTrimPercent({ value: val, otherValue: inVal, direction: 'out' });
  if (nextVal !== parseFloat(val)) {
    val = nextVal;
    document.getElementById('x-trim-out').value = val;
  }
  xTrimOut = (parseFloat(val) / 100) * vid.duration;
  vid.currentTime = xTrimOut;
  updateTrimLabels();
  updateTrimHighlight();
  const trimDur = xTrimOut - xTrimIn;
  if (trimDur > composeMedia.MAX_VIDEO_SECONDS) {
    setFFmpegStatus(`⚠ トリム後の長さが ${fmtSec(trimDur)} です。2分20秒（140秒）以内にしてください`);
  } else {
    setFFmpegStatus('');
  }
}

function updateTrimLabels() {
  const vid = document.getElementById('x-video-preview');
  const dur = vid?.duration || 0;
  const trimDur = xTrimOut - xTrimIn;
  const startEl = document.getElementById('x-trim-start-label');
  const endEl   = document.getElementById('x-trim-end-label');
  const durEl   = document.getElementById('x-trim-dur-label');
  if (startEl) startEl.textContent = fmtSec(xTrimIn);
  if (endEl)   endEl.textContent   = fmtSec(xTrimOut || dur);
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
  xImgFiles = [];
  const drop = document.getElementById('x-img-drop');
  if (drop) { drop.style.opacity = '1'; drop.style.pointerEvents = ''; }
  const fi = document.getElementById('x-img-file');
  if (fi) fi.value = '';
  removeXVideo(); // 動画もリセット
}

function updXCC() {
  const n = document.getElementById('x-cta').value.length;
  const el = document.getElementById('x-cct');
  el.textContent = n + ' / 280';
  el.className = 'cc' + (n > 250 ? ' w' : '') + (n > 280 ? ' over' : '');
  // テキストが空でも画像か動画があれば投稿可能
  document.getElementById('x-sndb').disabled = (n === 0 && xImgFiles.length === 0 && !xVideoFile) || n > 280;
}

async function doXPost() {
  const text = document.getElementById('x-cta').value.trim();
  if (!text && xImgFiles.length === 0 && !xVideoFile) return;

  const acc = state.xs?.[selectedXIdx];
  const targetPartition = acc?.partition || 'persist:x-0';

  let wv = null, wvFallback = null;

  document.querySelectorAll('webview').forEach(el => {
    if (el.partition !== targetPartition) return;
    const src = el.src || '';
    if (src.includes('x.com/home') || src.includes('twitter.com/home')) wv = el;
    else if (!wvFallback) wvFallback = el;
  });
  if (!wv) wv = wvFallback;

  if (!wv) {
    toast(`${acc?.username || 'X'} のホームカラムが見つかりません。カラム追加から「ホーム」を追加してください`);
    return;
  }

  // 動画の長さチェック
  if (xVideoFile) {
    const vid = document.getElementById('x-video-preview');
    const duration = vid?.duration || 0;
    const trimEnd = xTrimOut || duration;
    const trimDur = trimEnd - xTrimIn;
    if (trimDur > 140) {
      toast(`動画が長すぎます（${fmtSec(trimDur)}）。2分20秒以内にトリミングしてください`);
      return;
    }
  }

  const postText      = text;
  const postImgs      = [...xImgFiles];
  const postVideo     = xVideoFile;
  const postVideoPath = xVideoPath;
  const postTrimIn    = xTrimIn;
  const postTrimOut   = xTrimOut;

  document.getElementById('x-cta').value = '';
  updXCC();
  resetXImgUI();
  closeOv('xPostMod');

  xPostingNow = true;
  _doXPostBackground({ wv, acc, postText, postImgs, postVideo, postVideoPath, postTrimIn, postTrimOut });
}

// バックグラウンドで実際の投稿処理を行う（モーダルとは独立）
async function _doXPostBackground({ wv, acc, postText, postImgs, postVideo, postVideoPath, postTrimIn, postTrimOut }) {
  try {
    // ══ 動画投稿 ══
    if (postVideo) {
      const vid = document.getElementById('x-video-preview');
      const duration = vid?.duration || 0;
      const trimEnd = postTrimOut || duration;

      const needsTrim = IS_ELECTRON && postVideoPath &&
        (postTrimIn > 0.5 || (duration > 0 && trimEnd < duration - 0.5));

      let videoDataUrl;

      if (needsTrim) {
        setFFmpegStatus('トリミング中…');
        const trimmedPath = await window.electronAPI.trimVideo(postVideoPath, postTrimIn, trimEnd);
        setFFmpegStatus('読み込み中…');
        videoDataUrl = await window.electronAPI.readFileBase64(trimmedPath);
        window.electronAPI.deleteTempFile(trimmedPath).catch(() => {});
        setFFmpegStatus('');
      } else {
        videoDataUrl = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result);
          reader.onerror = rej;
          reader.readAsDataURL(postVideo);
        });
      }

      await wv.executeJavaScript(`
        (async () => {
          // 投稿欄を強制表示してから取得（返信ページでCSSで非表示になっている場合の対策）
          document.querySelectorAll('[data-testid="tweetTextarea_0"],[data-testid="tweetButtonInline"],[data-testid="toolBar"],[data-testid="tweetTextarea_0RichTextInputContainer"],[data-testid="tweetTextarea_0_label"]').forEach(el => {
            el.style.setProperty('display','block','important');
          });
          // div:has(>[data-testid="tweetTextarea_0"]) も強制表示
          var ta0 = document.querySelector('[data-testid="tweetTextarea_0"]');
          if (ta0) {
            var p = ta0.parentElement;
            while (p) { p.style.removeProperty('display'); p = p.parentElement; if (p && p.dataset && p.dataset.testid === 'primaryColumn') break; }
          }
          const box = document.querySelector('[data-testid="tweetTextarea_0"]')
                   || document.querySelector('[role="textbox"]');
          if (!box) throw new Error('投稿欄が見つかりません');
          box.style.setProperty('display','block','important');
          box.click(); box.focus();
          await new Promise(r => setTimeout(r, 300));

          ${postText ? `
          const dt = new DataTransfer();
          dt.setData('text/plain', ${JSON.stringify(postText)});
          box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
          await new Promise(r => setTimeout(r, 400));
          ` : ''}

          function b64toBlob(dataUrl, type) {
            const b64 = dataUrl.split(',')[1];
            const bytes = atob(b64);
            const arr = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
            return new Blob([arr], { type });
          }
          const videoFile = new File(
            [b64toBlob(${JSON.stringify(videoDataUrl)}, 'video/mp4')],
            'video.mp4', { type: 'video/mp4' }
          );
          const fileInput = document.querySelector('input[data-testid="fileInput"]')
                         || document.querySelector('input[accept*="video"][type="file"]')
                         || document.querySelector('input[accept*="image"][type="file"]');
          if (!fileInput) throw new Error('ファイル入力欄が見つかりません');
          const transfer = new DataTransfer();
          transfer.items.add(videoFile);
          Object.defineProperty(fileInput, 'files', { value: transfer.files, configurable: true });
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 3000));

          const postBtn = document.querySelector('[data-testid="tweetButton"]')
                       || document.querySelector('[data-testid="tweetButtonInline"]');
          if (!postBtn) throw new Error('送信ボタンが見つかりません');
          let retries = 20;
          while (postBtn.disabled && retries-- > 0) await new Promise(r => setTimeout(r, 500));
          postBtn.click();
          return 'ok';
        })()
      `);

    // ══ 画像投稿 ══
    } else {
      const imgPayloads = await Promise.all(postImgs.map(f => new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res({ dataUrl: reader.result, type: f.type, name: f.name });
        reader.onerror = rej;
        reader.readAsDataURL(f);
      })));

      await wv.executeJavaScript(`
        (async () => {
          // 投稿欄を強制表示
          document.querySelectorAll('[data-testid="tweetTextarea_0"],[data-testid="tweetButtonInline"],[data-testid="toolBar"],[data-testid="tweetTextarea_0RichTextInputContainer"],[data-testid="tweetTextarea_0_label"]').forEach(el => {
            el.style.setProperty('display','block','important');
          });
          var ta0 = document.querySelector('[data-testid="tweetTextarea_0"]');
          if (ta0) {
            var p = ta0.parentElement;
            while (p) { p.style.removeProperty('display'); p = p.parentElement; if (p && p.dataset && p.dataset.testid === 'primaryColumn') break; }
          }
          const box = document.querySelector('[data-testid="tweetTextarea_0"]')
                   || document.querySelector('[role="textbox"]');
          if (!box) throw new Error('投稿欄が見つかりません');
          box.style.setProperty('display','block','important');
          box.click(); box.focus();
          await new Promise(r => setTimeout(r, 300));

          ${postText ? `
          const dt = new DataTransfer();
          dt.setData('text/plain', ${JSON.stringify(postText)});
          box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
          await new Promise(r => setTimeout(r, 400));
          ` : ''}

          const imgs = ${JSON.stringify(imgPayloads)};
          if (imgs.length > 0) {
            function b64toBlob(dataUrl, type) {
              const b64 = dataUrl.split(',')[1];
              const bytes = atob(b64);
              const arr = new Uint8Array(bytes.length);
              for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
              return new Blob([arr], { type });
            }
            const files = imgs.map(img =>
              new File([b64toBlob(img.dataUrl, img.type)], img.name, { type: img.type })
            );
            const fileInput = document.querySelector('input[data-testid="fileInput"]')
                           || document.querySelector('input[accept*="image"][type="file"]');
            if (fileInput) {
              const transfer = new DataTransfer();
              files.forEach(f => transfer.items.add(f));
              Object.defineProperty(fileInput, 'files', { value: transfer.files, configurable: true });
              fileInput.dispatchEvent(new Event('change', { bubbles: true }));
              await new Promise(r => setTimeout(r, 2000));
            } else {
              const transfer = new DataTransfer();
              files.forEach(f => transfer.items.add(f));
              box.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
              box.dispatchEvent(new DragEvent('dragover',  { bubbles: true, dataTransfer: transfer }));
              box.dispatchEvent(new DragEvent('drop',      { bubbles: true, dataTransfer: transfer }));
              await new Promise(r => setTimeout(r, 2000));
            }
          }

          const postBtn = document.querySelector('[data-testid="tweetButton"]')
                       || document.querySelector('[data-testid="tweetButtonInline"]');
          if (!postBtn) throw new Error('送信ボタンが見つかりません');
          let retries = 15;
          while (postBtn.disabled && retries-- > 0) await new Promise(r => setTimeout(r, 300));
          postBtn.click();
          return 'ok';
        })()
      `);
    }

    toast(`${acc?.username || 'X'} にポストしました！`);

    // 投稿完了後に同じパーティションのXカラムをリロード
    setTimeout(() => {
      const targetPartition = acc?.partition || 'persist:x-0';
      document.querySelectorAll('webview').forEach(el => {
        if (el.partition !== targetPartition) return;
        const id = el.id?.replace('wv-', '');
        if (id) wvReload(id);
      });
    }, 2500);

  } catch (e) {
    toast('X 投稿エラー: ' + e.message);
    setFFmpegStatus('');
  } finally {
    xPostingNow = false;
    flushWvReloadQueue();
  }
}

function updCC() {
  const n = document.getElementById('cta').value.length;
  const el = document.getElementById('cct');
  el.textContent = `${n} / 300`;
  el.className = 'cc' + (n > 260 ? ' w' : '') + (n > 300 ? ' over' : '');
  document.getElementById('sndb').disabled = (n === 0 && bImgFiles.length === 0) || n > 300;
}

// ─── BLUESKY 画像添付 ────────────────────────────
let bImgFiles = [];
let bImgAlts = [];

function handleBImgDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-on');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  addBImgFiles(files);
}

function addBImgFiles(files) {
  const remaining = 4 - bImgFiles.length;
  if (remaining <= 0) { toast('画像は最大4枚まで'); return; }
  const newFiles = [...files].filter(f => f.type.startsWith('image/')).slice(0, remaining);
  bImgFiles.push(...newFiles);
  newFiles.forEach(() => bImgAlts.push(''));
  renderBImgPreviews();
  const fi = document.getElementById('b-img-file');
  if (fi) fi.value = '';
  updCC();
}

function removeBImg(idx) {
  bImgFiles.splice(idx, 1);
  bImgAlts.splice(idx, 1);
  renderBImgPreviews();
  updCC();
}

function renderBImgPreviews() {
  const container = document.getElementById('b-img-preview');
  if (!container) return;
  container.querySelectorAll('img').forEach(img => {
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  });
  container.innerHTML = bImgFiles.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `<div style="position:relative;width:100%;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--bg3);margin-bottom:5px;border:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;padding:5px 8px">
        <img src="${url}" style="width:52px;height:52px;object-fit:cover;border-radius:4px;flex-shrink:0">
        <input type="text" placeholder="Alt テキスト（画像の説明）" maxlength="1000"
          id="b-alt-${i}"
          style="flex:1;background:transparent;border:none;color:var(--text2);font-size:11px;font-family:inherit;outline:none;min-width:0"
          value="${esc(bImgAlts[i] || '')}"
          oninput="bImgAlts[${i}]=this.value">
        <button onclick="removeBImg(${i})"
          style="width:18px;height:18px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;font-size:10px;padding:0;font-family:inherit;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>
    </div>`;
  }).join('');
  const drop = document.getElementById('b-img-drop');
  if (drop) drop.style.opacity = bImgFiles.length >= 4 ? '0.4' : '1';
}

function resetBImgUI() {
  const container = document.getElementById('b-img-preview');
  if (container) {
    container.querySelectorAll('img').forEach(img => {
      if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    });
    container.innerHTML = '';
  }
  bImgFiles = [];
  bImgAlts = [];
  const drop = document.getElementById('b-img-drop');
  if (drop) { drop.style.opacity = '1'; }
  const fi = document.getElementById('b-img-file');
  if (fi) fi.value = '';
}

// ─── LIGHTBOX ────────────────────────────────────
let lbImages = [];
let lbIndex = 0;

function openImg(urls, startIndex = 0) {
  // urls は文字列（単体）または配列
  lbImages = Array.isArray(urls) ? urls : [urls];
  lbIndex = startIndex;
  _lbShow();
}

function _lbShow() {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const counter = document.getElementById('lightbox-counter');
  const prev = document.getElementById('lightbox-prev');
  const next = document.getElementById('lightbox-next');
  if (!lb || !img) return;
  img.src = lbImages[lbIndex];
  lb.classList.add('on');
  counter.textContent = lbImages.length > 1 ? `${lbIndex + 1} / ${lbImages.length}` : '';
  prev.style.display = lbImages.length > 1 ? 'flex' : 'none';
  next.style.display = lbImages.length > 1 ? 'flex' : 'none';
}

function lbMove(dir) {
  lbIndex = (lbIndex + dir + lbImages.length) % lbImages.length;
  _lbShow();
}

function lbClose(e) {
  if (e && e.target && (e.target.id === 'lightbox-prev' || e.target.id === 'lightbox-next')) return;
  document.getElementById('lightbox')?.classList.remove('on');
  const lbImg = document.getElementById('lightbox-img');
  if (lbImg) lbImg.src = '';
  lbImages = [];
}

// ─── FACET DETECTION ────────────────────────────
// Bluesky投稿テキストからリンク・メンション・タグのfacetsを自動生成
function buildFacets(text) {
  const enc = new TextEncoder();
  const facets = [];

  // URL検出
  const urlRe = /https?:\/\/[^\s\u3000-\u9fff\uff00-\uffef「」【】（）。、！？…]+/g;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const start = enc.encode(text.slice(0, m.index)).length;
    const end = start + enc.encode(m[0]).length;
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }]
    });
  }

  // メンション検出 @handle.domain
  const mentionRe = /@([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)/g;
  while ((m = mentionRe.exec(text)) !== null) {
    const start = enc.encode(text.slice(0, m.index)).length;
    const end = start + enc.encode(m[0]).length;
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did: '' }],
      _handle: m[1], _byteStart: start, _byteEnd: end
    });
  }

  // ハッシュタグ検出
  const tagRe = /(?<=\s|^)#([^\s#\u3000-\u9fff\uff00-\uffef]+)/g;
  while ((m = tagRe.exec(text)) !== null) {
    const start = enc.encode(text.slice(0, m.index)).length;
    const end = start + enc.encode(m[0]).length;
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[1] }]
    });
  }

  return facets;
}

// メンションのDID解決（ベストエフォート: 失敗しても投稿は続行）
async function resolveMentionDids(facets, jwt) {
  const mentionFacets = facets.filter(f => f._handle);
  if (!mentionFacets.length) return facets;

  await Promise.allSettled(mentionFacets.map(async f => {
    try {
      const res = await apiGet('com.atproto.identity.resolveHandle', { handle: f._handle }, jwt);
      if (res.did) f.features[0].did = res.did;
    } catch {}
  }));

  // DID未解決のメンションはリンクfacetに降格
  return facets.map(f => {
    if (f._handle) {
      const { _handle, _byteStart, _byteEnd, ...clean } = f;
      if (!clean.features[0].did) {
        // DID解決失敗 → facetを除外（テキストはそのまま）
        return null;
      }
      return clean;
    }
    return f;
  }).filter(Boolean);
}

async function doSend() {
  const v = document.getElementById('cta').value.trim();
  if (!v && bImgFiles.length === 0) return;
  if (!state.b) { toast('Bluesky にログインしていません'); return; }

  const btn = document.getElementById('sndb');
  btn.disabled = true; btn.textContent = '送信中…';
  try {
    const replyRef = replyTarget
      ? {
          root:   { uri: replyTarget.rootUri || replyTarget.uri, cid: replyTarget.rootCid || replyTarget.cid },
          parent: { uri: replyTarget.uri, cid: replyTarget.cid }
        }
      : null;

    // 画像アップロード
    let embed = undefined;
    if (bImgFiles.length > 0) {
      const images = await Promise.all(bImgFiles.map(async (file, idx) => {
        const buf = await file.arrayBuffer();
        const res = await fetch(`${BSKY}/com.atproto.repo.uploadBlob`, {
          method: 'POST',
          headers: {
            'Content-Type': file.type,
            'Authorization': `Bearer ${state.b.accessJwt}`,
          },
          body: buf,
        });
        if (!res.ok) throw new Error('画像アップロード失敗');
        const data = await res.json();
        return { alt: bImgAlts[idx] || '', image: data.blob };
      }));
      embed = { $type: 'app.bsky.embed.images', images };
    }

    // 投稿
    const rawFacets = buildFacets(v);
    const resolvedFacets = await resolveMentionDids(rawFacets, state.b.accessJwt);

    const record = {
      $type: 'app.bsky.feed.post',
      text: v,
      createdAt: new Date().toISOString(),
    };
    if (resolvedFacets.length) record.facets = resolvedFacets;
    if (replyRef) record.reply = replyRef;
    if (embed) record.embed = embed;

    await bskyCallWithRefresh(jwt =>
      apiPost('com.atproto.repo.createRecord', {
        repo: state.b.did,
        collection: 'app.bsky.feed.post',
        record,
      }, jwt)
    );

    document.getElementById('cta').value = '';
    updCC();
    replyTarget = null;
    resetBImgUI();
    document.querySelector('.bsky-reply-preview')?.remove();
    closeOv('compMod');
    toast('Bluesky に投稿しました！');

    // 全Bluesky timelineカラムをリフレッシュ
    setTimeout(() => {
      document.querySelectorAll('.col').forEach(col => {
        if (col.dataset.type === 'timeline') {
          const cid = col.id?.replace('col-', '');
          if (cid) silentRefreshBsky(cid, 'timeline', null);
        }
      });
    }, 1000);
  } catch (e) {
    toast(`投稿エラー: ${e.message}`);
  } finally {
    btn.disabled = false; btn.textContent = '投稿';
  }
}

// ─── ADD COLUMN MODAL ───────────────────────────
function buildOptGrid() {
  const og = document.getElementById('opt-grid');
  og.innerHTML = '';

  // X: アカウントごとにセクションを分けて表示
  if (state.xs && state.xs.length > 0) {
    state.xs.forEach((acc, idx) => {
      og.innerHTML += `<div style="grid-column:1/-1;font-size:10px;font-weight:600;color:var(--text3);letter-spacing:.06em;margin-top:${idx > 0 ? 10 : 0}px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="display:inline-flex;align-items:center;gap:5px">
          <span style="width:14px;height:14px;border-radius:50%;background:${acc.bg};display:inline-flex;align-items:center;justify-content:center;font-size:7px;color:#000;font-weight:700">${acc.initials}</span>
          X · ${esc(acc.username)}
        </span>
      </div>`;
      og.innerHTML += mkOptX('x-home-new', SVG.x, 'ホーム', 'x.com/home', idx);
      og.innerHTML += mkOptX('x-notif-new', SVG.bell, '通知', 'x.com/notifications', idx);
      og.innerHTML += mkOptX('x-search-new', SVG.x, '検索', 'x.com/search', idx);
      og.innerHTML += mkOptX('x-list-new', SVG.x, 'リスト', 'x.com/i/lists', idx);
      og.innerHTML += mkOptX('x-settings', SVG.gear, '設定', 'x.com/settings', idx);
    });
  }

  // Bluesky
  if (state.b) {
    if (state.xs && state.xs.length > 0) {
      og.innerHTML += `<div style="grid-column:1/-1;font-size:10px;font-weight:600;color:var(--text3);letter-spacing:.06em;margin-top:10px;padding:4px 0;border-bottom:1px solid var(--border)">Bluesky · @${state.b.handle}</div>`;
    }
    og.innerHTML += mkOpt('b-timeline-new', SVG.bsky, 'タイムライン', 'リアルタイム取得', false, 'b');
    og.innerHTML += mkOpt('b-notif-new', SVG.bell, '通知', 'リアルタイム取得', false, 'b');
    og.innerHTML += mkOpt('b-search-new', SVG.bsky, '検索', 'キーワード検索', false, 'b');
    og.innerHTML += mkOpt('b-discover', SVG.bsky, 'Discover', 'おすすめフィード', false, 'b');
    og.innerHTML += mkOpt('b-settings', SVG.gear, 'Bsky 設定', 'bsky.app/settings', false, 'b');
  }
}

// Xアカウント指定用のオプションボタン（accountIdxを埋め込む）
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
function addColFromModal(type, plat, accountIdx) {
  closeOv('addMod');
  extraColN++;
  // X: アカウントindexをIDに含めて一意にする
  const id = plat === 'x' ? `x${accountIdx}-${type}-${extraColN}` : `${type}-${extraColN}`;

  if (plat === 'x') {
    // リストは専用ダイアログでURL/IDを入力
    if (type === 'x-list-new') {
      openXListDialog(accountIdx);
      return;
    }

    const urlMap = {
      'x-home-new': 'https://x.com/home',
      'x-notif-new': 'https://x.com/notifications',
      'x-search-new': 'https://x.com/search',
      'x-settings': 'https://x.com/settings',
    };
    const titleMap = {
      'x-home-new': 'ホーム', 'x-notif-new': '通知',
      'x-search-new': '検索', 'x-settings': '設定',
    };
    const icMap = { 'x-settings': 'ic-s' };
    const iconMap = { 'x-settings': SVG.gear };

    const acc = state.xs?.[accountIdx ?? 0];
    const xPart = acc?.partition || `persist:x-${accountIdx ?? 0}`;
    const accLabel = acc ? ` · ${acc.username}` : '';
    insertWebViewCol({
      id,
      title: titleMap[type] || type,
      sub: `X${accLabel}`,
      url: urlMap[type] || 'https://x.com',
      icCls: icMap[type] || 'ic-x',
      icon: iconMap[type] || SVG.x
    }, null, xPart);
  } else {
    // Bluesky設定はWebViewで表示
    if (type === 'b-settings') {
      insertWebViewCol({ id, title: '設定', sub: 'Bluesky', url: 'https://bsky.app/settings', icCls: 'ic-s', icon: SVG.gear }, null, 'persist:bsky');
      return;
    }
    const bskyMap = {
      'b-timeline-new': { title: 'タイムライン', type: 'timeline', icCls: 'ic-b', icon: SVG.bsky },
      'b-notif-new': { title: '通知', type: 'notif', icCls: 'ic-n', icon: SVG.bell },
      'b-search-new': { title: '検索', type: 'search', icCls: 'ic-s', icon: SVG.bsky },
      'b-discover': { title: 'Discover', type: 'feed', feedUri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot', icCls: 'ic-b', icon: SVG.bsky },
    };
    const cfg = bskyMap[type];
    if (cfg) {
      const col = document.createElement('div');
      col.dataset.type = cfg.type;
      if (cfg.feedUri) col.dataset.feeduri = cfg.feedUri;
      insertBskyCol({ id, title: cfg.title, sub: 'Bluesky', type: cfg.type, feedUri: cfg.feedUri, icCls: cfg.icCls, icon: cfg.icon });
    }
  }

  const cols = document.getElementById('cols');
  const lastCol = cols.querySelector('.col:last-of-type');
  if (lastCol) lastCol.scrollIntoView({ behavior: 'smooth', inline: 'end' });
  toast(`カラムを追加しました`);
  saveColLayout();
}

function openColSettings(id, colType, feedType, feedUri) {
  const ms = refreshScheduler.getInterval(id, DEFAULT_INTERVAL_MS);
  const cur = Math.round(ms / 1000);
  const curFs = parseInt(localStorage.getItem(`col_fs_${id}`)) || 13;
  document.getElementById('col-settings-ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'ov on'; ov.id = 'col-settings-ov';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div class="modal" style="width:300px">
    <h2 style="margin-bottom:14px">カラム設定</h2>
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px">自動更新の間隔</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      ${[15,30,60,120,300,0].map(s=>`<button onclick="applyInterval('${id}','${colType}','${feedType||'timeline'}','${feedUri||''}',${s*1000})"
        style="padding:5px 11px;border-radius:6px;border:1px solid ${cur===s?'var(--accent)':'var(--border2)'};background:${cur===s?'var(--accent-dim)':'transparent'};color:${cur===s?'var(--accent)':'var(--text2)'};cursor:pointer;font-size:12px;font-family:inherit">
        ${s===0?'OFF':s<60?s+'秒':s/60+'分'}</button>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px">文字サイズ</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      ${[11,12,13,14,15,16].map(fs=>`<button onclick="applyColFontSize('${id}','${colType}',${fs})"
        style="padding:5px 11px;border-radius:6px;border:1px solid ${curFs===fs?'var(--accent)':'var(--border2)'};background:${curFs===fs?'var(--accent-dim)':'transparent'};color:${curFs===fs?'var(--accent)':'var(--text2)'};cursor:pointer;font-size:12px;font-family:inherit">
        ${fs}px</button>`).join('')}
    </div>
    <button onclick="document.getElementById('col-settings-ov').remove()" class="btn-cancel">閉じる</button>
  </div>`;
  document.body.appendChild(ov);
}
function applyInterval(id, colType, feedType, feedUri, ms) {
  if (colType === 'wv') setAutoRefreshWv(id, ms);
  else setAutoRefresh(id, ms, feedType, feedUri||null);
  const label = ms===0?'OFF':ms<60000?(ms/1000)+'秒':(ms/60000)+'分';
  toast('自動更新: '+label);
  document.getElementById('col-settings-ov')?.remove();
  saveColLayout();
}

function applyColFontSize(id, colType, fs) {
  localStorage.setItem(`col_fs_${id}`, fs);
  if (colType === 'wv') {
    // XのWebViewにCSSを注入
    const wv = document.getElementById(`wv-${id}`);
    if (wv) wv.insertCSS(`* { font-size: ${fs}px !important; }`).catch(() => {});
  } else {
    // Bskyのfeedにfont-sizeを適用
    const feed = document.getElementById(`feed-${id}`);
    if (feed) feed.style.fontSize = fs + 'px';
  }
  toast(`文字サイズ: ${fs}px`);
  // ダイアログを更新（現在選択中を反映）
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
  const clean = handle.replace(/^@/, '');
  if (!ngData.users.includes(clean)) { ngData.users.push(clean); saveNg(ngData); }
  toast(`@${clean} をミュートしました`);
  document.getElementById('post-ctx-menu')?.remove();
  refilterBskyCols(); // 即時反映
}
function copyHandle(handle) {
  navigator.clipboard?.writeText('@' + handle).then(() => toast('コピーしました'));
  document.getElementById('post-ctx-menu')?.remove();
}

// ─── SIDEBAR NOTIFICATION ICONS ────────────────
let bskyUnreadCount = 0;
let notifPollTimer = null;

function renderNotifIcons() {
  const el = document.getElementById('sb-notif-icons');
  if (!el) return;
  el.innerHTML = '';

  // Xアカウントごとの通知アイコン
  (state.xs || []).forEach((acc, i) => {
    const btn = document.createElement('button');
    btn.className = 'si';
    btn.title = `${acc.username} の通知`;
    btn.setAttribute('id', `sb-notif-x-${i}`);
    btn.innerHTML = `
      <span style="position:relative;display:flex;align-items:center;justify-content:center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span style="position:absolute;top:-6px;right:-6px;min-width:14px;height:14px;border-radius:7px;background:${acc.bg};color:#000;font-size:7px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 2px;line-height:1">${acc.initials}</span>
      </span>`;
    btn.onclick = () => scrollToNotifCol(`x-notif`, i, acc);
    el.appendChild(btn);
  });

  // Bluesky通知アイコン
  if (state.b) {
    const btn = document.createElement('button');
    btn.className = 'si';
    btn.title = 'Bluesky の通知';
    btn.id = 'sb-notif-b';
    btn.innerHTML = `
      <span style="position:relative;display:flex;align-items:center;justify-content:center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span id="bsky-notif-badge" style="position:absolute;top:-6px;right:-7px;min-width:14px;height:14px;border-radius:7px;background:var(--red);color:#fff;font-size:8px;font-weight:700;display:${bskyUnreadCount > 0 ? 'flex' : 'none'};align-items:center;justify-content:center;padding:0 2px;line-height:1">${bskyUnreadCount > 99 ? '99+' : bskyUnreadCount}</span>
      </span>`;
    btn.onclick = () => scrollToNotifCol('b-notif', -1, null);
    el.appendChild(btn);

    // 未読数ポーリング開始
    startNotifPoll();
  }
}

// 通知カラムにスクロール（なければ追加）
function scrollToNotifCol(baseId, xIdx, acc) {
  const cols = document.getElementById('cols');

  // X通知: xIdx対応のカラムを探す（partitionで判別）
  let targetCol = null;
  if (xIdx >= 0 && acc) {
    // x0-x-notif-new-N 形式のIDで探す
    cols.querySelectorAll('.col').forEach(col => {
      const wv = col.querySelector('webview');
      if (wv && wv.partition === acc.partition && wv.src?.includes('/notifications')) {
        targetCol = col;
      }
    });
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
      extraColN++;
      const id = `x${xIdx}-x-notif-new-${extraColN}`;
      insertWebViewCol({
        id, title: '通知', sub: `X · ${acc.username}`,
        url: 'https://x.com/notifications',
        icCls: 'ic-n', icon: SVG.bell
      }, null, acc.partition);
      setTimeout(() => {
        const newCol = document.getElementById(`col-${id}`);
        if (newCol) newCol.scrollIntoView({ behavior: 'smooth', inline: 'start' });
      }, 300);
      saveColLayout(); // ← 追加後に保存
      toast(`${acc.username} の通知カラムを追加しました`);
    } else {
      // Bluesky通知カラムを追加
      insertBskyCol({ id: 'b-notif', title: '通知', sub: 'Bluesky', type: 'notif', icCls: 'ic-n', icon: SVG.bell });
      setTimeout(() => {
        const newCol = document.getElementById('col-b-notif');
        if (newCol) newCol.scrollIntoView({ behavior: 'smooth', inline: 'start' });
      }, 300);
      saveColLayout(); // ← 追加後に保存
      toast('Bluesky の通知カラムを追加しました');
    }
  }
}

// Bluesky未読通知数をポーリング
function startNotifPoll() {
  if (notifPollTimer) return; // すでに動いていれば何もしない
  fetchBskyUnread();
  notifPollTimer = setInterval(fetchBskyUnread, 60000); // 60秒ごと
}

async function fetchBskyUnread() {
  if (!state.b) return;
  try {
    const data = await bskyCallWithRefresh(jwt =>
      apiGet('app.bsky.notification.getUnreadCount', {}, jwt)
    );
    const count = data.count || 0;
    if (count !== bskyUnreadCount) {
      bskyUnreadCount = count;
      // バッジを更新
      const badge = document.getElementById('bsky-notif-badge');
      if (badge) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = count > 0 ? 'flex' : 'none';
      }
      // 新着があればサイドバーアイコンを強調
      const btn = document.getElementById('sb-notif-b');
      if (btn && count > 0) {
        btn.style.color = 'var(--red)';
      } else if (btn) {
        btn.style.color = '';
      }
    }
  } catch(e) { /* サイレント失敗 */ }
}

// ─── SCROLL TO START ────────────────────────────
function scrollColsToStart() {
  const cols = document.getElementById('cols');
  cols.scrollTo({ left: 0, behavior: 'smooth' });
}

function refreshAll() {
  document.querySelectorAll('[id^="rfr-"]').forEach(btn => {
    if (!btn.classList.contains('spin')) btn.click();
  });
  // X webviews
  document.querySelectorAll('webview').forEach(wv => wv.reload());
  toast('すべてのフィードを更新しています…');
}

// ─── UTILS ─────────────────────────────────────
// ─── NOTIF SHORTCUTS & SCROLL ───────────────────

// 通知カラムへスクロール（なければ追加）
function goToNotifCol(plat, xIdx) {
  // 対象カラムを探す
  let targetCol = null;

  if (plat === 'x') {
    const acc = state.xs?.[xIdx];
    if (!acc) return;
    const xPart = acc.partition || `persist:x-${xIdx}`;
    document.querySelectorAll('.col').forEach(col => {
      const wv = col.querySelector('webview');
      if (wv && wv.partition === xPart && wv.src && wv.src.includes('notifications')) {
        targetCol = col;
      }
    });
    if (!targetCol) {
      const id = `x${xIdx}-notif-auto`;
      insertWebViewCol({
        id, title: '通知', sub: `X · ${acc.username}`,
        url: 'https://x.com/notifications', icCls: 'ic-n', icon: SVG.bell
      }, null, xPart);
      targetCol = document.getElementById(`col-${id}`);
      saveColLayout(); // ← 追加
      toast(`${acc.username} の通知カラムを追加しました`);
    }
  } else {
    document.querySelectorAll('.col').forEach(col => {
      const feed = col.querySelector('.feed');
      if (feed && feed.id && feed.id.includes('notif')) targetCol = col;
    });
    if (!targetCol) {
      const id = 'b-notif-auto';
      insertBskyCol({ id, title: '通知', sub: 'Bluesky', type: 'notif', icCls: 'ic-n', icon: SVG.bell });
      targetCol = document.getElementById(`col-${id}`);
      saveColLayout(); // ← 追加
      toast('Bluesky の通知カラムを追加しました');
    }
  }

  // カラムにスクロール
  if (targetCol) {
    targetCol.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    // 一瞬ハイライト
    targetCol.style.outline = '2px solid var(--accent)';
    setTimeout(() => { targetCol.style.outline = ''; }, 1200);
  }
}

// Bluesky未読通知数を取得してバッジ更新
async function fetchBskyUnreadCount() {
  if (!state.b) return;
  try {
    const data = await bskyCallWithRefresh(jwt =>
      apiGet('app.bsky.notification.getUnreadCount', {}, jwt)
    );
    const count = data.count || 0;
    const badge = document.getElementById('bsky-notif-badge');
    if (!badge) return;
    if (count > 0) {
      badge.style.display = 'flex';
      badge.textContent = count > 99 ? '99+' : count;
    } else {
      badge.style.display = 'none';
    }
  } catch {}
}

// Bluesky通知を既読化してバッジを消す
async function markBskyNotifsRead() {
  if (!state.b) return;
  try {
    await bskyCallWithRefresh(jwt =>
      bsky.updateSeen(jwt, new Date().toISOString())
    );
    const badge = document.getElementById('bsky-notif-badge');
    if (badge) badge.style.display = 'none';
    toast('通知を既読にしました');
  } catch (e) {
    toast('既読化エラー: ' + e.message);
  }
}

// Bluesky通知カラムへスクロール + 既読化
async function goToNotifColAndRead() {
  goToNotifCol('b');
  await markBskyNotifsRead();
}

// ─── FILE DRAG SHIELD ───────────────────────────
// ファイルのD&DはX投稿モーダル内のドロップエリアのみ許可
// カラム上（WebView・Blueskyフィード）へのドロップは完全に無効化
let fileDragActive = false;
let fileDragEnterCount = 0;

function addFileDragShields() {
  if (fileDragActive) return;
  fileDragActive = true;
  document.querySelectorAll('.col').forEach(col => {
    if (!col.querySelector('.file-drag-shield')) {
      const shield = document.createElement('div');
      shield.className = 'file-drag-shield';
      // z-index:30で青枠の上に被せる。背景は完全透明だとブラウザのハイライトが透ける
      shield.style.cssText = 'position:absolute;inset:-2px;z-index:30;pointer-events:all;background:var(--bg1, #0d0d0d);opacity:0.01;cursor:default';
      col.style.position = 'relative';
      col.appendChild(shield);
    }
  });
}

function removeFileDragShields() {
  fileDragActive = false;
  fileDragEnterCount = 0;
  document.querySelectorAll('.file-drag-shield').forEach(s => s.remove());
}

document.addEventListener('dragenter', e => {
  if (dragSrc) return; // カラムDnDは別処理
  const types = [...(e.dataTransfer?.types || [])];
  if (!types.includes('Files')) return;
  fileDragEnterCount++;
  if (fileDragEnterCount === 1) addFileDragShields();
});

document.addEventListener('dragleave', e => {
  if (dragSrc) return;
  const types = [...(e.dataTransfer?.types || [])];
  if (!types.includes('Files')) return;
  fileDragEnterCount = Math.max(0, fileDragEnterCount - 1);
  if (fileDragEnterCount === 0) removeFileDragShields();
});

// X投稿モーダルの外へのドロップを完全に無効化
document.addEventListener('dragover', e => {
  if (dragSrc) return;
  const types = [...(e.dataTransfer?.types || [])];
  if (!types.includes('Files')) return;
  e.preventDefault();
  // x-img-drop と b-img-drop エリア以外はdropEffect=noneで青枠を抑制
  if (!e.target.closest('#x-img-drop') && !e.target.closest('#b-img-drop')) {
    e.dataTransfer.dropEffect = 'none';
  }
});

document.addEventListener('drop', e => {
  // x-img-drop と b-img-drop 以外へのファイルドロップをキャンセル
  const types = [...(e.dataTransfer?.types || [])];
  if (types.includes('Files') && !e.target.closest('#x-img-drop') && !e.target.closest('#b-img-drop')) {
    e.preventDefault();
  }
  removeFileDragShields();
});

document.addEventListener('dragend', () => {
  removeFileDragShields();
});

// ─── MEMORY MANAGEMENT ──────────────────────────

let memCleanerTimer = null;

function startMemoryCleaner() {
  const ms = getMemInterval();
  clearInterval(memCleanerTimer);
  if (!ms || ms <= 0) return;
  memCleanerTimer = setInterval(() => {
    runMemoryClear(false); // サイレント実行
  }, ms);
}

function getMemInterval() {
  const v = parseInt(localStorage.getItem(MEM_KEY));
  return isNaN(v) ? 30 * 60 * 1000 : v; // デフォルト30分
}

async function runMemoryClear(showToast = true) {
  if (IS_ELECTRON && window.electronAPI?.clearMemory) {
    await window.electronAPI.clearMemory();
  }
  if (showToast) toast('メモリをクリアしました');
}

function openMemSettings() {
  document.getElementById('mem-settings-ov')?.remove();
  const cur = getMemInterval();
  const ov = document.createElement('div');
  ov.className = 'ov on'; ov.id = 'mem-settings-ov';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `
    <div class="modal" style="width:300px">
      <h2 style="margin-bottom:6px">メモリ自動クリア</h2>
      <p style="font-size:12px;color:var(--text2);margin-bottom:14px">長時間起動時のメモリ増加を抑制します</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
        ${[[15*60000,'15分'],[30*60000,'30分'],[60*60000,'1時間'],[120*60000,'2時間'],[0,'OFF']].map(([ms, label]) => `
          <button onclick="applyMemInterval(${ms})"
            style="padding:5px 11px;border-radius:6px;border:1px solid ${cur===ms?'var(--accent)':'var(--border2)'};background:${cur===ms?'var(--accent-dim)':'transparent'};color:${cur===ms?'var(--accent)':'var(--text2)'};cursor:pointer;font-size:12px;font-family:inherit">
            ${label}
          </button>`).join('')}
      </div>
      <button onclick="runMemoryClear(true);document.getElementById('mem-settings-ov').remove()"
        style="width:100%;padding:8px;border-radius:7px;background:var(--bg3);border:1px solid var(--border);color:var(--text2);font-family:inherit;font-size:12px;cursor:pointer;margin-bottom:8px">
        今すぐクリア
      </button>
      <button onclick="document.getElementById('mem-settings-ov').remove()" class="btn-cancel">閉じる</button>
    </div>`;
  document.body.appendChild(ov);
}

function applyMemInterval(ms) {
  localStorage.setItem(MEM_KEY, ms);
  startMemoryCleaner();
  const label = ms === 0 ? 'OFF' : ms < 3600000 ? (ms/60000)+'分' : (ms/3600000)+'時間';
  toast(`メモリ自動クリア: ${label}`);
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
        Xリストを追加${esc(accLabel)}
      </h2>
      <p style="font-size:12px;color:var(--text2);margin-bottom:16px">リストのURLまたはリストIDを入力してください</p>
      <div class="lf" style="margin-bottom:6px">
        <label>リストURL / ID</label>
        <input type="text" id="x-list-input" placeholder="https://x.com/i/lists/123456789 または 123456789"
          style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;font-size:13px;color:var(--text1);font-family:inherit;outline:none"
          onkeydown="if(event.key==='Enter')confirmXList(${accountIdx})">
      </div>
      <div class="lf" style="margin-bottom:16px">
        <label>カラム名（任意）</label>
        <input type="text" id="x-list-name" placeholder="マイリスト"
          style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;font-size:13px;color:var(--text1);font-family:inherit;outline:none"
          onkeydown="if(event.key==='Enter')confirmXList(${accountIdx})">
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('x-list-dialog-ov').remove()" class="btn-cancel" style="flex:1">キャンセル</button>
        <button onclick="confirmXList(${accountIdx})" style="flex:1;padding:9px;border-radius:7px;background:var(--accent);border:none;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">追加</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  setTimeout(() => document.getElementById('x-list-input')?.focus(), 50);
}

function confirmXList(accountIdx) {
  const raw = document.getElementById('x-list-input')?.value?.trim();
  const nameInput = document.getElementById('x-list-name')?.value?.trim();
  if (!raw) { toast('URLまたはIDを入力してください'); return; }

  // URL or ID を解析
  let listId = raw;
  const m = raw.match(/lists\/([0-9]+)/);
  if (m) listId = m[1];
  // 数字のみでなければエラー
  if (!/^[0-9]+$/.test(listId)) { toast('有効なリストURLまたはIDを入力してください'); return; }

  const url = `https://x.com/i/lists/${listId}`;
  const title = nameInput || `リスト`;
  const acc = state.xs?.[accountIdx ?? 0];
  const xPart = acc?.partition || `persist:x-${accountIdx ?? 0}`;
  const accLabel = acc ? ` · ${acc.username}` : '';

  extraColN++;
  const id = `x${accountIdx}-list-${listId}-${extraColN}`;
  insertWebViewCol({
    id, title, sub: `X${accLabel}`,
    url, icCls: 'ic-x', icon: SVG.x
  }, null, xPart);

  document.getElementById('x-list-dialog-ov')?.remove();
  const cols = document.getElementById('cols');
  const lastCol = cols.querySelector('.col:last-of-type');
  if (lastCol) lastCol.scrollIntoView({ behavior: 'smooth', inline: 'end' });
  toast(`リストカラムを追加しました`);
  saveColLayout();
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

// サジェスト外クリックで閉じる
document.addEventListener('click', e => {
  const suggest = document.getElementById('mention-suggest');
  if (suggest && !e.target.closest('#mention-suggest') && !e.target.closest('#cta')) {
    suggest.style.display = 'none';
  }
});

function closeOv(id, e) {
  if (!e || e.target.classList.contains('ov')) {
    document.getElementById(id).classList.remove('on');
    if (id === 'xPostMod') {
      resetXImgUI();
      document.getElementById('x-cta').value = '';
      updXCC();
    }
    if (id === 'compMod') {
      resetBImgUI();
      const cta = document.getElementById('cta');
      if (cta) { cta.value = ''; updCC(); }
      replyTarget = null;
      document.querySelector('.bsky-reply-preview')?.remove();
    }
  }
}

// ─── アプリ内メニュー ────────────────────────────
function toggleAmDrop(id, e) {
  e.stopPropagation();
  const drop = document.getElementById(id);
  const item = drop?.closest('.am-item');
  const isOpen = item?.classList.contains('open');
  // 全部閉じる
  document.querySelectorAll('.am-item.open').forEach(el => el.classList.remove('open'));
  // クリックされたものだけ開く（既に開いていたら閉じる）
  if (!isOpen && item) item.classList.add('open');
}

// メニュー外クリックで閉じる
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
  // ライトボックス操作
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
    document.querySelectorAll('.ov.on').forEach(o => o.classList.remove('on'));
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

// Electron メニューイベント
if (IS_ELECTRON) {
  window.electronAPI.on('add-column', () => openAddMod());
  window.electronAPI.on('refresh-all', () => refreshAll());
  window.electronAPI.on('scroll-left', () => { document.getElementById('cols').scrollBy({ left: -400, behavior: 'smooth' }); });
  window.electronAPI.on('scroll-right', () => { document.getElementById('cols').scrollBy({ left: 400, behavior: 'smooth' }); });

  // 最大化状態でウィンドウコントロールボタンのアイコンを切り替え
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
    saveColLayout();
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
      saveColLayout();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── INIT ───────────────────────────────────────
state = stateStore.load();
// 旧フォーマット互換: state.x が残っていたら xs に移行
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
  // preloadパスを確定してからenterApp（カラム生成時に確実にpreloadが設定される）
  initWvPreloadPath().finally(() => {
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
    refreshScheduler.clearAll();
    if (notifPollTimer) { clearInterval(notifPollTimer); notifPollTimer = null; }
    if (memCleanerTimer) { clearInterval(memCleanerTimer); }
  } else {
    // フォアグラウンド復帰: タイマーを再開のみ（即時更新はしない）
    // ShareX等のキャプチャツールがフォーカスを一瞬奪うと誤発火するため
    Object.keys(autoRefreshIntervals).forEach(id => {
      const ms = autoRefreshIntervals[id];
      if (!ms || ms <= 0) return;
      const col = document.getElementById(`col-${id}`);
      const isWv = !!col?.querySelector('webview');
      if (isWv) {
        setAutoRefreshWv(id, ms);
      } else {
        const type = col?.dataset?.type || 'timeline';
        const feedUri = col?.dataset?.feeduri || null;
        setAutoRefresh(id, ms, type, feedUri);
      }
    });
    if (state.b && !notifPollTimer) startNotifPoll();
    startMemoryCleaner();
  }
});

// メモリ自動クリアを開始（ログイン状態に関わらず）
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

  // 保存済みレイアウトからカラム一覧を作成（選択用）
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
    <input type="range" min="30" max="100" value="100" title="透明度" id="wg-opacity"
      oninput="window.electronAPI?.widgetSetOpacity(this.value / 100)">
    <button id="wg-top-btn" title="最前面固定" onclick="wgToggleTop()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>
    </button>
    <button title="閉じる" onclick="window.electronAPI?.closeWidget()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  document.body.prepend(bar);

  // 保存済みの透明度と最前面状態を復元
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
  toast(next ? '最前面に固定しました' : '最前面固定を解除しました');
}

function wgSelectCol(colId) {
  columnRuntime.setWidgetColumnId(colId);
  location.reload(); // 選択カラムを反映するためリロード
}
