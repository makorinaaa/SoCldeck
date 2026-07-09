// 笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊・//  SOCIALDECK 窶・renderer.js
//  Bluesky AT Protocol + X WebView
// 笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊・
const IS_ELECTRON = typeof window.electronAPI !== 'undefined';
const composeMedia = window.SocialDeckComposeMedia;

// 笏笏笏 Bluesky API 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const BSKY = 'https://bsky.social/xrpc';

async function apiPost(endpoint, body, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BSKY}/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || e.error || `${endpoint} failed`); }
  // 遨ｺ繝ｬ繧ｹ繝昴Φ繧ｹ・・pdateSeen遲会ｼ峨・蝣ｴ蜷医・ {} 繧定ｿ斐☆
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

// 繝医・繧ｯ繝ｳ繝ｪ繝輔Ξ繝・す繝･・郁・蜍募他縺ｳ蜃ｺ縺礼畑・・let _refreshPromise = null; // 荳ｦ蛻励Μ繝輔Ξ繝・す繝･髦ｲ豁｢
async function refreshBskyToken() {
  if (_refreshPromise) return _refreshPromise; // 譌｢縺ｫ螳溯｡御ｸｭ縺ｪ繧牙酔縺榔romise繧定ｿ斐☆
  _refreshPromise = (async () => {
    if (!state.b?.refreshJwt) throw new Error('繝ｪ繝輔Ξ繝・す繝･繝医・繧ｯ繝ｳ縺後≠繧翫∪縺帙ｓ');
    const res = await fetch(`${BSKY}/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.b.refreshJwt}` }
    });
    if (!res.ok) throw new Error('繝医・繧ｯ繝ｳ譖ｴ譁ｰ螟ｱ謨励ょ・繝ｭ繧ｰ繧､繝ｳ縺励※縺上□縺輔＞');
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

// 繝医・繧ｯ繝ｳ蛻・ｌ繧呈､懃衍縺励※閾ｪ蜍輔Μ繝輔Ξ繝・す繝･蠕後↓蜀崎ｩｦ陦後☆繧九Λ繝・ヱ繝ｼ
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

// 笏笏笏 COLUMN PERSISTENCE 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const columnRuntime = window.SocialDeckColumnRuntime.createColumnRuntime();
const COL_KEY = columnRuntime.layoutKey;

function saveColLayout() {
  // 繧ｦ繧｣繧ｸ繧ｧ繝・ヨ繝｢繝ｼ繝峨〒縺ｯ菫晏ｭ倥＠縺ｪ縺・ｼ医Γ繧､繝ｳ繧ｦ繧｣繝ｳ繝峨え縺ｮ繝ｬ繧､繧｢繧ｦ繝医ｒ螢翫＆縺ｪ縺・◆繧・ｼ・  if (new URLSearchParams(location.search).get('widget') === '1') return;
  const cols = document.getElementById('cols');
  if (!cols) return;
  const layout = [];
  cols.querySelectorAll('.col').forEach(col => {
    const d = col.dataset;
    const wv = col.querySelector('webview');
    if (wv) {
      // WebView繧ｫ繝ｩ繝
      const wvId = col.id.replace('col-', '');
      // X邉ｻ縺ｮURL縺ｯ迴ｾ蝨ｨ縺ｮ繝壹・繧ｸ・郁ｿ比ｿ｡繝ｻ繝・う繝ｼ繝郁ｩｳ邏ｰ遲会ｼ峨〒縺ｯ縺ｪ縺上・繝ｼ繝縺ｫ豁｣隕丞喧縺励※菫晏ｭ・      let savedUrl = normalizeXUrl(wv.src);
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
      // Bsky繧ｫ繝ｩ繝
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
}

function restoreColLayout() {
  const layout = loadColLayout();
  if (!layout.length) return false;

  layout.forEach(col => {
    if (col.kind === 'wv') {
      let icon = SVG.x;
      let icCls = col.icCls || 'ic-x';
      if (col.partition === 'persist:bsky') { icon = SVG.gear; }
      else if (col.url?.includes('notifications')) { icon = SVG.bell; icCls = 'ic-n'; }
      else if (col.url?.includes('search')) { icCls = 'ic-s'; }
      else if (col.url?.includes('settings')) { icon = SVG.gear; icCls = 'ic-s'; }

      insertWebViewCol({
        id: col.id, title: col.title, sub: col.sub,
        url: col.url, icCls, icon,
      }, null, col.partition || 'persist:x-0');

      if (col.interval !== undefined) {
        clearAutoRefresh(col.id);
        setAutoRefreshWv(col.id, col.interval);
      }
    } else if (col.kind === 'bsky') {
      let icon = SVG.bsky;
      let icCls = col.icCls || 'ic-b';
      if (col.type === 'notif') { icon = SVG.bell; icCls = 'ic-n'; }
      else if (col.type === 'search') { icCls = 'ic-s'; }

      insertBskyCol({
        id: col.id, title: col.title, sub: col.sub,
        type: col.type, feedUri: col.feedUri || null, icCls, icon,
      });

      if (col.interval !== undefined) {
        clearAutoRefresh(col.id);
        setAutoRefresh(col.id, col.interval, col.type, col.feedUri || null);
      }
    }

    if (col.width) {
      const el = document.getElementById(`col-${col.id}`);
      if (el) { el.style.width = col.width; el.style.minWidth = col.width; }
    }
    if (col.collapsed) setTimeout(() => toggleColCollapse(col.id), 0);
  });
  return true;
}

// 笏笏笏 NG WORD / MUTE 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const NG_KEY = 'socialdeck_ng';
function loadNg() {
  try { return JSON.parse(localStorage.getItem(NG_KEY)) || { words: [], users: [] }; } catch { return { words: [], users: [] }; }
}
function saveNg(ng) { localStorage.setItem(NG_KEY, JSON.stringify(ng)); }
let ngData = loadNg();

function isNgPost(item) {
  const post = item.post || item;
  const texts = [post.record?.text || ''];
  const authors = [
    { handle: post.author?.handle, displayName: post.author?.displayName },
  ];

  const reasonBy = item.reason?.by;
  if (reasonBy) authors.push({ handle: reasonBy.handle, displayName: reasonBy.displayName });

  const embed = post.embed;
  if (embed) {
    const qrec = embed.record?.value ? embed.record : embed.record?.record;
    if (qrec?.value?.text) texts.push(qrec.value.text);
    if (qrec?.author) authors.push({ handle: qrec.author.handle, displayName: qrec.author.displayName });
  }

  for (const w of ngData.words) {
    if (!w) continue;
    const lw = w.toLowerCase();
    if (texts.some(t => t.toLowerCase().includes(lw))) return true;
  }
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
      <button onclick="removeNg('word',${i})" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:11px;font-family:inherit">蜑企勁</button>
    </div>`).join('') || '<div style="font-size:12px;color:var(--text3);padding:6px 0">縺ｪ縺・/div>';

  const usersList = ngData.users.map((u, i) =>
    `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:12px;color:var(--text1)">@${esc(u)}</span>
      <button onclick="removeNg('user',${i})" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:11px;font-family:inherit">蜑企勁</button>
    </div>`).join('') || '<div style="font-size:12px;color:var(--text3);padding:6px 0">縺ｪ縺・/div>';

  ov.innerHTML = `<div class="modal" style="width:380px;max-height:80vh;overflow-y:auto">
    <h2 style="margin-bottom:16px">NG繝ｯ繝ｼ繝・/ 繝溘Η繝ｼ繝郁ｨｭ螳・/h2>
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px">NG繝ｯ繝ｼ繝会ｼ域兜遞ｿ譛ｬ譁・ｼ・/div>
      ${wordsList}
      <div style="display:flex;gap:6px;margin-top:8px">
        <input id="ng-word-input" type="text" placeholder="繧ｭ繝ｼ繝ｯ繝ｼ繝峨ｒ霑ｽ蜉窶ｦ" style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text1);font-family:inherit;outline:none">
        <button onclick="addNg('word')" style="padding:6px 12px;border-radius:6px;background:var(--accent);border:none;color:#fff;cursor:pointer;font-size:12px;font-family:inherit">霑ｽ蜉</button>
      </div>
    </div>
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px">繝溘Η繝ｼ繝医Θ繝ｼ繧ｶ繝ｼ</div>
      ${usersList}
      <div style="display:flex;gap:6px;margin-top:8px">
        <input id="ng-user-input" type="text" placeholder="@handle 繧定ｿｽ蜉窶ｦ" style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text1);font-family:inherit;outline:none">
        <button onclick="addNg('user')" style="padding:6px 12px;border-radius:6px;background:var(--accent);border:none;color:#fff;cursor:pointer;font-size:12px;font-family:inherit">霑ｽ蜉</button>
      </div>
    </div>
    <button onclick="document.getElementById('ng-modal-ov').remove()" class="btn-cancel">髢峨§繧・/button>
  </div>`;
  document.body.appendChild(ov);
  setTimeout(() => document.getElementById('ng-word-input')?.focus(), 50);
}

function addNg(type) {
  const inputId = type === 'word' ? 'ng-word-input' : 'ng-user-input';
  const input = document.getElementById(inputId);
  const val = input?.value.trim().replace(/^@/, '');
  if (!val) return;
  if (type === 'word') {
    if (!ngData.words.includes(val)) ngData.words.push(val);
  } else if (!ngData.users.includes(val)) {
    ngData.users.push(val);
  }
  saveNg(ngData);
  openNgSettings();
  refilterBskyCols();
  toast('NG ' + type + ': ' + val + ' added');
}

function removeNg(type, idx) {
  if (type === 'word') ngData.words.splice(idx, 1);
  else ngData.users.splice(idx, 1);
  saveNg(ngData);
  openNgSettings();
  refilterBskyCols();
}

// NG繝ｫ繝ｼ繝ｫ螟画峩譎ゅ↓蜈ｨBsky繧ｫ繝ｩ繝繧貞・隱ｭ縺ｿ霎ｼ縺ｿ縺励※蜊ｳ譎ょ渚譏
function refilterBskyCols() {
  document.querySelectorAll('.col').forEach(col => {
    const cid = col.id?.replace('col-', '');
    const type = col.dataset?.type;
    if (cid && type) {
      silentRefreshBsky(cid, type, col.dataset.feeduri || null);
    }
  });
}

// 笏笏笏 STATE 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const LS_KEY = window.SocialDeckStateStore.STATE_KEY;
const MEM_KEY = 'socialdeck_mem_interval'; // 繝｡繝｢繝ｪ繧ｯ繝ｪ繧｢髢馴囈險ｭ螳壹く繝ｼ  // v4: X繝槭Ν繝√い繧ｫ繧ｦ繝ｳ繝亥ｯｾ蠢・// state.xs: X繧｢繧ｫ繧ｦ繝ｳ繝医・驟榊・ [{username, initials, bg, partition}]
// state.activeX: 繧｢繧ｯ繝・ぅ繝悶↑X繧｢繧ｫ繧ｦ繝ｳ繝医・index
// state.b: Bluesky繧｢繧ｫ繧ｦ繝ｳ繝茨ｼ亥腰荳・・let state = { xs: [], activeX: 0, b: null };
const stateStore = window.SocialDeckStateStore.createStateStore();
let state = { xs: [], activeX: 0, b: null };
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


function loadState() {
  return stateStore.load();
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

// 笏笏笏 AUTH 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
function switchTab(t) {
  document.querySelectorAll('.ltab').forEach(el => el.classList.remove('active'));
  document.querySelector(`.ltab.${t === 'x' ? 'xt' : 'bt'}`).classList.add('active');
  document.querySelectorAll('.lpanel').forEach(el => el.classList.remove('active'));
  document.getElementById(`panel-${t}`).classList.add('active');
}

function updateLoginUI() {
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

function loginX() {
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

  const idx = (state.xs || []).length;
  const partition = nextXPartition();
  const bg = AVBG[idx % AVBG.length];
  if (!state.xs) state.xs = [];
  state.xs.push({ username, initials: clean.slice(0, 2).toUpperCase(), bg, partition });
  state.activeX = idx;
  saveState();
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
  // X縺ｮ蜈ｨWebView繧ｻ繝・す繝ｧ繝ｳ繧偵け繝ｪ繧｢
  if (IS_ELECTRON && window.electronAPI?.clearAllXSessions) {
    await window.electronAPI.clearAllXSessions();
  }
  // 蜈ｨ繧ｫ繝ｩ繝縺ｮ閾ｪ蜍墓峩譁ｰ繧貞●豁｢
  refreshScheduler.clearAll();
  state = { xs: [], activeX: 0, b: null };
  saveState();
  columnRuntime.clearStoredLayout(); // 繧ｫ繝ｩ繝繝ｬ繧､繧｢繧ｦ繝医ｂ繝ｪ繧ｻ繝・ヨ
  closeAmenu();
  notificationRuntime.stopPoll();
  notificationRuntime.clearUnread();
  document.getElementById('cols').innerHTML = addColBtnHTML();
  document.getElementById('app').style.display = 'none';
  updateLoginUI();
  document.getElementById('login-screen').classList.remove('hidden');
  toast('All accounts logged out');
}

// 笏笏笏 APP RENDER 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

// 笏笏笏 DEFAULT COLUMNS 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
let colIdSeq = 0;
const colCursors = {}; // colId 竊・cursor for pagination

// X逕ｻ蜒上Λ繧､繝医・繝・け繧ｹ逕ｨWebView繝励Μ繝ｭ繝ｼ繝峨ヱ繧ｹ
// enterApp蜑阪↓遒ｺ螳壹＆縺帙※繧ｫ繝ｩ繝逕滓・譎ゅ↓遒ｺ螳溘↓菴ｿ縺医ｋ繧医≧縺ｫ縺吶ｋ
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

// 繧ｫ繝ｩ繝縺斐→縺ｫ蛻晏屓逋ｺ轣ｫ繧偵★繧峨☆縺溘ａ縺ｮ繧ｫ繧ｦ繝ｳ繧ｿ繝ｼ
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
    if (!items.length) return;

    const existingUris = new Set([...feedEl.querySelectorAll('.post[data-uri]')].map(el => el.dataset.uri));
    const firstNotifTime = feedEl.querySelector('.notif')?.dataset?.time;
    const newItems = items.filter(it => {
      if (it._notif) return !firstNotifTime || new Date(it._notif.indexedAt) > new Date(firstNotifTime);
      const uri = it.post?.uri;
      return !uri || !existingUris.has(uri);
    });
    if (!newItems.length) return;

    const html = newItems
      .filter(item => item._notif ? !isNgNotif(item._notif) : !isNgPost(item))
      .map(item => item._notif ? renderBskyNotif(item._notif) : renderBskyPost(item))
      .join('');
    if (!html) return;

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
  } catch (e) {}
}

function addColBtnHTML() {
  return `<button class="add-col-btn" onclick="openAddMod()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>霑ｽ蜉</button>`;
}

function renderDefaultCols() {
  const cols = document.getElementById('cols');
  cols.querySelectorAll('.col').forEach(c => c.remove());

  // 菫晏ｭ俶ｸ医∩繝ｬ繧､繧｢繧ｦ繝医′縺ゅｌ縺ｰ蠕ｩ蜈・  if (restoreColLayout()) return;

  // 蛻晏屓襍ｷ蜍・ Bluesky縺ｮ繝・ヵ繧ｩ繝ｫ繝医き繝ｩ繝縺ｮ縺ｿ霑ｽ蜉
  if (state.b) {
    insertBskyCol({ id: 'b-home', title: '繝帙・繝', sub: 'Bluesky', type: 'timeline', icCls: 'ic-b', icon: SVG.bsky });
    insertBskyCol({ id: 'b-notif', title: '騾夂衍', sub: 'Bluesky', type: 'notif', icCls: 'ic-n', icon: SVG.bell });
  }
}

// 笏笏笏 WEBVIEW COLUMN (X) 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
function insertWebViewCol(cfg, before = null, partition = 'persist:x') {
  const cols = document.getElementById('cols');
  const addbtn = before || cols.querySelector('.add-col-btn');
  const div = document.createElement('div');
  div.className = 'col';
  div.id = `col-${cfg.id}`;
  div.innerHTML = `
    <div class="col-head">
      <div class="col-ic ${cfg.icCls}">${cfg.icon}</div>
      <div class="col-info" style="cursor:pointer" title="蜈磯ｭ縺ｸ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ / 繝繝悶Ν繧ｯ繝ｪ繝・け縺ｧ螻暮幕" draggable="false" onclick="wvScrollTop('${cfg.id}')" ondblclick="if(collapsedCols.has('${cfg.id}'))toggleColCollapse('${cfg.id}')">
        <div class="col-title">${cfg.title}</div>
        <div class="col-sub"><div class="ldot" style="background:#e7e9ea"></div>${cfg.sub}</div>
      </div>
      <div class="col-actions">
        <button class="cbtn col-collapse-btn" title="謚倥ｊ縺溘◆繧" onclick="toggleColCollapse('${cfg.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg></button>
        <button class="cbtn" title="謌ｻ繧・ onclick="wvBack('${cfg.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button class="cbtn" id="rfr-${cfg.id}" title="譖ｴ譁ｰ" onclick="wvReload('${cfg.id}', { silent: true })"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
        <button class="cbtn" title="閾ｪ蜍墓峩譁ｰ險ｭ螳・ onclick="openColSettings('${cfg.id}','wv')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg></button>
        <button class="cbtn" title="蜑企勁" onclick="removeCol('${cfg.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>
    <div class="col-webview" style="position:relative">
      <div class="webview-loading" id="wvload-${cfg.id}"><div class="spinner"></div>隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ窶ｦ</div>
      <webview
        id="wv-${cfg.id}"
        src="${cfg.url}"
        style="flex:1;display:none"
        partition="${partition}"
        webpreferences="backgroundThrottling=false"
        ${wvPreloadPath ? `preload="${wvPreloadPath}"` : ''}
      ></webview>
      <!-- 繧ｹ繝繝ｼ繧ｺ繝ｪ繝ｭ繝ｼ繝臥畑繧ｪ繝ｼ繝舌・繝ｬ繧､・医Μ繝ｭ繝ｼ繝我ｸｭ縺ｫ迴ｾ蝨ｨ縺ｮ逕ｻ髱｢繧定｡ｨ遉ｺ縺礼ｶ壹￠繧具ｼ・-->
      <div id="wvov-${cfg.id}" style="display:none;position:absolute;inset:0;z-index:10;pointer-events:none;opacity:1;transition:opacity .4s ease"></div>
    </div>
  `;
  cols.insertBefore(div, addbtn);

  // webview 繧､繝吶Φ繝・  const wv = div.querySelector('webview');
  const wv = div.querySelector('webview');
  if (wv) {
    // 蜈ｨ繝壹・繧ｸ蜈ｱ騾壹せ繧ｿ繧､繝ｫ・医し繧､繝峨ヰ繝ｼ繝ｻ繝倥ャ繝繝ｼ髱櫁｡ｨ遉ｺ繝ｻ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繝舌・遲会ｼ・    const XSTYLES_BASE = `
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

    // 繝帙・繝縺ｮ謚慕ｨｿ谺・ｒ髱櫁｡ｨ遉ｺ・・ocialDeck繝｢繝ｼ繝繝ｫ繧剃ｽｿ縺・◆繧・ｼ・    const XSTYLES_HOME_COMPOSE = `
    const XSTYLES_HOME_COMPOSE = `
      [data-testid="tweetButtonInline"]{display:none!important}
      [data-testid="tweetTextarea_0"]{display:none!important}
      [data-testid="tweetTextarea_0_label"]{display:none!important}
      [data-testid="toolBar"]{display:none!important}
      [data-testid="tweetTextarea_0RichTextInputContainer"]{display:none!important}
      div:has(>[data-testid="tweetTextarea_0"]){display:none!important}
    `;

    // WebView蜀・〒style繧ｿ繧ｰ繧奪OM繝吶・繧ｹ縺ｧ蛻ｶ蠕｡縺吶ｋ繧ｹ繧ｯ繝ｪ繝励ヨ
    // 霑比ｿ｡繝繧､繧｢繝ｭ繧ｰ縺ｯURL縺悟､峨ｏ繧峨★DOM縺ｮ縺ｿ螟牙喧縺吶ｋ縺溘ａ縲・    // data-testid="tweetButton" 縺ｮ蜃ｺ迴ｾ/豸域ｻ・〒霑比ｿ｡繝｢繝ｼ繝峨ｒ蛻､螳壹☆繧・    // ・医・繝ｼ繝謚慕ｨｿ谺・↓縺ｯ tweetButtonInline 縺ｮ縺ｿ蟄伜惠縺・tweetButton 縺ｯ蟄伜惠縺励↑縺・ｼ・    const X_STYLE_SCRIPT = `
    const X_STYLE_SCRIPT = `
      (function() {
        // 繝吶・繧ｹ繧ｹ繧ｿ繧､繝ｫ繧呈諺蜈･・・蝗槭□縺托ｼ・        if (!document.getElementById('__sd_base_style')) {
          const s = document.createElement('style');
          s.id = '__sd_base_style';
          s.textContent = ${JSON.stringify(XSTYLES_BASE)};
          document.head.appendChild(s);
        }

        // 謚慕ｨｿ谺・撼陦ｨ遉ｺ繧ｹ繧ｿ繧､繝ｫ縺ｮON/OFF蛻ｶ蠕｡
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
          // tweetButton・郁ｿ比ｿ｡繝ｻ譁ｰ隕乗兜遞ｿ遒ｺ螳壹・繧ｿ繝ｳ・峨′蟄伜惠縺吶ｋ = 霑比ｿ｡繝繧､繧｢繝ｭ繧ｰ縺碁幕縺・※縺・ｋ
          // 繝帙・繝縺ｮ謚慕ｨｿ谺・↓縺ｯ tweetButtonInline 縺ｮ縺ｿ蟄伜惠縺・tweetButton 縺ｯ蟄伜惠縺励↑縺・          const isReplyOpen = !!document.querySelector('[data-testid="tweetButton"]');
          setComposeHide(!isReplyOpen);
        }

        // 蛻晏屓繝√ぉ繝・け
        checkCompose();

        // DOM螟牙喧繧堤屮隕悶＠縺ｦ閾ｪ蜍募・繧頑崛縺茨ｼ・0ms繝・ヰ繧ｦ繝ｳ繧ｹ縺ｧ雋闕ｷ霆ｽ貂幢ｼ・        if (window._sdStyleObserver) {
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

    // 笏笏 譁ｰ逹閾ｪ蜍戊ｪｭ縺ｿ霎ｼ縺ｿ繧ｹ繧ｯ繝ｪ繝励ヨ 笏笏
    // 1. 蜿ｯ隕匁ｧ蛛ｽ陬・ X縺悟ｸｸ縺ｫ縲瑚ｦ九ｉ繧後※縺・ｋ縲阪→隱崎ｭ倥＠譁ｰ逹繝昴・繝ｪ繝ｳ繧ｰ繧堤ｶ咏ｶ壹☆繧・    //    (繝舌ャ繧ｯ繧ｰ繝ｩ繧ｦ繝ｳ繝画凾縺ｫX縺後・繝ｼ繝ｪ繝ｳ繧ｰ繧呈ｭ｢繧√※繝舌リ繝ｼ縺悟・縺ｪ縺上↑繧句撫鬘後∈縺ｮ蟇ｾ遲・
    // 2. 繝舌リ繝ｼ荳榊庄隕門喧・・・蜍輔け繝ｪ繝・け: 縲梧眠縺励＞繝昴せ繝医ｒ陦ｨ遉ｺ縲阪ヰ繝翫・繧辰SS縺ｧ髫縺励・    //    蜃ｺ迴ｾ繧樽utationObserver縺ｧ讀懃衍縺励※蜊ｳ繧ｯ繝ｪ繝・け 竊・譁ｰ逹縺碁撕縺九↓TL縺ｫ遨阪∪繧後ｋ
    const X_AUTOLOAD_SCRIPT = `
      (function() {
        // 笏笏 蜿ｯ隕匁ｧ蛛ｽ陬・ｼ・蝗槭□縺托ｼ・笏笏
        if (!window._sdVisSpoofed) {
          window._sdVisSpoofed = true;
          try {
            Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
            Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
            // visibilitychange繧､繝吶Φ繝医・逋ｺ轣ｫ繧堤┌蜉ｹ蛹厄ｼ・idden縺ｸ縺ｮ驕ｷ遘ｻ繧湛縺ｫ遏･繧峨○縺ｪ縺・ｼ・            document.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); }, true);
            // requestAnimationFrame繧ゅヰ繝・け繧ｰ繝ｩ繧ｦ繝ｳ繝峨〒豁｢縺ｾ繧九◆繧√√ヵ繧ｩ繝ｼ繝ｫ繝舌ャ繧ｯ繧呈署萓・            window.addEventListener('blur', function(e) { e.stopImmediatePropagation(); }, true);
          } catch(err) {}
        }

        // 笏笏 繝舌リ繝ｼ荳榊庄隕門喧CSS・・蝗槭□縺托ｼ・笏笏
        if (!document.getElementById('__sd_banner_hide')) {
          var s = document.createElement('style');
          s.id = '__sd_banner_hide';
          // 繝舌リ繝ｼ繧定ｦ冶ｦ夂噪縺ｫ髫縺吶′繧ｯ繝ｪ繝・け縺ｯ蜿ｯ閭ｽ縺ｪ迥ｶ諷九↓縺吶ｋ
          s.textContent = '[data-testid$="-newTweetsButton"]{opacity:0!important;pointer-events:none!important;height:0!important;min-height:0!important;overflow:hidden!important}';
          document.head.appendChild(s);
        }

        // 笏笏 繝舌リ繝ｼ閾ｪ蜍輔け繝ｪ繝・け逶｣隕厄ｼ・蝗槭□縺托ｼ・笏笏
        function findBanner() {
          return document.querySelector('[data-testid$="-newTweetsButton"]')
            || Array.from(document.querySelectorAll('[role="button"]')).find(function(b) {
                return /譁ｰ縺励＞繝昴せ繝・譁ｰ縺励＞繝・う繝ｼ繝・Show \\d+ posts?/i.test(b.textContent || '');
            });
        }
        function clickBanner() {
          var b = findBanner();
          if (b) {
            var scroller = document.scrollingElement || document.documentElement;
            var atTop = scroller.scrollTop < 60;
            b.click();
            // 譛荳企Κ縺ｫ縺・◆縺ｨ縺阪□縺代ヨ繝・・繧堤ｶｭ謖・ｼ域眠逹縺ｮ蜈磯ｭ縺瑚ｦ九∴繧具ｼ・            if (atTop) setTimeout(function(){ window.scrollTo({top:0,behavior:'auto'}); }, 120);
            return true;
          }
          return false;
        }

        if (!window._sdBannerObserver) {
          // 蛻晏屓繝√ぉ繝・け
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

    // 蠎・相髱櫁｡ｨ遉ｺ繧樽utationObserver縺ｧ螳牙・縺ｫ螳滓命
    const X_AD_SCRIPT = `
      (function() {
        // 譌｢蟄倥・Observer繧貞・譁ｭ縺励※蜀肴磁邯夲ｼ医・繝ｼ繧ｸ驕ｷ遘ｻ蠕後ｂ遒ｺ螳溘↓蜍穂ｽ懊＆縺帙ｋ・・        if (window._sdAdObserver) {
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

    // X逕ｻ蜒上け繝ｪ繝・け繧担ocialDeck縺ｮ繝ｩ繧､繝医・繝・け繧ｹ縺ｫ郢九＄繧ｹ繧ｯ繝ｪ繝励ヨ
    const X_IMG_SCRIPT = `
      (function() {
        // 譌｢蟄倥Μ繧ｹ繝翫・繧貞炎髯､縺励※豈主屓譛譁ｰ迚医ｒ逋ｻ骭ｲ
        if (window._sdImgHandlerFn) {
          document.removeEventListener('click', window._sdImgHandlerFn, true);
        }

        function isVideoPhoto(photo) {
          if (photo.querySelector('video')) return true;
          if (photo.querySelector('[data-testid="gifPlayer"]')) return true;
          if (photo.closest('[data-testid="videoPlayer"]')) return true;
          if (photo.closest('[data-testid="gifPlayer"]')) return true;
          if (photo.closest('[data-testid="videoComponent"]')) return true;
          // 蜀咲函繝懊ち繝ｳ縺悟・蠑溯ｦ∫ｴ縺ｫ縺ゅｌ縺ｰ蜍慕判
          if (photo.parentElement?.querySelector('[data-testid="playButton"]')) return true;
          // img縺ｮalt螻樊ｧ縺後悟虚逕ｻ縲阪ｒ蜷ｫ繧・井ｾ・ 蝓九ａ霎ｼ縺ｿ蜍慕判・・          const imgAlt = photo.querySelector('img')?.getAttribute('alt') || '';
          if (imgAlt.includes('蜍慕判') || imgAlt.toLowerCase().includes('video') || imgAlt.includes('gif') || imgAlt.includes('GIF')) return true;
          // 蜍慕判繧ｵ繝繝阪う繝ｫ縺ｯamplify_video_thumb縺ｮURL繧呈戟縺､
          const img = photo.querySelector('img');
          if (img?.src?.includes('amplify_video_thumb')) return true;
          if (img?.src?.includes('ext_tw_video_thumb')) return true;
          if (img?.src?.includes('tweet_video_thumb')) return true;
          // 3髫主ｱ､荳翫・繧ｳ繝ｳ繝・リ縺ｫ蜍慕判隕∫ｴ縺後≠繧後・蜍慕判
          const container = photo.parentElement?.parentElement?.parentElement;
          if (container?.querySelector('video, [data-testid="videoPlayer"], [data-testid="gifPlayer"], [data-testid="playButton"]')) return true;
          return false;
        }

        window._sdImgHandlerFn = e => {
          // videoPlayer繝ｻgifPlayer繝ｻ蜀咲函繝懊ち繝ｳ閾ｪ菴薙・繧ｯ繝ｪ繝・け縺ｯ髯､螟・          if (e.target.closest('[data-testid="videoPlayer"]')) return;
          if (e.target.closest('[data-testid="gifPlayer"]')) return;
          if (e.target.closest('[data-testid="playButton"]')) return;
          if (e.target.closest('[data-testid="videoComponent"]')) return;

          const imgEl = e.target.closest('[data-testid="tweetPhoto"]');
          if (!imgEl) return;

          // 蜍慕判繝ｻGIF蛻､螳・          if (isVideoPhoto(imgEl)) return;

          // pbs.twimg.com 縺ｮ逕ｻ蜒上・縺ｿ蜿朱寔・亥虚逕ｻ縺ｨ蛻､螳壹＆繧後↑縺аhoto縺ｮ縺ｿ・・          const tweet = imgEl.closest('[data-testid="tweet"]') || document.body;
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

    // X霑比ｿ｡繝懊ち繝ｳ繧担ocialDeck縺ｮ謚慕ｨｿ繝｢繝ｼ繝繝ｫ縺ｫ郢九＄繧ｹ繧ｯ繝ｪ繝励ヨ
    // dom-ready: 繧ｹ繝斐リ繝ｼ繧呈ｶ医＠縺ｦwebview繧定｡ｨ遉ｺ
    let _domReadyOnce = false;
    wv.addEventListener('dom-ready', () => {
      document.getElementById(`wvload-${cfg.id}`).style.display = 'none';
      wv.style.display = 'flex';
      wv.style.flex = '1';
      applyXStyles();
      applyXAutoload();
      wv.executeJavaScript(X_AD_SCRIPT).catch(() => {});
      wv.executeJavaScript(X_IMG_SCRIPT).catch(() => {});
      // 閾ｪ蜍墓峩譁ｰ繧ｿ繧､繝槭・縺ｯ蛻晏屓縺ｮ縺ｿ險ｭ螳夲ｼ・hareX遲峨↓繧医ｋ dom-ready 蜀咲匱轣ｫ縺ｧ繝ｪ繧ｻ繝・ヨ縺輔ｌ縺ｪ縺・ｈ縺・↓・・      if (!_domReadyOnce) {
      if (!_domReadyOnce) {
        _domReadyOnce = true;
        if (autoRefreshIntervals[cfg.id] === undefined) {
          setAutoRefreshWv(cfg.id, DEFAULT_INTERVAL_MS);
        }
      }
    });

    // did-finish-load: 繧ｹ繧ｿ繧､繝ｫ蜀肴ｳｨ蜈･繝ｻ蠎・相髯､蜴ｻ繝ｻ繧ｪ繝ｼ繝舌・繝ｬ繧､繝輔ぉ繝ｼ繝峨い繧ｦ繝・    wv.addEventListener('did-finish-load', () => {
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
      // 繝翫ン繧ｲ繝ｼ繧ｷ繝ｧ繝ｳ螳御ｺ・ｾ後↓繝ｬ繧､繧｢繧ｦ繝医ｒ菫晏ｭ假ｼ域ｭ｣隕丞喧貂医∩URL縺御ｽｿ繧上ｌ繧具ｼ・      saveColLayout();

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

    // WebView縺九ｉ縺ｮipc-message繧貞女菫｡
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
      document.getElementById(`wvload-${cfg.id}`).innerHTML = `<div style="color:var(--red);font-size:12px;text-align:center;padding:20px">隱ｭ縺ｿ霎ｼ縺ｿ縺ｫ螟ｱ謨励＠縺ｾ縺励◆<br><button onclick="wvReload('${cfg.id}')" style="margin-top:8px;padding:4px 10px;border-radius:5px;background:transparent;border:1px solid var(--red);color:var(--red);cursor:pointer;font-size:11px">蜀崎ｩｦ陦・/button></div>`;
    });
  }
}

function wvBack(id) { const wv = document.getElementById(`wv-${id}`); if (wv?.canGoBack()) wv.goBack(); }

// 笏笏笏 COLUMN COLLAPSE 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const collapsedCols = new Set();
function toggleColCollapse(id) {
  const col = document.getElementById(`col-${id}`);
  if (!col) return;
  const isCollapsed = collapsedCols.has(id);
  const btn = col.querySelector('.col-collapse-btn');

  if (isCollapsed) {
    // 螻暮幕
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
    if (btn) btn.title = '謚倥ｊ縺溘◆繧';
    // 謚倥ｊ縺溘◆縺ｿ荳ｭ繧ｯ繝ｪ繝・け螻暮幕繧定ｧ｣髯､
    col.style.cursor = '';
    col._sdCollapseClick = null;
    saveColLayout();
  } else {
    // 謚倥ｊ縺溘◆縺ｿ
    collapsedCols.add(id);
    col.dataset.savedWidth = col.style.width || '';
    col.style.width = '42px';
    col.style.minWidth = '42px';
    col.querySelectorAll('.feed, .col-webview, .col-search-bar').forEach(el => { el.style.display = 'none'; });
    const titleEl = col.querySelector('.col-title');
    if (titleEl) { titleEl.style.writingMode = 'vertical-rl'; titleEl.style.maxWidth = '20px'; }
    // 謚倥ｊ縺溘◆縺ｿ繝懊ち繝ｳ莉･螟悶・繧｢繧ｯ繧ｷ繝ｧ繝ｳ繝懊ち繝ｳ繧帝撼陦ｨ遉ｺ
    col.querySelectorAll('.col-actions .cbtn:not(.col-collapse-btn)').forEach(el => { el.style.display = 'none'; });
    if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>`;
    if (btn) btn.title = '螻暮幕縺吶ｋ';
    // 謚倥ｊ縺溘◆縺ｿ荳ｭ縺ｯ繧ｫ繝ｩ繝蜈ｨ菴薙け繝ｪ繝・け縺ｧ螻暮幕
    col.style.cursor = 'pointer';
    if (!col._sdCollapseClick) {
      col._sdCollapseClick = (e) => {
        if (!collapsedCols.has(id)) return;
        // 繝懊ち繝ｳ繧ｯ繝ｪ繝・け縺ｯtoggleColCollapse縺悟挨騾泌・逅・☆繧九・縺ｧ莠碁㍾逋ｺ轣ｫ繧帝亟縺・        if (e.target.closest('button')) return;
        toggleColCollapse(id);
      };
      col.addEventListener('click', col._sdCollapseClick);
    }
    saveColLayout();
  }
}

function openFirstXWebViewDevTools() {
  const cols = document.getElementById('cols');
  let target = null;
  cols?.querySelectorAll('.col').forEach(col => {
    const wv = col.querySelector('webview');
    if (!wv?.src?.includes('x.com')) return;
    if (!target || wv.src.includes('x.com/home')) target = wv;
  });
  if (target) target.openDevTools();
  else toast('X WebView not found');
}

// 繧ｫ繝ｩ繝繝倥ャ繝繝ｼ繧ｯ繝ｪ繝・け縺ｧ蜈磯ｭ縺ｸ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ
// 繧ｫ繝ｩ繝繝倥ャ繝繝ｼ繧ｯ繝ｪ繝・け縺ｧ蜈磯ｭ縺ｸ・亥・縺ｮURL縺ｫ謌ｻ縺励※繝ｪ繝ｭ繝ｼ繝会ｼ・function wvScrollTop(id) {
function wvScrollTop(id) {
  // 謚倥ｊ縺溘◆縺ｿ荳ｭ縺ｯ繧ｷ繝ｳ繧ｰ繝ｫ繧ｯ繝ｪ繝・け縺ｧ繧ょｱ暮幕
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
  // 謚倥ｊ縺溘◆縺ｿ荳ｭ縺ｯ繧ｷ繝ｳ繧ｰ繝ｫ繧ｯ繝ｪ繝・け縺ｧ繧ょｱ暮幕
  if (collapsedCols.has(cid)) { toggleColCollapse(cid); return; }
  const feedEl = document.getElementById(`feed-${cid}`);
  if (feedEl) feedEl.scrollTo({ top: 0, behavior: 'smooth' });
}

// 繧ｹ繝繝ｼ繧ｺ繝ｪ繝ｭ繝ｼ繝・ 繧ｭ繝｣繝励メ繝｣ 竊・繧ｪ繝ｼ繝舌・繝ｬ繧､陦ｨ遉ｺ 竊・reload 竊・繝輔ぉ繝ｼ繝峨い繧ｦ繝・let xPostingNow = false;
const wvReloadQueue = new Set();
const wvSilentReloading = new Set();

function setWvRefreshBusy(id, busy) {
  const btn = document.getElementById(`rfr-${id}`);
  if (btn) btn.classList.toggle('updating', !!busy);
  const sub = document.querySelector(`#col-${id} .col-sub`);
  if (!sub) return;
  if (busy) {
    if (!sub.dataset.origText) sub.dataset.origText = sub.innerHTML;
    sub.innerHTML = '<div class="ldot" style="background:var(--accent)"></div>譖ｴ譁ｰ荳ｭ...';
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

// 繧ｽ繝輔ヨ繝ｪ繝ｭ繝ｼ繝・ 繝壹・繧ｸ蜈ｨ菴薙ｒ蜀崎ｪｭ縺ｿ霎ｼ縺ｿ縺帙★縲々縺ｮ縲梧眠縺励＞繝昴せ繝医阪・繧ｿ繝ｳ繧偵け繝ｪ繝・け縺励※
// 譁ｰ逹繧定ｪｭ縺ｿ霎ｼ繧縲ゅせ繧ｯ繝ｭ繝ｼ繝ｫ菴咲ｽｮ縺ｨ繧ｻ繝・す繝ｧ繝ｳ縺檎ｶｭ謖√＆繧後ｋ縺溘ａ隕也せ縺碁｣帙・縺ｪ縺・・// 謌仙粥縺励◆繧液rue縲√・繧ｿ繝ｳ縺檎┌縺・螟ｱ謨励↑繧映alse繧定ｿ斐☆・亥他縺ｳ蜃ｺ縺怜・縺ｧ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ蛻､譁ｭ・・async function softReloadX(id) {
async function softReloadX(id) {
  const wv = document.getElementById(`wv-${id}`);
  if (!wv || wv.style.display === 'none') return false;
  if (xPostingNow) { wvReloadQueue.add(id); return true; }

  try {
    const result = await wv.executeJavaScript(`
      (function() {
        return new Promise(function(resolve) {
          // 縲梧眠縺励＞繝昴せ繝医ｒ陦ｨ遉ｺ縲阪ヰ繝翫・繝懊ち繝ｳ繧呈爾縺・          function findBanner() {
            return document.querySelector('[data-testid="cellInnerDiv"] [role="button"][data-testid$="-newTweetsButton"]')
              || Array.from(document.querySelectorAll('[role="button"]')).find(function(b) {
                  return /譁ｰ縺励＞繝昴せ繝・譁ｰ縺励＞繝・う繝ｼ繝・Show .* posts?/i.test(b.textContent || '');
              });
          }

          var scroller = document.scrollingElement || document.documentElement;
          var atTop = scroller.scrollTop < 60;
          var banner = findBanner();

          // 繝舌リ繝ｼ縺梧里縺ｫ縺ゅｋ 竊・繧ｯ繝ｪ繝・け縺励※蜿肴丐
          if (banner) {
            banner.click();
            if (atTop) setTimeout(function(){ window.scrollTo({top:0,behavior:'smooth'}); }, 150);
            resolve('clicked');
            return;
          }

          // 譛荳企Κ縺ｧ繝舌リ繝ｼ縺檎┌縺・竊・X縺ｫ譁ｰ逹繝ｭ繝ｼ繝峨ｒ菫・☆
          if (atTop) {
            var origTop = scroller.scrollTop;
            // 縺斐￥遏ｭ縺・ｸ銀・荳翫・繝励Ν蜍穂ｽ懊〒譁ｰ逹蜿門ｾ励ｒ繝医Μ繧ｬ繝ｼ
            window.scrollTo({ top: origTop + 60, behavior: 'auto' });
            setTimeout(function() {
              window.scrollTo({ top: origTop, behavior: 'auto' });
              // 蟆代＠蠕・▲縺ｦ繝舌リ繝ｼ蜃ｺ迴ｾ繧偵メ繧ｧ繝・け
              setTimeout(function() {
                var b2 = findBanner();
                if (b2) {
                  b2.click();
                  setTimeout(function(){ window.scrollTo({top:0,behavior:'smooth'}); }, 150);
                  resolve('clicked');
                } else {
                  // 繝舌リ繝ｼ縺悟・縺ｪ縺・竊・繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ繧定ｦ∵ｱ・                  resolve('none');
                }
              }, 800);
            }, 60);
            return;
          }

          // 荳九・譁ｹ繧定ｦ九※縺・ｋ 竊・菴輔ｂ縺励↑縺・ｼ郁ｦ也せ邯ｭ謖√∵ｬ｡蝗槭ヰ繝翫・蜃ｺ迴ｾ譎ゅ↓蜿門ｾ暦ｼ・          resolve('scrolled');
        });
      })();
    `);
    // 'clicked' 縺ｨ 'scrolled' 縺ｯ謌仙粥謇ｱ縺・・none' 縺ｯ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ隕∵ｱ・    return result === 'clicked';
  } catch {
    return false;
  }
}

function setAutoRefreshWv(id, ms) {
  refreshScheduler.set(id, ms, async () => {
    // 縺ｾ縺壹た繝輔ヨ繝ｪ繝ｭ繝ｼ繝峨ｒ隧ｦ縺ｿ縲∝柑縺九↑縺・ｴ蜷医・縺ｿ蠕捺擂縺ｮ繝輔Ν繝ｪ繝ｭ繝ｼ繝・    const ok = await softReloadX(id);
    if (!ok) wvReload(id, { silent: true });
  });
}

// 笏笏笏 BLUESKY COLUMN 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
function insertBskyCol(cfg, before = null) {
  const cols = document.getElementById('cols');
  const addbtn = before || cols.querySelector('.add-col-btn');
  const cid = cfg.id || `b-${++colIdSeq}`;
  colCursors[cid] = null;

  const div = document.createElement('div');
  div.className = 'col';
  div.id = `col-${cid}`;
  // refreshBskyCol 縺・type 縺ｨ feedUri 繧定ｪｭ縺ｿ蜿悶ｌ繧九ｈ縺・↓ dataset 縺ｫ菫晏ｭ・  div.dataset.type = cfg.type || 'timeline';
  if (cfg.feedUri) div.dataset.feeduri = cfg.feedUri;

  const hasSearch = cfg.type === 'search';
  div.innerHTML = `
    <div class="col-head">
      <div class="col-ic ${cfg.icCls}">${cfg.icon}</div>
      <div class="col-info" style="cursor:pointer" title="蜈磯ｭ縺ｸ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ / 繝繝悶Ν繧ｯ繝ｪ繝・け縺ｧ螻暮幕" draggable="false" onclick="bskyScrollTop('${cid}')" ondblclick="if(collapsedCols.has('${cid}'))toggleColCollapse('${cid}')">
        <div class="col-title">${cfg.title}</div>
        <div class="col-sub"><div class="ldot"></div>${cfg.sub}</div>
      </div>
      <div class="col-actions">
        <span class="cbadge" id="badge-${cid}" style="display:none"></span>
        <button class="cbtn" id="rfr-${cid}" title="譖ｴ譁ｰ" onclick="refreshBskyCol('${cid}',this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
        <button class="cbtn col-collapse-btn" title="謚倥ｊ縺溘◆繧" onclick="toggleColCollapse('${cid}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg></button>
        <button class="cbtn" title="閾ｪ蜍墓峩譁ｰ險ｭ螳・ onclick="openColSettings('${cid}','bsky','${cfg.type||`timeline`}','${cfg.feedUri||``}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg></button>
        <button class="cbtn" title="蜑企勁" onclick="removeCol('${cid}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>
    ${hasSearch ? `<div class="col-search-bar"><input type="text" id="sq-${cid}" placeholder="Bluesky 繧呈､懃ｴ｢窶ｦ" onkeydown="if(event.key==='Enter')doSearch('${cid}')"><button onclick="doSearch('${cid}')">讀懃ｴ｢</button></div>` : ''}
    <div class="feed" id="feed-${cid}"><div class="feed-loading"><div class="spinner"></div>隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ窶ｦ</div></div>
  `;
  cols.insertBefore(div, addbtn);

  // 閾ｪ蜍輔Ο繝ｼ繝峨→繝・ヵ繧ｩ繝ｫ繝郁・蜍墓峩譁ｰ髢句ｧ・  if (!hasSearch) {
  if (!hasSearch) {
    loadBskyFeed(cid, cfg.type, cfg.feedUri);
    setAutoRefresh(cid, DEFAULT_INTERVAL_MS, cfg.type, cfg.feedUri);
  }
  // 繝輔か繝ｳ繝医し繧､繧ｺ險ｭ螳壹ｒ蠕ｩ蜈・  const savedFs = parseInt(localStorage.getItem(`col_fs_${cid}`));
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
  if (!append) { feedEl.innerHTML = `<div class="feed-loading"><div class="spinner"></div>隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ窶ｦ</div>`; colCursors[cid] = null; }

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
      .filter(item => item._notif ? !isNgNotif(item._notif) : !isNgPost(item))
      .map(item => item._notif ? renderBskyNotif(item._notif) : renderBskyPost(item)).join('');

    if (append) {
      feedEl.querySelector('.load-more')?.remove();
      feedEl.insertAdjacentHTML('beforeend', html);
    } else {
      feedEl.innerHTML = html || `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">謚慕ｨｿ縺後≠繧翫∪縺帙ｓ</div>`;
    }

    // 繝輔ぅ繝ｼ繝峨・繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ縺ｧ譛ｪ隱ｭ繝舌ャ繧ｸ繧偵Μ繧ｻ繝・ヨ
    const feedElForScroll = document.getElementById(`feed-${cid}`);
    if (feedElForScroll) {
      feedElForScroll.addEventListener('scroll', () => {
        const badge = document.getElementById(`badge-${cid}`);
        if (badge) badge.style.display = 'none';
      }, { once: true });
    }

    // 繧ゅ▲縺ｨ隱ｭ繧繝懊ち繝ｳ
    if (newCursor && type !== 'notif') {
      feedEl.insertAdjacentHTML('beforeend', `<button class="load-more" onclick="loadBskyFeed('${cid}','${type}',${feedUri ? `'${feedUri}'` : 'null'},true)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="6 9 12 15 18 9"/></svg>繧ゅ▲縺ｨ隕九ｋ</button>`);
    }

    // 繝舌ャ繧ｸ譖ｴ譁ｰ
    const badge = document.getElementById(`badge-${cid}`);
    if (badge && items.length) { badge.textContent = items.length; badge.style.display = ''; setTimeout(() => { badge.style.display = 'none'; }, 5000); }
  } catch (e) {
    if (!append) feedEl.innerHTML = `<div class="feed-err">蜿門ｾ励お繝ｩ繝ｼ: ${esc(e.message)}<br><button onclick="loadBskyFeed('${cid}','${type}',${feedUri ? `'${feedUri}'` : 'null'})">蜀崎ｩｦ陦・/button></div>`;
    else toast(`繧ｨ繝ｩ繝ｼ: ${e.message}`);
  }
}

async function doSearch(cid) {
  const q = document.getElementById(`sq-${cid}`)?.value?.trim();
  if (!q) return;
  const feedEl = document.getElementById(`feed-${cid}`);
  feedEl.innerHTML = `<div class="feed-loading"><div class="spinner"></div>讀懃ｴ｢荳ｭ窶ｦ</div>`;
  try {
    const data = await bsky.search(state.b.accessJwt, q, 40);
    const posts = data.posts || [];
    feedEl.innerHTML = posts.length
      ? posts.map(p => renderBskyPost({ post: p })).join('')
      : `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">縲・{esc(q)}縲阪・邨先棡縺ｯ0莉ｶ縺ｧ縺・/div>`;
  } catch (e) {
    feedEl.innerHTML = `<div class="feed-err">讀懃ｴ｢繧ｨ繝ｩ繝ｼ: ${esc(e.message)}<br><button onclick="doSearch('${cid}')">蜀崎ｩｦ陦・/button></div>`;
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

// 笏笏笏 BLUESKY POST RENDERING 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

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
  return '<div class="post" data-uri="' + esc(uri) + '" data-cid="' + esc(cid) + '" data-likeuri="' + esc(likeUri) + '" data-reposturi="' + esc(repostUri) + '" oncontextmenu="showPostMenu(event,\'' + esc(author.handle) + '\')">' +
    repostLabel +
    '<div class="post-top">' + renderAvatar(author) + '<div class="post-meta"><div class="meta-row"><span class="p-name" title="' + esc(author.displayName || author.handle) + '">' + esc(author.displayName || author.handle) + '</span><span class="p-handle">@' + esc(author.handle) + '</span><span class="p-time">' + time + '</span></div></div></div>' +
    '<div class="p-body">' + body + '</div>' + imgHtml +
    '<div class="p-acts">' +
    '<button class="pa rep" onclick="openReply(\'' + esc(uri) + '\',\'' + esc(cid) + '\',\'' + esc(author.handle) + '\')">' + SVG.reply + ' ' + replies + '</button>' +
    '<button class="pa rt ' + (reposted ? 'rted' : '') + '" onclick="showRtMenu(event,this,\'' + esc(uri) + '\',\'' + esc(cid) + '\',\'' + esc(author.handle) + '\')">' + SVG.rt + ' <span>' + rts + '</span></button>' +
    '<button class="pa lk ' + (liked ? 'liked' : '') + '" onclick="toggleLike(this,\'' + esc(uri) + '\',\'' + esc(cid) + '\',' + likes + ')">' + SVG.heart.replace('none', liked ? 'currentColor' : 'none') + ' <span>' + likes + '</span></button>' +
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
const hoverCardCache = {}; // did 竊・profile data

function hoverCardShow(event, did, handle) {
  if (!did && !handle) return;
  clearTimeout(hoverCardHideTimer);
  // 300ms蠕後↓陦ｨ遉ｺ・医■繧峨▽縺埼亟豁｢・・  hoverCardTimer = setTimeout(() => _hoverCardRender(event.target, did, handle), 300);
  hoverCardTimer = setTimeout(() => _hoverCardRender(event.target, did, handle), 300);
}

function hoverCardHide() {
  clearTimeout(hoverCardTimer);
  // 繧ｫ繝ｼ繝我ｸ翫↓繝槭え繧ｹ縺御ｹ励▲縺溷ｴ蜷医・豸医＆縺ｪ縺・  hoverCardHideTimer = setTimeout(() => {
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
  btnEl.disabled = true; btnEl.textContent = '窶ｦ';
  try {
    if (isFollowing) {
      await bskyCallWithRefresh(jwt => bsky.unfollow(jwt, state.b.did, followUri));
      const key = did || handle;
      if (hoverCardCache[key]) hoverCardCache[key].viewer = { ...hoverCardCache[key].viewer, following: null };
      btnEl.style.borderColor = 'var(--accent)'; btnEl.style.background = 'var(--accent)'; btnEl.style.color = '#fff';
      btnEl.textContent = '繝輔か繝ｭ繝ｼ'; btnEl.dataset.followuri = ''; btnEl.disabled = false;
      toast(`@${handle} 縺ｮ繝輔か繝ｭ繝ｼ繧定ｧ｣髯､縺励∪縺励◆`);
    } else {
      const res = await bskyCallWithRefresh(jwt => bsky.follow(jwt, state.b.did, did));
      const newFollowUri = res?.uri || '';
      const key = did || handle;
      if (hoverCardCache[key]) hoverCardCache[key].viewer = { ...hoverCardCache[key].viewer, following: newFollowUri };
      btnEl.style.borderColor = 'var(--border2)'; btnEl.style.background = 'transparent'; btnEl.style.color = 'var(--text2)';
      btnEl.textContent = '繝輔か繝ｭ繝ｼ荳ｭ'; btnEl.dataset.followuri = newFollowUri; btnEl.disabled = false;
      toast(`@${handle} 繧偵ヵ繧ｩ繝ｭ繝ｼ縺励∪縺励◆`);
    }
  } catch(e) {
    toast(`繧ｨ繝ｩ繝ｼ: ${e.message}`);
    btnEl.disabled = false; btnEl.textContent = isFollowing ? '繝輔か繝ｭ繝ｼ荳ｭ' : '繝輔か繝ｭ繝ｼ';
  }
}

function _hoverCardPosition(card, target) {
  const rect = target.getBoundingClientRect();
  const cardW = 280, cardH = 200; // 讎らｮ・  const vw = window.innerWidth, vh = window.innerHeight;

  let left = rect.left;
  let top = rect.bottom + 8;

  // 蜿ｳ遶ｯ縺ｯ縺ｿ蜃ｺ縺苓｣懈ｭ｣
  if (left + cardW > vw - 10) left = vw - cardW - 10;
  // 荳狗ｫｯ縺ｯ縺ｿ蜃ｺ縺・竊・荳翫↓陦ｨ遉ｺ
  if (top + cardH > vh - 10) top = rect.top - cardH - 8;
  // 蠢ｵ縺ｮ縺溘ａ蟾ｦ遶ｯ陬懈ｭ｣
  if (left < 10) left = 10;

  card.style.left = left + 'px';
  card.style.top = top + 'px';
}

// 笏笏笏 INTERACTIONS 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
async function toggleLike(btn, uri, cid, baseLikes) {
  if (!state.b) return;
  const post = btn.closest('.post');
  const on = !btn.classList.contains('liked');
  // 讌ｽ隕ｳ逧ФI譖ｴ譁ｰ
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
    toast(on ? '縺・＞縺ｭ縺励∪縺励◆' : '縺・＞縺ｭ繧貞叙繧頑ｶ医＠縺ｾ縺励◆');
  } catch (e) {
    // 螟ｱ謨玲凾縺ｯ繝ｭ繝ｼ繝ｫ繝舌ャ繧ｯ
    btn.classList.toggle('liked', !on);
    if (svg) svg.setAttribute('fill', !on ? 'currentColor' : 'none');
    if (span) span.textContent = baseLikes;
    toast(`繧ｨ繝ｩ繝ｼ: ${e.message}`);
  }
}

// 笏笏笏 REPOST MENU 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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
      蠑慕畑繝ｪ繝昴せ繝・    </div>
  `;
  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 50);
}

// 蠑慕畑繝ｪ繝昴せ繝医Δ繝ｼ繝繝ｫ
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
          蠑慕畑繝ｪ繝昴せ繝・        </h2>
        <button onclick="document.getElementById('quote-modal-ov')?.remove();quoteTarget=null"
          style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:2px 6px">笨・/button>
      </div>
      <!-- 蠑慕畑蜈・・繝ｬ繝薙Η繝ｼ -->
      <div style="border:1px solid var(--border2);border-radius:8px;padding:9px 11px;margin-bottom:12px;font-size:12px;color:var(--text2)">
        <div style="font-weight:700;color:var(--text2);margin-bottom:3px">@${esc(handle)} 縺ｮ謚慕ｨｿ繧貞ｼ慕畑</div>
        <div style="color:var(--text3);font-size:11px">${esc(uri.split('/').pop())}</div>
      </div>
      <div class="comp-wrap">
        <div class="comp-av" style="background:${avBg};position:relative;overflow:hidden">${avInner}</div>
        <textarea class="comp-ta" id="quote-ta" placeholder="繧ｳ繝｡繝ｳ繝医ｒ霑ｽ蜉窶ｦ" maxlength="300" oninput="updQuoteCC()"></textarea>
      </div>
      <div class="comp-foot">
        <span class="cc" id="quote-cct">0 / 300</span>
        <button class="send-btn" id="quote-sndb" onclick="doQuotePost()">蠑慕畑縺励※謚慕ｨｿ</button>
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
  if (btn) { btn.disabled = true; btn.textContent = '謚慕ｨｿ荳ｭ窶ｦ'; }
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
    toast(`繧ｨ繝ｩ繝ｼ: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = '蠑慕畑縺励※謚慕ｨｿ'; }
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
    toast(on ? '繝ｪ繝昴せ繝医＠縺ｾ縺励◆' : '繝ｪ繝昴せ繝医ｒ蜿悶ｊ豸医＠縺ｾ縺励◆');
  } catch (e) {
    btn.classList.toggle('rted', !on);
    if (span) span.textContent = cur;
    toast(`繧ｨ繝ｩ繝ｼ: ${e.message}`);
  }
}

let replyTarget = null; // { uri, cid, rootUri, rootCid }

async function openReply(uri, cid, handle) {
  replyTarget = { uri, cid, rootUri: uri, rootCid: cid };

  // 霑比ｿ｡蜈医・繝ｬ繝薙Η繝ｼ繧定｡ｨ遉ｺ
  const mod = document.getElementById('compMod');
  let preview = mod.querySelector('.bsky-reply-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.className = 'bsky-reply-preview';
    preview.style.cssText = 'border:1px solid var(--border2);border-radius:8px;padding:8px 11px;margin-bottom:10px;font-size:11px;color:var(--text3);display:flex;align-items:center;gap:7px';
    const compWrap = mod.querySelector('.comp-wrap');
    compWrap.parentNode.insertBefore(preview, compWrap);
  }
  preview.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;flex-shrink:0"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg><span style="color:var(--text2)">@${esc(handle)}</span> 縺ｸ縺ｮ霑比ｿ｡`;

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
    // Electron迺ｰ蠅・〒縺ｯshell.openExternal繧棚PC邨檎罰縺ｧ蜻ｼ縺ｹ縺ｪ縺・◆繧『ebview縺ｧ髢九￥
    // 莉｣譖ｿ: bsky.app繧淡ebView繧ｫ繝ｩ繝縺ｨ縺励※霑ｽ蜉
    openBskyProfileCol(cached.handle);
  } else {
    openBskyProfileCol(did);
  }
}

function openBskyProfileCol(handleOrDid) {
  const url = `https://bsky.app/profile/${handleOrDid}`;

  // 譌｢縺ｫ蜷後§繝励Ο繝輔ぅ繝ｼ繝ｫ縺ｮ繧ｫ繝ｩ繝縺後≠繧後・縺昴％縺ｸ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ
  const existing = Array.from(document.querySelectorAll('webview')).find(w => w.src === url);
  if (existing) {
    const col = existing.closest('.col');
    if (col) {
      // 謚倥ｊ縺溘◆縺ｿ荳ｭ縺ｪ繧牙ｱ暮幕
      const cid = col.id?.replace('col-', '');
      if (cid && collapsedCols.has(cid)) toggleColCollapse(cid);
      col.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      toast('譌｢蟄倥・繝励Ο繝輔ぅ繝ｼ繝ｫ繧ｫ繝ｩ繝繧定｡ｨ遉ｺ縺励∪縺励◆');
      return;
    }
  }

  extraColN++;
  const id = `bsky-prof-${extraColN}`;
  insertWebViewCol({ id, title: '繝励Ο繝輔ぅ繝ｼ繝ｫ', sub: 'Bluesky', url, icCls: 'ic-b', icon: SVG.bsky }, null, 'persist:bsky');
  setTimeout(() => {
    const col = document.getElementById(`col-${id}`);
    if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'end' });
  }, 300);
  saveColLayout();
  toast('繝励Ο繝輔ぅ繝ｼ繝ｫ繧ｫ繝ｩ繝繧帝幕縺阪∪縺励◆');
}

// 笏笏笏 COMPOSE 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
function renderCompUI() {
  // 繧ｵ繧､繝峨ヰ繝ｼ謚慕ｨｿ繝懊ち繝ｳ縺ｮ陦ｨ遉ｺ蛻・ｊ譖ｿ縺・  const xBtn = document.getElementById('sb-post-x');
  const bBtn = document.getElementById('sb-post-b');
  if (xBtn) xBtn.style.display = (state.xs && state.xs.length > 0) ? 'flex' : 'none';
  if (bBtn) bBtn.style.display = state.b ? 'flex' : 'none';

  // 騾夂衍繧｢繧､繧ｳ繝ｳ繧呈緒逕ｻ・・b-notif-icons縺ｫ荳譛ｬ蛹厄ｼ・  renderNotifIcons();

  // Bluesky謚慕ｨｿ繝｢繝ｼ繝繝ｫ縺ｮ繧｢繝舌ち繝ｼ險ｭ螳・  const avEl = document.getElementById('comp-av');
  if (avEl && state.b) {
    avEl.style.background = state.b.bg || '';
    if (state.b.avatar) {
      avEl.innerHTML = `<img src="${state.b.avatar}"><span id="comp-av-txt" style="display:none"></span>`;
    } else {
      avEl.innerHTML = `<span id="comp-av-txt">${state.b.initials || '?'}</span>`;
    }
  }

  // X謚慕ｨｿ繝｢繝ｼ繝繝ｫ縺ｮ繧｢繝舌ち繝ｼ險ｭ螳・  const xAvEl = document.getElementById('x-post-av');
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

let selectedXIdx = 0; // 謚慕ｨｿ縺ｫ菴ｿ縺・繧｢繧ｫ繧ｦ繝ｳ繝医・index

function openXPost() {
  // 繧｢繧ｫ繧ｦ繝ｳ繝磯∈謚朸I繧呈ｧ狗ｯ・  const sel = document.getElementById('x-acc-select');
  const xs = state.xs || [];

  if (xs.length <= 1) {
    // 1繧｢繧ｫ繧ｦ繝ｳ繝医・縺ｿ縺ｪ繧蛾∈謚朸I繧帝撼陦ｨ遉ｺ
    sel.style.display = 'none';
    selectedXIdx = 0;
  } else {
    // 隍・焚繧｢繧ｫ繧ｦ繝ｳ繝医↑繧峨・繧ｿ繝ｳ繧定｡ｨ遉ｺ
    sel.style.display = 'flex';
    sel.innerHTML = xs.map((a, i) => `
      <button id="x-acc-btn-${i}" onclick="selectXAcc(${i})"
        style="display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;border:2px solid ${i === selectedXIdx ? 'var(--accent)' : 'var(--border2)'};background:${i === selectedXIdx ? 'var(--accent-dim)' : 'transparent'};color:${i === selectedXIdx ? 'var(--accent)' : 'var(--text2)'};cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;transition:all .12s">
        <span style="width:20px;height:20px;border-radius:50%;background:${a.bg};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#000;flex-shrink:0">${a.initials}</span>
        ${esc(a.username)}
      </button>`).join('');
  }

  // 繧｢繝舌ち繝ｼ繧帝∈謚樔ｸｭ繧｢繧ｫ繧ｦ繝ｳ繝医↓譖ｴ譁ｰ
  updateXPostAv();
  document.getElementById('xPostMod').classList.add('on');
  setTimeout(() => document.getElementById('x-cta')?.focus(), 50);
}

function selectXAcc(idx) {
  selectedXIdx = idx;
  // 繝懊ち繝ｳ縺ｮ繧ｹ繧ｿ繧､繝ｫ繧呈峩譁ｰ
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

// 笏笏笏 X謚慕ｨｿ 逕ｻ蜒上・蜍慕判邂｡逅・笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
let xImgFiles = [];    // File[] 譛螟ｧ4譫・let xVideoFile = null; // 蜍慕判File・・譛ｬ・・let xVideoPath = null; // 蜍慕判縺ｮ繝ｭ繝ｼ繧ｫ繝ｫ繝代せ・・lectron迺ｰ蠅・ｼ・let xTrimIn = 0;       // 繝医Μ繝髢句ｧ狗ｧ・let xTrimOut = 0;      // 繝医Μ繝邨ゆｺ・ｧ・
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

// 笏笏 逕ｻ蜒剰ｿｽ蜉 笏笏
function handleXImgDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-on');
  const files = [...e.dataTransfer.files];
  addXImgFiles(files);
}

function addXImgFiles(files) {
  const arr = composeMedia.toFiles(files);

  const videoFile = composeMedia.firstVideo(arr);
  if (videoFile) {
    if (xImgFiles.length > 0) { toast('Cannot attach images and video together'); return; }
    setXVideo(videoFile);
    const fi = document.getElementById('x-img-file');
    if (fi) fi.value = '';
    return;
  }

  if (xVideoFile) { toast('Cannot attach images and video together'); return; }

  const imageFiles = composeMedia.imageFiles(arr);
  const remaining = composeMedia.availableImageSlots(xImgFiles.length);
  if (remaining <= 0) { toast('Up to 4 images can be attached'); return; }
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
        style="position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;border:none;background:rgba(0,0,0,0.75);color:#fff;cursor:pointer;font-size:11px;line-height:1;padding:0;font-family:inherit;display:flex;align-items:center;justify-content:center">x</button>
    </div>`;
  }).join('');
}

// 笏笏 蜍慕判霑ｽ蜉繝ｻUI 笏笏
function setXVideo(file) {
  xVideoFile = file;
  // Electron迺ｰ蠅・〒縺ｯFile繧ｪ繝悶ず繧ｧ繧ｯ繝医°繧峨Ο繝ｼ繧ｫ繝ｫ繝代せ繧貞叙蠕励〒縺阪ｋ
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
      setFFmpegStatus(`笞 蜍慕判縺・${fmtSec(dur)} 縺ゅｊ縺ｾ縺吶ゅせ繝ｩ繧､繝繝ｼ縺ｧ2蛻・0遘剃ｻ･蜀・↓繝医Μ繝溘Φ繧ｰ縺励※縺上□縺輔＞`);
    } else {
      setFFmpegStatus('');
    }
  };
  wrap.style.display = 'block';

  // 繝峨Ο繝・・繧ｨ繝ｪ繧｢繧壇im
  const drop = document.getElementById('x-img-drop');
  if (drop) { drop.style.opacity = '0.4'; drop.style.pointerEvents = 'none'; }

  // 繝輔ぃ繧､繝ｫ蜷搾ｼ句炎髯､繝懊ち繝ｳ繧偵・繝ｬ繝薙Η繝ｼ繧ｨ繝ｪ繧｢縺ｫ陦ｨ遉ｺ
  const preview = document.getElementById('x-img-preview');
  if (preview) {
    preview.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:5px 9px;background:var(--bg3);border-radius:6px;font-size:11px;color:var(--text2);width:100%">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file.name)}</span>
      <button onclick="removeXVideo()" style="padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:10px;font-family:inherit;flex-shrink:0">蜑企勁</button>
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
    setFFmpegStatus(`笞 繝医Μ繝蠕後・髟ｷ縺輔′ ${fmtSec(trimDur)} 縺ｧ縺吶・蛻・0遘抵ｼ・40遘抵ｼ我ｻ･蜀・↓縺励※縺上□縺輔＞`);
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

// 笏笏 繝ｪ繧ｻ繝・ヨ 笏笏
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
  removeXVideo(); // 蜍慕判繧ゅΜ繧ｻ繝・ヨ
}

function updXCC() {
  const n = document.getElementById('x-cta').value.length;
  const el = document.getElementById('x-cct');
  el.textContent = n + ' / 280';
  el.className = 'cc' + (n > 250 ? ' w' : '') + (n > 280 ? ' over' : '');
  // 繝・く繧ｹ繝医′遨ｺ縺ｧ繧ら判蜒上°蜍慕判縺後≠繧後・謚慕ｨｿ蜿ｯ閭ｽ
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
    toast(`${acc?.username || 'X'} 縺ｮ繝帙・繝繧ｫ繝ｩ繝縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ縲ゅき繝ｩ繝霑ｽ蜉縺九ｉ縲後・繝ｼ繝縲阪ｒ霑ｽ蜉縺励※縺上□縺輔＞`);
    return;
  }

  // 蜍慕判縺ｮ髟ｷ縺輔メ繧ｧ繝・け
  if (xVideoFile) {
    const vid = document.getElementById('x-video-preview');
    const duration = vid?.duration || 0;
    const trimEnd = xTrimOut || duration;
    const trimDur = trimEnd - xTrimIn;
    if (trimDur > 140) {
      toast(`蜍慕判縺碁聞縺吶℃縺ｾ縺呻ｼ・{fmtSec(trimDur)}・峨・蛻・0遘剃ｻ･蜀・↓繝医Μ繝溘Φ繧ｰ縺励※縺上□縺輔＞`);
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

async function _doXPostBackground({ wv, acc, postText, postImgs, postVideo, postVideoPath, postTrimIn, postTrimOut }) {
  try {
    // 笊絶武 蜍慕判謚慕ｨｿ 笊絶武
    if (postVideo) {
      const vid = document.getElementById('x-video-preview');
      const duration = vid?.duration || 0;
      const trimEnd = postTrimOut || duration;

      const needsTrim = IS_ELECTRON && postVideoPath &&
        (postTrimIn > 0.5 || (duration > 0 && trimEnd < duration - 0.5));

      let videoDataUrl;

      if (needsTrim) {
        setFFmpegStatus('繝医Μ繝溘Φ繧ｰ荳ｭ窶ｦ');
        const trimmedPath = await window.electronAPI.trimVideo(postVideoPath, postTrimIn, trimEnd);
        setFFmpegStatus('隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ窶ｦ');
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
          // 謚慕ｨｿ谺・ｒ蠑ｷ蛻ｶ陦ｨ遉ｺ縺励※縺九ｉ蜿門ｾ暦ｼ郁ｿ比ｿ｡繝壹・繧ｸ縺ｧCSS縺ｧ髱櫁｡ｨ遉ｺ縺ｫ縺ｪ縺｣縺ｦ縺・ｋ蝣ｴ蜷医・蟇ｾ遲厄ｼ・          document.querySelectorAll('[data-testid="tweetTextarea_0"],[data-testid="tweetButtonInline"],[data-testid="toolBar"],[data-testid="tweetTextarea_0RichTextInputContainer"],[data-testid="tweetTextarea_0_label"]').forEach(el => {
            el.style.setProperty('display','block','important');
          });
          // div:has(>[data-testid="tweetTextarea_0"]) 繧ょｼｷ蛻ｶ陦ｨ遉ｺ
          var ta0 = document.querySelector('[data-testid="tweetTextarea_0"]');
          if (ta0) {
            var p = ta0.parentElement;
            while (p) { p.style.removeProperty('display'); p = p.parentElement; if (p && p.dataset && p.dataset.testid === 'primaryColumn') break; }
          }
          const box = document.querySelector('[data-testid="tweetTextarea_0"]')
                   || document.querySelector('[role="textbox"]');
          if (!box) throw new Error('謚慕ｨｿ谺・′隕九▽縺九ｊ縺ｾ縺帙ｓ');
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
          if (!fileInput) throw new Error('繝輔ぃ繧､繝ｫ蜈･蜉帶ｬ・′隕九▽縺九ｊ縺ｾ縺帙ｓ');
          const transfer = new DataTransfer();
          transfer.items.add(videoFile);
          Object.defineProperty(fileInput, 'files', { value: transfer.files, configurable: true });
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 3000));

          const postBtn = document.querySelector('[data-testid="tweetButton"]')
                       || document.querySelector('[data-testid="tweetButtonInline"]');
          if (!postBtn) throw new Error('騾∽ｿ｡繝懊ち繝ｳ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ');
          let retries = 20;
          while (postBtn.disabled && retries-- > 0) await new Promise(r => setTimeout(r, 500));
          postBtn.click();
          return 'ok';
        })()
      `);

    // 笊絶武 逕ｻ蜒乗兜遞ｿ 笊絶武
    } else {
      const imgPayloads = await Promise.all(postImgs.map(f => new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res({ dataUrl: reader.result, type: f.type, name: f.name });
        reader.onerror = rej;
        reader.readAsDataURL(f);
      })));

      await wv.executeJavaScript(`
        (async () => {
          // 謚慕ｨｿ谺・ｒ蠑ｷ蛻ｶ陦ｨ遉ｺ
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
          if (!box) throw new Error('謚慕ｨｿ谺・′隕九▽縺九ｊ縺ｾ縺帙ｓ');
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
          if (!postBtn) throw new Error('騾∽ｿ｡繝懊ち繝ｳ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ');
          let retries = 15;
          while (postBtn.disabled && retries-- > 0) await new Promise(r => setTimeout(r, 300));
          postBtn.click();
          return 'ok';
        })()
      `);
    }

    toast(`Posted to ${acc?.username || 'X'}`);

    setTimeout(() => {
      const targetPartition = acc?.partition || 'persist:x-0';
      document.querySelectorAll('webview').forEach(el => {
        if (el.partition !== targetPartition) return;
        const id = el.id?.replace('wv-', '');
        if (id) wvReload(id);
      });
    }, 2500);

  } catch (e) {
    toast('X post error: ' + e.message);
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

// 笏笏笏 BLUESKY 逕ｻ蜒乗ｷｻ莉・笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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
  if (remaining <= 0) { toast('逕ｻ蜒上・譛螟ｧ4譫壹∪縺ｧ'); return; }
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
        <input type="text" placeholder="Alt 繝・く繧ｹ繝茨ｼ育判蜒上・隱ｬ譏趣ｼ・ maxlength="1000"
          id="b-alt-${i}"
          style="flex:1;background:transparent;border:none;color:var(--text2);font-size:11px;font-family:inherit;outline:none;min-width:0"
          value="${esc(bImgAlts[i] || '')}"
          oninput="bImgAlts[${i}]=this.value">
        <button onclick="removeBImg(${i})"
          style="width:18px;height:18px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;font-size:10px;padding:0;font-family:inherit;display:flex;align-items:center;justify-content:center;flex-shrink:0">笨・/button>
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

async function doSend() {
  const v = document.getElementById('cta').value.trim();
  if (!v && bImgFiles.length === 0) return;
  if (!state.b) { toast('Bluesky 縺ｫ繝ｭ繧ｰ繧､繝ｳ縺励※縺・∪縺帙ｓ'); return; }

  const btn = document.getElementById('sndb');
  btn.disabled = true; btn.textContent = '騾∽ｿ｡荳ｭ窶ｦ';
  try {
    const replyRef = replyTarget
      ? {
          root:   { uri: replyTarget.rootUri || replyTarget.uri, cid: replyTarget.rootCid || replyTarget.cid },
          parent: { uri: replyTarget.uri, cid: replyTarget.cid }
        }
      : null;

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
        if (!res.ok) throw new Error('Image upload failed');
        const data = await res.json();
        return { alt: bImgAlts[idx] || '', image: data.blob };
      }));
      embed = { $type: 'app.bsky.embed.images', images };
    }

    // 謚慕ｨｿ
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
    toast('Posted to Bluesky');

    // 蜈ｨBluesky timeline繧ｫ繝ｩ繝繧偵Μ繝輔Ξ繝・す繝･
    setTimeout(() => {
      document.querySelectorAll('.col').forEach(col => {
        if (col.dataset.type === 'timeline') {
          const cid = col.id?.replace('col-', '');
          if (cid) silentRefreshBsky(cid, 'timeline', null);
        }
      });
    }, 1000);
  } catch (e) {
    toast(`Post error: ${e.message}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Post';
  }
}

// 笏笏笏 ADD COLUMN MODAL 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
function buildOptGrid() {
  const og = document.getElementById('opt-grid');
  og.innerHTML = '';

  // X: 繧｢繧ｫ繧ｦ繝ｳ繝医＃縺ｨ縺ｫ繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ繧貞・縺代※陦ｨ遉ｺ
  if (state.xs && state.xs.length > 0) {
    state.xs.forEach((acc, idx) => {
      og.innerHTML += `<div style="grid-column:1/-1;font-size:10px;font-weight:600;color:var(--text3);letter-spacing:.06em;margin-top:${idx > 0 ? 10 : 0}px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="display:inline-flex;align-items:center;gap:5px">
          <span style="width:14px;height:14px;border-radius:50%;background:${acc.bg};display:inline-flex;align-items:center;justify-content:center;font-size:7px;color:#000;font-weight:700">${acc.initials}</span>
          X ﾂｷ ${esc(acc.username)}
        </span>
      </div>`;
      og.innerHTML += mkOptX('x-home-new', SVG.x, 'Home', 'x.com/home', idx);
      og.innerHTML += mkOptX('x-notif-new', SVG.bell, 'Notifications', 'x.com/notifications', idx);
      og.innerHTML += mkOptX('x-search-new', SVG.x, 'Search', 'x.com/search', idx);
      og.innerHTML += mkOptX('x-list-new', SVG.x, 'List', 'x.com/i/lists', idx);
      og.innerHTML += mkOptX('x-settings', SVG.gear, 'Settings', 'x.com/settings', idx);
    });
  }

  // Bluesky
  if (state.b) {
    if (state.xs && state.xs.length > 0) {
      og.innerHTML += `<div style="grid-column:1/-1;font-size:10px;font-weight:600;color:var(--text3);letter-spacing:.06em;margin-top:10px;padding:4px 0;border-bottom:1px solid var(--border)">Bluesky ﾂｷ @${state.b.handle}</div>`;
    }
    og.innerHTML += mkOpt('b-timeline-new', SVG.bsky, 'Timeline', 'Real-time feed', false, 'b');
    og.innerHTML += mkOpt('b-notif-new', SVG.bell, 'Notifications', 'Real-time notifications', false, 'b');
    og.innerHTML += mkOpt('b-search-new', SVG.bsky, 'Search', 'Keyword search', false, 'b');
    og.innerHTML += mkOpt('b-discover', SVG.bsky, 'Discover', 'Recommended feed', false, 'b');
    og.innerHTML += mkOpt('b-settings', SVG.gear, 'Bsky Settings', 'bsky.app/settings', false, 'b');
  }
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
function addColFromModal(type, plat, accountIdx) {
  closeOv('addMod');
  extraColN++;
  // X: 繧｢繧ｫ繧ｦ繝ｳ繝・ndex繧棚D縺ｫ蜷ｫ繧√※荳諢上↓縺吶ｋ
  const id = plat === 'x' ? `x${accountIdx}-${type}-${extraColN}` : `${type}-${extraColN}`;

  if (plat === 'x') {
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
      'x-home-new': 'Home',
      'x-notif-new': 'Notifications',
      'x-search-new': 'Search',
      'x-settings': 'Settings',
    };
    const icMap = { 'x-settings': 'ic-s' };
    const iconMap = { 'x-settings': SVG.gear };

    const acc = state.xs?.[accountIdx ?? 0];
    const xPart = acc?.partition || `persist:x-${accountIdx ?? 0}`;
    const accLabel = acc ? ` ﾂｷ ${acc.username}` : '';
    insertWebViewCol({
      id,
      title: titleMap[type] || type,
      sub: `X${accLabel}`,
      url: urlMap[type] || 'https://x.com',
      icCls: icMap[type] || 'ic-x',
      icon: iconMap[type] || SVG.x
    }, null, xPart);
  } else {
    // Bluesky險ｭ螳壹・WebView縺ｧ陦ｨ遉ｺ
    if (type === 'b-settings') {
      insertWebViewCol({ id, title: 'Settings', sub: 'Bluesky', url: 'https://bsky.app/settings', icCls: 'ic-s', icon: SVG.gear }, null, 'persist:bsky');
      return;
    }
    const bskyMap = {
      'b-timeline-new': { title: 'Timeline', type: 'timeline', icCls: 'ic-b', icon: SVG.bsky },
      'b-notif-new': { title: 'Notifications', type: 'notif', icCls: 'ic-n', icon: SVG.bell },
      'b-search-new': { title: 'Search', type: 'search', icCls: 'ic-s', icon: SVG.bsky },
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
  toast('Column added');
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
    <h2 style="margin-bottom:14px">Column settings</h2>
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Auto refresh interval</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      ${[15,30,60,120,300,0].map(s=>`<button onclick="applyInterval('${id}','${colType}','${feedType||'timeline'}','${feedUri||''}',${s*1000})"
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
function applyInterval(id, colType, feedType, feedUri, ms) {
  if (colType === 'wv') setAutoRefreshWv(id, ms);
  else setAutoRefresh(id, ms, feedType, feedUri||null);
  const label = ms===0?'OFF':ms<60000?(ms/1000)+' sec':(ms/60000)+' min';
  toast('Auto refresh: '+label);
  document.getElementById('col-settings-ov')?.remove();
  saveColLayout();
}

function applyColFontSize(id, colType, fs) {
  localStorage.setItem(`col_fs_${id}`, fs);
  if (colType === 'wv') {
    // X縺ｮWebView縺ｫCSS繧呈ｳｨ蜈･
    const wv = document.getElementById(`wv-${id}`);
    if (wv) wv.insertCSS(`* { font-size: ${fs}px !important; }`).catch(() => {});
  } else {
    // Bsky縺ｮfeed縺ｫfont-size繧帝←逕ｨ
    const feed = document.getElementById(`feed-${id}`);
    if (feed) feed.style.fontSize = fs + 'px';
  }
  toast(`譁・ｭ励し繧､繧ｺ: ${fs}px`);
  // 繝繧､繧｢繝ｭ繧ｰ繧呈峩譁ｰ・育樟蝨ｨ驕ｸ謚樔ｸｭ繧貞渚譏・・  document.getElementById('col-settings-ov')?.remove();
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
      @${esc(handle)} 繧偵Α繝･繝ｼ繝・    </div>
    <div onclick="copyHandle('${esc(handle)}')" style="padding:7px 12px;font-size:12px;cursor:pointer;border-radius:5px;color:var(--text1);display:flex;align-items:center;gap:8px"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      繝上Φ繝峨Ν繧偵さ繝斐・
    </div>
  `;
  document.body.appendChild(menu);
  const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
  setTimeout(() => document.addEventListener('click', closeMenu), 50);
}
function addNgUser(handle) {
  const clean = handle.replace(/^@/, '');
  if (!ngData.users.includes(clean)) { ngData.users.push(clean); saveNg(ngData); }
  toast(`@${clean} 繧偵Α繝･繝ｼ繝医＠縺ｾ縺励◆`);
  document.getElementById('post-ctx-menu')?.remove();
  refilterBskyCols(); // 蜊ｳ譎ょ渚譏
}
function copyHandle(handle) {
  navigator.clipboard?.writeText('@' + handle).then(() => toast('繧ｳ繝斐・縺励∪縺励◆'));
  document.getElementById('post-ctx-menu')?.remove();
}

function renderNotifIcons() {
  const el = document.getElementById('sb-notif-icons');
  if (!el) return;
  el.innerHTML = '';

  // X繧｢繧ｫ繧ｦ繝ｳ繝医＃縺ｨ縺ｮ騾夂衍繧｢繧､繧ｳ繝ｳ
  (state.xs || []).forEach((acc, i) => {
    const btn = document.createElement('button');
    btn.className = 'si';
    btn.title = `${acc.username} 縺ｮ騾夂衍`;
    btn.setAttribute('id', `sb-notif-x-${i}`);
    btn.innerHTML = `
      <span style="position:relative;display:flex;align-items:center;justify-content:center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span style="position:absolute;top:-6px;right:-6px;min-width:14px;height:14px;border-radius:7px;background:${acc.bg};color:#000;font-size:7px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 2px;line-height:1">${acc.initials}</span>
      </span>`;
    btn.onclick = () => scrollToNotifCol(`x-notif`, i, acc);
    el.appendChild(btn);
  });

  // Bluesky騾夂衍繧｢繧､繧ｳ繝ｳ
  if (state.b) {
    const unreadCount = notificationRuntime.getUnreadCount();
    const btn = document.createElement('button');
    btn.className = 'si';
    btn.title = 'Bluesky 縺ｮ騾夂衍';
    btn.id = 'sb-notif-b';
    btn.innerHTML = `
      <span style="position:relative;display:flex;align-items:center;justify-content:center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span id="bsky-notif-badge" style="position:absolute;top:-6px;right:-7px;min-width:14px;height:14px;border-radius:7px;background:var(--red);color:#fff;font-size:8px;font-weight:700;display:${unreadCount > 0 ? 'flex' : 'none'};align-items:center;justify-content:center;padding:0 2px;line-height:1">${unreadCount > 99 ? '99+' : unreadCount}</span>
      </span>`;
    btn.onclick = () => scrollToNotifCol('b-notif', -1, null);
    el.appendChild(btn);

    startNotifPoll();
  }
}

function scrollToNotifCol(baseId, xIdx, acc) {
  const cols = document.getElementById('cols');

  let targetCol = null;
  if (xIdx >= 0 && acc) {
    cols.querySelectorAll('.col').forEach(col => {
      const wv = col.querySelector('webview');
      if (wv && wv.partition === acc.partition && wv.src?.includes('/notifications')) {
        targetCol = col;
      }
    });
  } else {
    // Bluesky騾夂衍
    targetCol = document.getElementById(`col-${baseId}`);
  }

  if (targetCol) {
    // 譌｢蟄倥き繝ｩ繝縺ｫ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ
    targetCol.scrollIntoView({ behavior: 'smooth', inline: 'start' });
    targetCol.style.outline = '2px solid var(--accent)';
    setTimeout(() => { targetCol.style.outline = ''; }, 1200);
  } else {
    // 繧ｫ繝ｩ繝縺後↑縺代ｌ縺ｰ霑ｽ蜉
    if (xIdx >= 0 && acc) {
      extraColN++;
      const id = `x${xIdx}-x-notif-new-${extraColN}`;
      insertWebViewCol({
        id, title: 'Notifications', sub: `X - ${acc.username}`,
        url: 'https://x.com/notifications',
        icCls: 'ic-n', icon: SVG.bell
      }, null, acc.partition);
      setTimeout(() => {
        const newCol = document.getElementById(`col-${id}`);
        if (newCol) newCol.scrollIntoView({ behavior: 'smooth', inline: 'start' });
      }, 300);
      saveColLayout();
      toast(`${acc.username} notifications column added`);
    } else {
      // Bluesky騾夂衍繧ｫ繝ｩ繝繧定ｿｽ蜉
      insertBskyCol({ id: 'b-notif', title: 'Notifications', sub: 'Bluesky', type: 'notif', icCls: 'ic-n', icon: SVG.bell });
      setTimeout(() => {
        const newCol = document.getElementById('col-b-notif');
        if (newCol) newCol.scrollIntoView({ behavior: 'smooth', inline: 'start' });
      }, 300);
      saveColLayout();
      toast('Bluesky notifications column added');
    }
  }
}

// Bluesky譛ｪ隱ｭ騾夂衍謨ｰ繧偵・繝ｼ繝ｪ繝ｳ繧ｰ
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

// 笏笏笏 SCROLL TO START 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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
  toast('Refreshing all feeds...');
}

// 笏笏笏 UTILS 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
// 笏笏笏 NOTIF SHORTCUTS & SCROLL 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

function goToNotifCol(plat, xIdx) {
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
        id, title: 'Notifications', sub: `X - ${acc.username}`,
        url: 'https://x.com/notifications', icCls: 'ic-n', icon: SVG.bell
      }, null, xPart);
      targetCol = document.getElementById(`col-${id}`);
      saveColLayout(); // 竊・霑ｽ蜉
      toast(`${acc.username} notifications column added`);
    }
  } else {
    document.querySelectorAll('.col').forEach(col => {
      const feed = col.querySelector('.feed');
      if (feed && feed.id && feed.id.includes('notif')) targetCol = col;
    });
    if (!targetCol) {
      const id = 'b-notif-auto';
      insertBskyCol({ id, title: 'Notifications', sub: 'Bluesky', type: 'notif', icCls: 'ic-n', icon: SVG.bell });
      targetCol = document.getElementById(`col-${id}`);
      saveColLayout(); // 竊・霑ｽ蜉
      toast('Bluesky notifications column added');
    }
  }

  // 繧ｫ繝ｩ繝縺ｫ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ
  if (targetCol) {
    targetCol.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    // 荳迸ｬ繝上う繝ｩ繧､繝・    targetCol.style.outline = '2px solid var(--accent)';
    setTimeout(() => { targetCol.style.outline = ''; }, 1200);
  }
}

// Bluesky譛ｪ隱ｭ騾夂衍謨ｰ繧貞叙蠕励＠縺ｦ繝舌ャ繧ｸ譖ｴ譁ｰ
async function fetchBskyUnreadCount() {
  if (!state.b) return;
  try {
    notificationRuntime.setUnreadCount(await fetchBskyUnread());
  } catch {}
}

// Bluesky騾夂衍繧呈里隱ｭ蛹悶＠縺ｦ繝舌ャ繧ｸ繧呈ｶ医☆
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

// 笏笏笏 MEMORY MANAGEMENT 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

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
  // 謨ｰ蟄励・縺ｿ縺ｧ縺ｪ縺代ｌ縺ｰ繧ｨ繝ｩ繝ｼ
  if (!/^[0-9]+$/.test(listId)) { toast('Enter a valid list URL or ID'); return; }

  const url = `https://x.com/i/lists/${listId}`;
  const title = nameInput || `List ${listId}`;
  const acc = state.xs?.[accountIdx ?? 0];
  const xPart = acc?.partition || `persist:x-${accountIdx ?? 0}`;
  const accLabel = acc ? ` - ${acc.username}` : '';

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
  toast('List column added');
  saveColLayout();
}

function openAddMod() { buildOptGrid(); document.getElementById('addMod').classList.add('on'); }
// 笏笏笏 MENTION SUGGEST 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
let _mentionTimer = null;
let _mentionLastQ = '';

async function onCompTextareaInput(e) {
  updCC();
  const ta = e.target;
  const val = ta.value;
  const pos = ta.selectionStart;

  // 繧ｫ繝ｼ繧ｽ繝ｫ蜑阪・ @word 繧呈､懷・
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

      // 繝懊ャ繧ｯ繧ｹ菴懈・ or 蜀榊茜逕ｨ
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

// 笏笏笏 繧｢繝励Μ蜀・Γ繝九Η繝ｼ 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

// 笏笏笏 KEYBOARD SHORTCUTS 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

if (IS_ELECTRON) {
  window.electronAPI.on('add-column', () => openAddMod());
  window.electronAPI.on('refresh-all', () => refreshAll());
  window.electronAPI.on('scroll-left', () => { document.getElementById('cols').scrollBy({ left: -400, behavior: 'smooth' }); });
  window.electronAPI.on('scroll-right', () => { document.getElementById('cols').scrollBy({ left: 400, behavior: 'smooth' }); });

  window.addEventListener('resize', () => {
    const btn = document.getElementById('win-max-btn');
    if (!btn) return;
    const isMax = window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight;
    btn.innerHTML = isMax
      ? `<svg viewBox="0 0 10 10" width="10" height="10"><path d="M2 0h8v8M0 2h8v8" fill="none" stroke="currentColor" stroke-width="1"/></svg>`
      : `<svg viewBox="0 0 10 10" width="10" height="10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
  });
}

// 笏笏笏 DRAG & DROP 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

    // 繝峨Ο繝・・蜈医→菴咲ｽｮ繧偵せ繝ｯ繝・・
    const cols2 = [...cols.querySelectorAll('.col')];
    const srcIdx = cols2.indexOf(dragSrc);
    const tgtIdx = cols2.indexOf(target);
    if (srcIdx < tgtIdx) {
      target.insertAdjacentElement('afterend', dragSrc);
    } else {
      cols.insertBefore(dragSrc, target);
    }
    dragSrc.style.opacity = '';
    toast('繧ｫ繝ｩ繝繧堤ｧｻ蜍輔＠縺ｾ縺励◆');
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

// 笏笏笏 COLUMN RESIZE 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
function addResizeHandle(col) {
  if (col.querySelector('.col-resize')) return;
  const handle = document.createElement('div');
  handle.className = 'col-resize';
  handle.title = '繝峨Λ繝・げ縺ｧ蟷・ｒ螟画峩';
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

// 笏笏笏 INIT 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
state = stateStore.load();
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
  initWvPreloadPath().finally(() => {
    enterApp();
    if (state.b) {
      setTimeout(() => fetchBskyUnreadCount(), 3000);
      setInterval(() => fetchBskyUnreadCount(), 5 * 60 * 1000);
    }
    setTimeout(() => document.querySelectorAll('#cols .col').forEach(makeDraggable), 300);
  });
}

// 笏笏笏 VISIBILITY-BASED REFRESH THROTTLE 笏笏笏笏笏笏笏笏笏笏
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 繝舌ャ繧ｯ繧ｰ繝ｩ繧ｦ繝ｳ繝・ 蜈ｨ繧ｿ繧､繝槭・繧剃ｸ譎ょ●豁｢
    refreshScheduler.clearAll();
    notificationRuntime.stopPoll();
    memoryCleaner.stop();
  } else {
    // 繝輔か繧｢繧ｰ繝ｩ繧ｦ繝ｳ繝牙ｾｩ蟶ｰ: 繧ｿ繧､繝槭・繧貞・髢九・縺ｿ・亥叉譎よ峩譁ｰ縺ｯ縺励↑縺・ｼ・    // ShareX遲峨・繧ｭ繝｣繝励メ繝｣繝・・繝ｫ縺後ヵ繧ｩ繝ｼ繧ｫ繧ｹ繧剃ｸ迸ｬ螂ｪ縺・→隱､逋ｺ轣ｫ縺吶ｋ縺溘ａ
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
    if (state.b) startNotifPoll();
    startMemoryCleaner();
  }
});

startMemoryCleaner();

// 笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊絶武笊・//  WIDGET MODE 窶・繝・せ繧ｯ繝医ャ繝裕L繧ｦ繧｣繧ｸ繧ｧ繝・ヨ
const IS_WIDGET = new URLSearchParams(location.search).get('widget') === '1';

if (IS_WIDGET) {
  initWidgetMode();
}

async function initWidgetMode() {
  document.body.classList.add('widget-mode');

  // 繧ｦ繧｣繧ｸ繧ｧ繝・ヨ逕ｨ繧ｹ繧ｿ繧､繝ｫ繧呈ｳｨ蜈･
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
    /* 繝峨Λ繝・げ繝上Φ繝峨Ν繝舌・ */
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

  // 繝峨Λ繝・げ繝上Φ繝峨Ν繝舌・繧呈諺蜈･
  const bar = document.createElement('div');
  bar.id = 'widget-bar';

  let colOptions = '';
  try {
    const fullLayout = columnRuntime.readStoredLayout();
    const selId = columnRuntime.getWidgetColumnId() || fullLayout[0]?.id;
    colOptions = fullLayout.map(c =>
      `<option value="${c.id}" ${c.id === selId ? 'selected' : ''}>${(c.title || c.id)}${c.sub ? ' ﾂｷ ' + c.sub : ''}</option>`
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
