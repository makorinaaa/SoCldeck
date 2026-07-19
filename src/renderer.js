// ═══════════════════════════════════════════════
//  SOCIALDECK — renderer.js
//  Bluesky AT Protocol + X WebView
// ═══════════════════════════════════════════════
const IS_ELECTRON = typeof window.electronAPI !== 'undefined';
const composeMedia = window.SocialDeckComposeMedia;
const xComposeMediaDraft = composeMedia.createMediaDraft({
  supportsVideo: true,
  resolveFilePath: file => IS_ELECTRON
    ? window.electronAPI?.getPathForFile?.(file) || null
    : null,
});
const bskyComposeMediaDraft = composeMedia.createMediaDraft({
  supportsVideo: true,
  videoMimeTypes: ['video/mp4'],
  resolveFilePath: file => IS_ELECTRON
    ? window.electronAPI?.getPathForFile?.(file) || null
    : null,
});
const composeRequests = window.SocialDeckComposeRequest;
const composeCrossPostPlan = window.SocialDeckComposeCrossPostPlan;
const xComposePreparation = window.SocialDeckXComposePreparation;
const xPostConfirmation = window.SocialDeckXPostConfirmation;
const notificationCenter = window.SocialDeckNotificationCenter;
const E2E_FIXTURES = window.electronAPI?.e2eFixtures || null;
let xWebViewRuntime;
let bskyColumnsRuntime;
let notificationCenterRuntime;
let composeModalRuntime;
let accountSessionRuntime;
let desktopNotificationRuntime;
let delegatedActionRuntime;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const bskyRichText = window.SocialDeckBskyRichText.createBskyRichText();
const buildFacets = bskyRichText.buildFacets;
const bskyGateway = window.SocialDeckBlueskyGatewayAdapter.createBlueskyGatewayAdapter({
  invoke: (operation, payload) => window.electronAPI.invokeBluesky(operation, payload),
  login: credentials => window.electronAPI.loginBluesky(credentials),
  clearSession: () => window.electronAPI.clearBlueskySession(),
});

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
    const response = await bskyGateway.uploadBlob({
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return response.blob;
  },
  uploadVideo: async video => {
    if (!video.sourcePath) throw new Error('動画ファイルのパスを取得できませんでした');
    const response = await bskyGateway.uploadVideo({
      filePath: video.sourcePath,
      name: video.file?.name || 'video.mp4',
      startSeconds: video.trim.startSeconds,
      endSeconds: video.trim.endSeconds,
      durationSeconds: video.durationSeconds,
    });
    return response.blob;
  },
  buildFacets,
  resolveFacets: facets => resolveMentionDids(facets),
  createRecord: ({ record }) => bskyGateway.createPostRecord({ record }),
});
const networkAdapters = window.SocialDeckNetworkAdapters.createNetworkAdapterRegistry({
  icons: SVG,
  composeExecutors: { x: xComposeExecutor, b: bskyComposeExecutor },
});
const columnShellRuntime = window.SocialDeckColumnShellRuntime.createColumnShellRuntime({
  documentRef: document,
  container: document.getElementById('cols'),
  onCollapseChange: () => columnLifecycle.persist(),
  onWidthChange: () => columnLifecycle.persist(),
  onIntent: ({ type, id, kind, columnType, target }) => {
    if (type === 'refresh') return refreshColumn(id, target);
    if (type === 'remove') return removeCol(id);
    if (type === 'back') return wvBack(id);
    if (type === 'settings') return settingsModals.openColumnSettings(id, columnType);
    if (type === 'scroll-top' && kind === 'x') return wvScrollTop(id);
    if (type === 'scroll-top' && kind === 'bsky') return bskyScrollTop(id);
    if (type === 'scroll-top' && kind === 'schedule') return animeScheduleScrollTop(id);
  },
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
  applyWidth: (id, width) => columnShellRuntime.applyWidth(id, width),
  applyCollapsed: id => columnShellRuntime.setCollapsed(id, true),
  reportRestoreError: insertColumnRestoreError,
  cleanupRuntimeState: id => {
    bskyColumnsRuntime?.dispose(id);
    xWebViewRuntime?.disposeColumn(id);
    animeScheduleRuntime.dispose(id);
    localStorage.removeItem(`col_fs_${id}`);
  },
  listElementIds: () => columnShellRuntime.listIds(),
  removeElement: id => columnShellRuntime.remove(id),
  persistWorkspace: saveColLayout,
  onRefreshStateChange: (id, state) => columnShellRuntime.setRefreshState(id, state),
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
    isCollapsed: id => columnShellRuntime.isCollapsed(id),
  });
  columnRuntime.writeStoredLayout(layout);
}

function loadColLayout() {
  return columnRuntime.getLayoutForCurrentMode();
}

function insertColumnPlan(plan) {
  if (plan?.kind === 'wv') {
    mountWebViewColumn(plan.config, null, plan.partition);
    return true;
  }
  if (plan?.kind === 'bsky') {
    mountBlueskyColumn(plan.config);
    return true;
  }
  if (plan?.kind === 'schedule') {
    mountAnimeScheduleColumn(plan.config);
    return true;
  }
  return false;
}

function insertColumnRestoreError(col, error) {
  const { hosts } = columnShellRuntime.mount({
    id: col.id,
    title: col.title || 'Column restore failed',
    subtitle: 'Workspace State was preserved',
    interactiveHeader: false,
    actions: ['remove'],
    hosts: [{ name: 'content', className: 'feed-empty' }],
  });
  hosts.content.textContent = error.message || 'Column Definition could not be resolved';
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
const blueskySessionRuntime = window.SocialDeckBlueskySessionRuntime.createBlueskySessionRuntime({
  vault: {
    load: () => IS_ELECTRON && window.electronAPI?.loadBlueskySession
      ? window.electronAPI.loadBlueskySession()
      : Promise.resolve(null),
    store: credentials => IS_ELECTRON && window.electronAPI?.storeBlueskySession
      ? window.electronAPI.storeBlueskySession(credentials)
      : Promise.resolve(credentials),
    clear: () => IS_ELECTRON && window.electronAPI?.clearBlueskySession
      ? window.electronAPI.clearBlueskySession()
      : Promise.resolve(true),
  },
});
let state = {
  xs: [],
  activeX: 0,
  b: null,
  composePreferences: { crossPostFromX: false, crossPostFromBluesky: false },
  appearance: { theme: 'dark', accent: '#4e9af0' },
};
const appearanceRuntime = window.SocialDeckAppearanceRuntime.createAppearanceRuntime({
  root: document.documentElement,
  persist: appearance => {
    state.appearance = appearance;
    saveState();
  },
});
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
  getMemoryMetrics: IS_ELECTRON ? () => window.electronAPI?.getMemoryMetrics?.() : null,
  getRuntimeMetrics: () => {
    const bluesky = bskyColumnsRuntime?.getMemoryStats?.() || {};
    const x = xWebViewRuntime?.getMemoryStats?.() || {};
    return {
      blueskyColumns: bluesky.columnCount || 0,
      blueskyItems: bluesky.renderedItemCount || 0,
      xColumnWebViews: x.columnWebViewCount || 0,
      xNotificationReaders: x.notificationReaderCount || 0,
    };
  },
  trimRuntime: () => {
    const blueskyItemsRemoved = bskyColumnsRuntime?.trimAll?.() || 0;
    const desktopNotificationsEnabled = desktopNotificationRuntime
      ?.getSnapshot?.().rules.enabled === true;
    const xNotificationReadersDisposed = desktopNotificationsEnabled
      ? 0
      : xWebViewRuntime?.disposeNotificationReaders?.() || 0;
    return { blueskyItemsRemoved, xNotificationReadersDisposed };
  },
});
const settingsModals = window.SocialDeckSettingsModalsRuntime.createSettingsModalsRuntime({
  documentRef: document,
  storage: localStorage,
  muteRules,
  appearance: appearanceRuntime,
  memoryCleaner,
  columns: {
    getRefreshInterval: id => columnLifecycle.getRefreshInterval(id, DEFAULT_INTERVAL_MS),
    setRefreshInterval: (id, ms) => columnLifecycle.setRefreshInterval(id, ms),
    persistLayout: () => columnLifecycle.persist(),
    setFontSize: (id, colType, fontSize) => {
      if (colType === 'wv') {
        xWebViewRuntime.setFontSize(id, fontSize);
      } else {
        const feed = document.getElementById(`feed-${id}`);
        if (feed) feed.style.fontSize = fontSize + 'px';
      }
    },
  },
  ui: { escape: esc },
  intents: {
    toast: message => toast(message),
    refilterColumns: () => refilterBskyCols(),
  },
});
const fileDragShield = window.SocialDeckFileDragShield.createFileDragShield({
  getIsColumnDragging: () => Boolean(dragSrc),
});
const notificationRuntime = window.SocialDeckNotificationRuntime.createNotificationRuntime();
const xLoginGate = window.SocialDeckXLoginGate.createXLoginGate();
const composeModalView = window.SocialDeckComposeModalRuntime.createComposeModalDomView({
  documentRef: document,
  ui: { escape: esc, formatSeconds: fmtSec },
  maxVideoSeconds: { x: composeMedia.MAX_VIDEO_SECONDS, b: 180 },
});
composeModalRuntime = window.SocialDeckComposeModalRuntime.createComposeModalRuntime({
  getAccounts: () => ({ x: state.xs || [], b: state.b }),
  getPreferences: () => state.composePreferences || {},
  mediaDrafts: { x: xComposeMediaDraft, b: bskyComposeMediaDraft },
  coordinator: composeCoordinator,
  view: composeModalView,
  intents: {
    submit: networkId => composeSubmission.submit(networkId),
    closed: networkId => {
      if (networkId === 'b') replyTarget = null;
    },
    toast,
    updatePreference: (name, value) => {
      state.composePreferences = { ...(state.composePreferences || {}), [name]: value };
      saveState();
    },
    onBlueskyTextInput: onCompTextareaInput,
  },
});
const composeSubmission = window.SocialDeckComposeSubmission.createComposeSubmission({
  modalRuntime: {
    getSnapshot: networkId => composeModalRuntime.getSnapshot(networkId),
    setBusy: (networkId, busy, label, options) => composeModalRuntime.setBusy(networkId, busy, label, options),
    close: networkId => composeModalRuntime.close(networkId),
  },
  coordinator: composeCoordinator,
  createRequest: composeRequests.createComposeRequest,
  adapters: networkAdapters,
  createCrossPostPlan: composeCrossPostPlan.createCrossPostPlan,
  mediaDrafts: { x: xComposeMediaDraft, b: bskyComposeMediaDraft },
  executeXDelivery: (delivery, context) => executeXComposeDelivery(delivery, context),
  getBlueskyAccount: () => state.b,
  getReplyTarget: () => replyTarget,
  maxVideoSeconds: { x: composeMedia.MAX_VIDEO_SECONDS, b: 180 },
  formatSeconds: fmtSec,
  ui: {
    toast,
    confirm: message => confirm(message),
    clearTrimStatus: () => setFFmpegStatus(''),
  },
});
const authenticatedBskyAdapter = bskyGateway;
bskyColumnsRuntime = window.SocialDeckBlueskyColumnsRuntime.createBlueskyColumnsRuntime({
  adapter: authenticatedBskyAdapter,
  muteRules,
  ui: { formatText, relTime, renderAvatar },
  icons: { reply: SVG.reply, repost: SVG.rt, heart: SVG.heart, bell: SVG.bell, follow: SVG.follow },
  documentRef: document,
  intents: {
    reply: ({ uri, cid, handle }) => openReply(uri, cid, handle),
    quote: ({ uri, cid, handle }) => openQuoteModal(uri, cid, handle),
    openImages: ({ urls, startIndex }) => openImg(urls, startIndex),
    openProfile: ({ did, handle }) => showProfile(did || handle),
    openPostMenu: ({ handle, x, y }) => showPostMenu({ handle, x, y }),
    clearNotificationUnread: () => notificationRuntime.clearUnread(),
    activateNotification: ({ authorDid, authorHandle, targetUri }) => {
      if (targetUri) {
        bskyColumnsRuntime.openPost({ uri: targetUri, handle: authorHandle });
      } else {
        showProfile(authorDid);
      }
    },
  },
  onOutcome: outcome => {
    if (outcome.kind === 'like') {
      toast(outcome.status === 'failed'
        ? `エラー: ${outcome.error?.message || 'いいねできませんでした'}`
        : outcome.active ? 'いいねしました' : 'いいねを取り消しました');
    } else if (outcome.kind === 'repost') {
      toast(outcome.status === 'failed'
        ? `エラー: ${outcome.error?.message || 'リポストできませんでした'}`
        : outcome.active ? 'リポストしました' : 'リポストを取り消しました');
    } else if (outcome.kind === 'follow') {
      toast(outcome.status === 'failed'
        ? `エラー: ${outcome.error?.message || 'フォローを更新できませんでした'}`
        : outcome.active ? `@${outcome.handle} をフォローしました` : `@${outcome.handle} のフォローを解除しました`);
    } else if (outcome.kind === 'refresh' && outcome.status === 'failed') {
      toast(`更新エラー: ${outcome.error?.message || '更新できませんでした'}`);
    }
  },
});


function saveState() { stateStore.save(state); }

async function initializeBlueskySession() {
  try {
    const result = await blueskySessionRuntime.initialize(state.b);
    state = { ...state, b: result.account };
    if (['migrated', 'missing', 'mismatch'].includes(result.status)) saveState();
    return result;
  } catch (error) {
    console.error('Bluesky Session Vault initialization failed:', error);
    state = { ...state, b: null };
    saveState();
    return { status: 'failed', account: null, error };
  }
}

// ─── AUTH ──────────────────────────────────────
function switchTab(t) {
  document.querySelectorAll('.ltab').forEach(el => el.classList.remove('active'));
  document.querySelector(`.ltab.${t === 'x' ? 'xt' : 'bt'}`).classList.add('active');
  document.querySelectorAll('.lpanel').forEach(el => el.classList.remove('active'));
  document.getElementById(`panel-${t}`).classList.add('active');
}

function enterApp() {
  if (enterAppPending) return enterAppPending;
  enterAppPending = webviewPreloadReady
    .catch(error => console.error('WebView preload could not be initialized:', error))
    .then(() => {
      document.getElementById('login-screen').classList.add('hidden');
      const app = document.getElementById('app');
      app.style.display = 'flex';
      renderApp();
    })
    .finally(() => { enterAppPending = null; });
  return enterAppPending;
}

function openLoginScreen() {
  closeAmenu();
  accountSessionRuntime.openSettings();
}

// ─── APP RENDER ────────────────────────────────
function renderApp() {
  xWebViewRuntime.syncAccounts(state.xs || []);
  accountSessionRuntime.refresh();
  renderDefaultCols();
  renderCompUI();
  buildOptGrid();
}
function closeAmenu() { document.getElementById('amenu').classList.remove('open'); }
document.addEventListener('click', e => { if (!e.target.closest('.sb')) closeAmenu(); });

// ─── DEFAULT COLUMNS ────────────────────────────
let colIdSeq = 0;

// X画像ライトボックス用WebViewプリロードパス
// enterApp前に確定させてカラム生成時に確実に使えるようにする
let wvPreloadPath = '';
let webviewPreloadReady = Promise.resolve();
let enterAppPending = null;
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
  getPreloadPath: () => wvPreloadPath,
  allowDevTools: window.electronAPI?.devToolsEnabled === true,
  openImage: openImg,
});
const notificationCenterView = window.SocialDeckNotificationCenterRuntime.createNotificationCenterDomView({
  documentRef: document,
  ui: {
    escape: esc,
    renderAvatar,
    relativeTime: relTime,
    avatarBackground: avBgFor,
  },
});
notificationCenterRuntime = window.SocialDeckNotificationCenterRuntime.createNotificationCenterRuntime({
  model: notificationCenter,
  getSession: () => ({
    bluesky: Boolean(state.b),
    xAccounts: state.xs || [],
  }),
  sources: {
    listBluesky: async () => {
      if (E2E_FIXTURES && E2E_FIXTURES.useNotificationReaders !== true) {
        return E2E_FIXTURES.blueskyNotifications || [];
      }
      const data = await authenticatedBskyAdapter.listNotifications({ limit: 80 });
      return data.notifications || [];
    },
    listX: async (account, accountIndex) => {
      if (!IS_ELECTRON) return [];
      if (E2E_FIXTURES && E2E_FIXTURES.useNotificationReaders !== true) {
        return (E2E_FIXTURES.xNotifications || []).filter(item =>
          (Number(item.accountIndex) || 0) === accountIndex
        );
      }
      return xWebViewRuntime.listNotifications({
        accountId: account.username || account.partition || `persist:x-${accountIndex}`,
        host: document.getElementById('notif-center-x-readers'),
        script: notificationCenter.buildXNotificationExtractionScript(40),
        retainReader: desktopNotificationRuntime?.getSnapshot().rules.enabled === true,
      });
    },
    markBlueskySeen: seenAt => authenticatedBskyAdapter.markNotificationsSeen({ seenAt }),
  },
  view: notificationCenterView,
  intents: {
    close: () => closeOv('notifCenterMod'),
    openXAccountNotifications: ({ accountIndex }) => goToNotifCol('x', accountIndex),
    openXNotification: item => openXNotificationCenterItem(item),
    openBlueskyPost: item => {
      const handle = ['like', 'repost'].includes(item.reason) ? state.b?.handle : item.author?.handle;
      return bskyColumnsRuntime.openPost({
        uri: item.targetUri,
        handle: handle || state.b?.handle || 'post',
      });
    },
    openBlueskyProfile: item => showProfile(item.author.did),
    clearUnread: () => notificationRuntime.clearUnread(),
    toast,
  },
});
const desktopNotificationView = window.SocialDeckDesktopNotificationRuntime.createDesktopNotificationDomView({
  documentRef: document,
});
desktopNotificationRuntime = window.SocialDeckDesktopNotificationRuntime.createDesktopNotificationRuntime({
  storage: localStorage,
  fetchItems: async () => {
    await notificationCenterRuntime.reload();
    return notificationCenterRuntime.getAllItems();
  },
  showNotification: payload => window.electronAPI?.showDesktopNotification?.(payload) ?? false,
  isAppFocused: () => document.hasFocus(),
  subscribeActivation: handler => window.electronAPI?.onDesktopNotificationActivated?.(handler) || (() => {}),
  view: desktopNotificationView,
  intents: {
    saved: rules => {
      if (!rules.enabled) xWebViewRuntime.disposeNotificationReaders();
      toast(rules.enabled
        ? 'デスクトップ通知を有効にしました'
        : 'デスクトップ通知を無効にしました');
    },
    activate: item => {
      if (item.networkId === 'x') return openXNotificationCenterItem(item);
      if (item.targetUri) {
        const handle = ['like', 'repost'].includes(item.reason)
          ? state.b?.handle
          : item.author?.handle;
        return bskyColumnsRuntime.openPost({
          uri: item.targetUri,
          handle: handle || state.b?.handle || 'post',
        });
      }
      if (item.author?.did) return showProfile(item.author.did);
      return null;
    },
  },
});
const accountSessionView = window.SocialDeckAccountSessionRuntime.createAccountSessionDomView({
  documentRef: document,
  escape: esc,
});
accountSessionRuntime = window.SocialDeckAccountSessionRuntime.createAccountSessionRuntime({
  state: {
    get: () => state,
    commit: nextState => {
      state = nextState;
      saveState();
      return state;
    },
  },
  xSession: {
    initializeTheme: partition => IS_ELECTRON
      ? window.electronAPI?.initializeXSessionTheme?.(partition)
      : Promise.resolve(false),
    clear: partition => IS_ELECTRON
      ? window.electronAPI?.clearXSession?.(partition)
      : Promise.resolve(false),
    clearAll: () => IS_ELECTRON
      ? window.electronAPI?.clearAllXSessions?.()
      : Promise.resolve(false),
    sync: accounts => {
      xWebViewRuntime.syncAccounts(accounts);
      if (!IS_ELECTRON || !window.electronAPI?.syncXNetworkAccounts) {
        return Promise.resolve([]);
      }
      const partitions = accounts.map(account => account.partition).filter(Boolean);
      return window.electronAPI.syncXNetworkAccounts(partitions);
    },
  },
  bluesky: {
    login: (handle, password) => bskyGateway.login(handle, password),
    clearSession: () => bskyGateway.clearSession(),
  },
  getAvatarBackground: index => AVBG[index % AVBG.length],
  getBlueskyBackground: avBgFor,
  createDefaultState: window.SocialDeckStateStore.defaultState,
  view: accountSessionView,
  intents: {
    confirmLogout: account => confirm(`Log out ${account.username}?`),
    confirmLogoutAll: () => confirm('Log out all accounts?'),
    enterRequested: () => enterApp(),
    workspaceResetRequested: async () => {
      columnLifecycle.clear({ removeElements: true });
      document.getElementById('notif-center-x-readers')?.replaceChildren();
      await notificationCenterRuntime.reload();
      columnRuntime.clearStoredLayout();
      closeAmenu();
      notificationRuntime.stopPoll();
      notificationRuntime.clearUnread();
      document.getElementById('cols').innerHTML = addColBtnHTML();
      document.getElementById('app').style.display = 'none';
    },
    accountsChanged: ({ network, kind, account }) => {
      desktopNotificationRuntime.rebaseline().catch(() => {});
      if (network === 'all') {
        accountSessionRuntime.openSettings();
        toast('All accounts logged out');
        return;
      }
      const app = document.getElementById('app');
      const appIsOpen = app.style.display && app.style.display !== 'none';
      if (kind === 'login' && !appIsOpen) enterApp();
      else if (appIsOpen) renderApp();
      if (network === 'x') {
        toast(kind === 'login' ? `${account.username} added` : 'X account removed');
      } else {
        toast(kind === 'login' ? `@${account.handle} logged in` : 'Bluesky logged out');
      }
    },
  },
});

async function silentRefreshBsky(cid, type, feedUri) {
  if (!state.b) return { status: 'deferred', detail: 'account-unavailable' };
  const feedEl = document.getElementById(`feed-${cid}`);
  if (!feedEl) return { status: 'deferred', detail: 'column-unavailable' };
  if (feedEl.querySelector('.feed-loading')) return { status: 'deferred', detail: 'loading' };
  if (!['timeline', 'feed', 'notif'].includes(type)) {
    return { status: 'deferred', detail: 'unsupported-column-type' };
  }
  return bskyColumnsRuntime.refresh(cid, { mode: 'prepend' });
}

function addColBtnHTML() {
  return `<button class="add-col-btn" data-action="open-add-column"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>追加</button>`;
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
function mountWebViewColumn(columnConfig, before = null, partition = 'persist:x') {
  const { root, hosts } = columnShellRuntime.mount({
    id: columnConfig.id,
    kind: 'x',
    network: columnConfig.network,
    definitionId: columnConfig.definitionId,
    title: columnConfig.title,
    subtitle: columnConfig.sub,
    iconClass: columnConfig.icCls,
    icon: columnConfig.icon,
    indicatorColor: '#e7e9ea',
    actions: ['collapse', 'back', 'refresh', { type: 'settings', columnType: 'wv' }, 'remove'],
    hosts: [{
      name: 'content',
      className: 'col-webview',
      style: { position: 'relative' },
    }],
    before,
  });
  const loading = document.createElement('div');
  loading.className = 'webview-loading';
  loading.id = `wvload-${columnConfig.id}`;
  loading.innerHTML = '<div class="spinner"></div>読み込み中…';
  const overlay = document.createElement('div');
  overlay.id = `wvov-${columnConfig.id}`;
  Object.assign(overlay.style, {
    display: 'none',
    position: 'absolute',
    inset: '0',
    zIndex: '10',
    pointerEvents: 'none',
    opacity: '1',
    transition: 'opacity .4s ease',
  });
  hosts.content.appendChild(loading);
  hosts.content.appendChild(overlay);
  xWebViewRuntime.mountColumn({
    id: columnConfig.id,
    networkId: columnConfig.network || 'x',
    partition,
    targetUrl: columnConfig.url,
    host: hosts.content,
    preloadPath: wvPreloadPath,
  });
  return root;
}


function getXNotificationColumnUrl(id) {
  const column = document.getElementById(`col-${id}`);
  if (column?.dataset.definitionId !== 'x-notif-new') return null;
  return networkAdapters.getColumnDefinition('x', 'x-notif-new')?.defaultParams?.url
    || 'https://x.com/notifications';
}

function wvBack(id) {
  return xWebViewRuntime.back(id);
}

function openFirstXWebViewDevTools() {
  if (!xWebViewRuntime.openDevTools()) toast('X WebView not found');
}

// カラムヘッダークリックで先頭へスクロール
// カラムヘッダークリックで先頭へ（元のURLに戻してリロード）
function wvScrollTop(id) {
  // 折りたたみ中はシングルクリックでも展開
  if (columnShellRuntime.isCollapsed(id)) return columnShellRuntime.toggleCollapsed(id);

  const col = document.getElementById(`col-${id}`);
  if (!col) return false;

  const layout = loadColLayout();
  const saved = layout.find(c => c.id === id);
  return xWebViewRuntime.navigateToStart(id, saved?.url);
}

function bskyScrollTop(cid) {
  // 折りたたみ中はシングルクリックでも展開
  if (columnShellRuntime.isCollapsed(cid)) { columnShellRuntime.toggleCollapsed(cid); return; }
  const feedEl = document.getElementById(`feed-${cid}`);
  if (feedEl) feedEl.scrollTo({ top: 0, behavior: 'smooth' });
}

function animeScheduleScrollTop(cid) {
  if (columnShellRuntime.isCollapsed(cid)) { columnShellRuntime.toggleCollapsed(cid); return; }
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
function mountBlueskyColumn(columnConfig, before = null) {
  const columnId = columnConfig.id || `b-${++colIdSeq}`;
  const hasSearch = columnConfig.type === 'search';
  const hostDefinitions = [];
  if (hasSearch) hostDefinitions.push({ name: 'search', className: 'col-search-bar' });
  hostDefinitions.push({
    name: 'content',
    id: `feed-${columnId}`,
    className: 'feed',
    loadingText: '読み込み中…',
  });
  const { root, hosts, badge } = columnShellRuntime.mount({
    id: columnId,
    kind: 'bsky',
    network: columnConfig.network,
    definitionId: columnConfig.definitionId,
    metadata: {
      type: columnConfig.type || 'timeline',
      feeduri: columnConfig.feedUri || '',
    },
    title: columnConfig.title,
    subtitle: columnConfig.sub,
    iconClass: columnConfig.icCls,
    icon: columnConfig.icon,
    badge: true,
    actions: ['refresh', 'collapse', { type: 'settings', columnType: 'bsky' }, 'remove'],
    hosts: hostDefinitions,
    before,
  });

  let searchInput = null;
  let searchButton = null;
  if (hasSearch) {
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = `sq-${columnId}`;
    searchInput.placeholder = 'Bluesky を検索…';
    searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.id = `sq-btn-${columnId}`;
    searchButton.textContent = '検索';
    hosts.search.appendChild(searchInput);
    hosts.search.appendChild(searchButton);
  }

  // 自動ロードとデフォルト自動更新開始
  if (columnConfig.type === 'timeline' || columnConfig.type === 'feed' || columnConfig.type === 'notif' || hasSearch) {
    bskyColumnsRuntime.mount({
      id: columnId,
      type: columnConfig.type,
      feedUri: columnConfig.feedUri || null,
      host: hosts.content,
      badge,
      searchInput,
      searchButton,
    });
    if (!hasSearch) {
      bskyColumnsRuntime.refresh(columnId, { mode: 'replace' }).catch(() => {});
      columnLifecycle.setRefreshInterval(columnId, DEFAULT_INTERVAL_MS);
    } else {
      hosts.content.innerHTML = '<div class="feed-empty">検索キーワードを入力してください</div>';
    }
  } else if (!hasSearch) {
    loadBskyFeed(columnId, columnConfig.type, columnConfig.feedUri);
    columnLifecycle.setRefreshInterval(columnId, DEFAULT_INTERVAL_MS);
  }
  // フォントサイズ設定を復元
  const savedFs = parseInt(localStorage.getItem(`col_fs_${columnId}`));
  if (savedFs) hosts.content.style.fontSize = savedFs + 'px';
  return root;
}

function mountAnimeScheduleColumn(columnConfig, before = null) {
  const columnId = columnConfig.id;
  const { root, hosts } = columnShellRuntime.mount({
    id: columnId,
    kind: 'schedule',
    network: columnConfig.network,
    definitionId: columnConfig.definitionId,
    title: columnConfig.title,
    subtitle: columnConfig.sub,
    subtitleId: `anime-sub-${columnId}`,
    iconClass: columnConfig.icCls,
    icon: columnConfig.icon,
    indicatorColor: '#ffd166',
    actions: ['refresh', 'collapse', { type: 'settings', columnType: 'schedule' }, 'remove'],
    hosts: [{
      name: 'content',
      id: `feed-${columnId}`,
      className: 'feed anime-schedule',
      loadingText: '放送予定を取得中…',
    }],
    before,
  });
  columnLifecycle.setRefreshInterval(columnId, ANIME_REFRESH_INTERVAL_MS);
  animeScheduleRuntime.load(columnId).catch(() => {});

  const savedFs = parseInt(localStorage.getItem(`col_fs_${columnId}`));
  if (savedFs) hosts.content.style.fontSize = savedFs + 'px';
  return root;
}

async function loadBskyFeed(cid, type, feedUri = null, append = false) {
  if (!state.b) return;
  if (!['timeline', 'feed', 'notif'].includes(type)) {
    return { status: 'deferred', detail: 'unsupported-column-type' };
  }
  return bskyColumnsRuntime.refresh(cid, { mode: append ? 'append' : 'replace' });
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
        <button data-action="close-quote"
          style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:2px 6px">✕</button>
      </div>
      <!-- 引用元プレビュー -->
      <div style="border:1px solid var(--border2);border-radius:8px;padding:9px 11px;margin-bottom:12px;font-size:12px;color:var(--text2)">
        <div style="font-weight:700;color:var(--text2);margin-bottom:3px">@${esc(handle)} の投稿を引用</div>
        <div style="color:var(--text3);font-size:11px">${esc(uri.split('/').pop())}</div>
      </div>
      <div class="comp-wrap">
        <div class="comp-av" style="background:${avBg};position:relative;overflow:hidden">${avInner}</div>
        <textarea class="comp-ta" id="quote-ta" placeholder="コメントを追加…" maxlength="300" data-input-action="update-quote-count"></textarea>
      </div>
      <div class="comp-foot">
        <span class="cc" id="quote-cct">0 / 300</span>
        <button class="send-btn" id="quote-sndb" data-action="submit-quote">引用して投稿</button>
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
    const resolvedFacets = text ? await resolveMentionDids(rawFacets) : [];
    const record = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
      embed: { $type: 'app.bsky.embed.record', record: { uri: quoteTarget.uri, cid: quoteTarget.cid } }
    };
    if (resolvedFacets.length) record.facets = resolvedFacets;
    await authenticatedBskyAdapter.createPostRecord({ record });
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

let replyTarget = null; // { uri, cid, rootUri, rootCid }

async function openReply(uri, cid, handle) {
  replyTarget = { uri, cid, rootUri: uri, rootCid: cid, handle };

  openComp();
  setTimeout(() => document.getElementById('cta')?.focus(), 50);

  if (state.b) {
    try {
      const thread = await authenticatedBskyAdapter.getThread({ uri, depth: 40 });
      let node = thread?.thread;
      while (node?.parent) node = node.parent;
      if (node?.post?.uri && replyTarget?.uri === uri) {
        replyTarget.rootUri = node.post.uri;
        replyTarget.rootCid = node.post.cid;
      }
    } catch {}
  }
}

function showProfile(actor) {
  if (!actor) return;
  openBskyProfileCol(actor);
}

function openBskyProfileCol(actor) {
  const url = `https://bsky.app/profile/${actor}`;

  const existingCol = notificationCenter.findBlueskyProfileColumn(
    document.querySelectorAll('.col')
  );
  if (existingCol) {
    const cid = existingCol.id?.replace('col-', '');
    if (cid && columnShellRuntime.isCollapsed(cid)) columnShellRuntime.toggleCollapsed(cid);
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
  composeModalRuntime.open('b', { reply: replyTarget });
  setTimeout(() => document.getElementById('cta')?.focus(), 50);
}

function openXPost() {
  composeModalRuntime.open('x');
  setTimeout(() => document.getElementById('x-cta')?.focus(), 50);
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

function executeXComposeDelivery(delivery, context = {}) {
  return xWebViewRuntime.executeCompose(
    delivery,
    context,
    (preparedDelivery, preparedContext) =>
      networkAdapters.executeComposeDelivery(preparedDelivery, preparedContext),
  );
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

async function resolveMentionDids(facets) {
  return bskyRichText.resolveMentionDids(facets, async handle => {
    const res = await authenticatedBskyAdapter.resolveHandle({ handle });
    return res.did;
  });
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
  return `<button class="opt" data-action="add-column" data-definition-id="${esc(type)}" data-network="x" data-account-index="${accountIdx}">
    <div style="width:16px;height:16px;margin-bottom:5px">${icon}</div>
    <div class="oname">${name}</div>
    <div class="odesc">${desc}</div>
  </button>`;
}

function mkOpt(id, icon, name, desc, disabled, plat) {
  return `<button class="opt${disabled ? ' disabled' : ''}" data-action="add-column" data-definition-id="${esc(id)}" data-network="${esc(plat)}"${disabled ? ' disabled' : ''}>
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

function showPostMenu({ handle, x, y }) {
  document.getElementById('post-ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'post-ctx-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:4px;z-index:500;min-width:160px;box-shadow:0 4px 20px rgba(0,0,0,.5)`;
  menu.innerHTML = `
    <div data-action="add-ng-user" data-handle="${esc(handle)}" style="padding:7px 12px;font-size:12px;cursor:pointer;border-radius:5px;color:var(--text1);display:flex;align-items:center;gap:8px"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
      @${esc(handle)} をミュート
    </div>
    <div data-action="copy-handle" data-handle="${esc(handle)}" style="padding:7px 12px;font-size:12px;cursor:pointer;border-radius:5px;color:var(--text1);display:flex;align-items:center;gap:8px"
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
  btn.onclick = () => notificationCenterRuntime.open();
  el.appendChild(btn);

  if (state.b) startNotifPoll();
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

// Bluesky未読通知数をポーリング
function startNotifPoll() {
  notificationRuntime.startPoll(fetchBskyUnread);
}

async function fetchBskyUnread() {
  if (!state.b) return 0;
  const data = await authenticatedBskyAdapter.getUnreadCount();
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

// ─── MEMORY MANAGEMENT ──────────────────────────

function startMemoryCleaner() {
  memoryCleaner.start();
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
          data-keydown-action="confirm-x-list" data-action-key="Enter" data-account-index="${accountIdx}">
      </div>
      <div class="lf" style="margin-bottom:16px">
        <label>Column name (optional)</label>
        <input type="text" id="x-list-name" placeholder="My list"
          style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;font-size:13px;color:var(--text1);font-family:inherit;outline:none"
          data-keydown-action="confirm-x-list" data-action-key="Enter" data-account-index="${accountIdx}">
      </div>
      <div style="display:flex;gap:8px">
        <button data-action="remove-element" data-target-id="x-list-dialog-ov" class="btn-cancel" style="flex:1">Cancel</button>
        <button data-action="confirm-x-list" data-account-index="${accountIdx}" style="flex:1;padding:9px;border-radius:7px;background:var(--accent);border:none;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">Add</button>
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
      const data = await authenticatedBskyAdapter.searchActors({ query: q, limit: 6 });
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
        return `<div data-action="insert-mention" data-handle="${esc(a.handle)}"
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
  ta.dispatchEvent(new Event('input', { bubbles: true }));
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

function setComposeBusy(modalId, buttonId, busy, busyLabel = '送信中…') {
  const networkId = modalId === 'xPostMod' ? 'x' : 'b';
  composeModalRuntime.setBusy(networkId, busy, busy ? busyLabel : null);
}

function closeOv(id, e) {
  if (id === 'xPostMod' || id === 'compMod') {
    if (!e || e.target.classList.contains('ov')) {
      composeModalRuntime.close(id === 'xPostMod' ? 'x' : 'b');
    }
    return;
  }
  if (!e || e.target.classList.contains('ov')) {
    document.getElementById(id).classList.remove('on');
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

function createUiActionHandlers() {
  const integer = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isInteger(number) ? number : fallback;
  };
  const removeElement = id => document.getElementById(id)?.remove();
  return {
    'switch-tab': ({ dataset }) => switchTab(dataset.network),
    'toggle-app-menu': ({ dataset, event }) => toggleAmDrop(dataset.targetId, event),
    'open-login': () => openLoginScreen(),
    'open-about': () => openAbout(),
    'close-app': () => window.electronAPI?.close(),
    'open-add-column': () => openAddMod(),
    'refresh-all': () => refreshAll(),
    'zoom-in': () => window.electronAPI?.zoomIn(),
    'zoom-out': () => window.electronAPI?.zoomOut(),
    'zoom-reset': () => window.electronAPI?.zoomReset(),
    'open-widget': () => window.electronAPI?.openWidget(),
    'toggle-fullscreen': () => window.electronAPI?.toggleFullscreen(),
    'open-devtools': () => window.electronAPI?.openDevTools(),
    'open-x-devtools': () => openFirstXWebViewDevTools(),
    'minimize-window': () => window.electronAPI?.minimize(),
    'maximize-window': () => window.electronAPI?.maximize(),
    'scroll-columns-start': () => scrollColsToStart(),
    'scroll-start': () => scrollToStart(),
    'open-x-post': () => openXPost(),
    'open-b-post': () => openComp(),
    'open-ng-settings': () => settingsModals.openNgSettings(),
    'open-memory-settings': () => settingsModals.openMemorySettings(),
    'open-appearance-settings': () => settingsModals.openAppearanceSettings(),
    'preview-appearance-theme': ({ dataset }) => settingsModals.previewAppearance({ theme: dataset.theme }),
    'preview-appearance-accent': ({ dataset }) => settingsModals.previewAppearance({ accent: dataset.accent }),
    'preview-appearance-custom': ({ value }) => settingsModals.previewAppearance({ accent: value }),
    'cancel-appearance': ({ event, target }) => settingsModals.cancelAppearance(event, target),
    'save-appearance': () => settingsModals.saveAppearance(),
    'close-overlay': ({ dataset, event, target }) => (
      closeOv(dataset.overlayId, target.classList.contains('ov') ? event : undefined)
    ),
    'check-updates': () => checkForUpdates(),
    'install-update': () => installUpdate(),
    'close-lightbox': ({ event }) => lbClose(event),
    'move-lightbox': ({ dataset }) => lbMove(integer(dataset.direction)),
    'remove-ng-rule': ({ dataset }) => settingsModals.removeNgRule(dataset.ruleKind, integer(dataset.ruleIndex)),
    'add-ng-rule': ({ dataset }) => settingsModals.addNgRule(dataset.ruleKind),
    'remove-element': ({ dataset }) => removeElement(dataset.targetId),
    'close-quote': () => {
      removeElement('quote-modal-ov');
      quoteTarget = null;
    },
    'update-quote-count': () => updQuoteCC(),
    'submit-quote': () => doQuotePost(),
    'add-column': ({ dataset }) => addColFromModal(
      dataset.definitionId,
      dataset.network,
      dataset.accountIndex === undefined ? undefined : integer(dataset.accountIndex),
    ),
    'apply-column-interval': ({ dataset }) => settingsModals.applyColumnInterval(
      dataset.columnId,
      integer(dataset.intervalMs),
    ),
    'apply-column-font-size': ({ dataset }) => settingsModals.applyColumnFontSize(
      dataset.columnId,
      dataset.columnType,
      integer(dataset.fontSize, 13),
    ),
    'add-ng-user': ({ dataset }) => addNgUser(dataset.handle),
    'copy-handle': ({ dataset }) => copyHandle(dataset.handle),
    'apply-memory-interval': ({ dataset }) => settingsModals.applyMemoryInterval(integer(dataset.intervalMs)),
    'clear-memory-now': () => {
      settingsModals.clearMemoryNow(true);
    },
    'refresh-memory-metrics': () => settingsModals.refreshMemoryMetrics(),
    'confirm-x-list': ({ dataset }) => confirmXList(integer(dataset.accountIndex)),
    'insert-mention': ({ dataset }) => insertMention(dataset.handle),
    'widget-select-column': ({ value }) => wgSelectCol(value),
    'widget-set-opacity': ({ value }) => window.electronAPI?.widgetSetOpacity(Number(value) / 100),
    'widget-toggle-top': () => wgToggleTop(),
    'widget-close': () => window.electronAPI?.closeWidget(),
  };
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
    const buttonId = document.querySelector('.ltab.xt.active') ? 'x-login-btn' : 'b-login-btn';
    document.getElementById(buttonId)?.click();
  }
  if (e.key === 'Escape') {
    if (document.getElementById('appearanceMod')?.classList.contains('on')) {
      appearanceRuntime.cancel();
    }
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
        if (btn && !btn.disabled) composeSubmission.submit('x');
      } else if (bMod?.classList.contains('on')) {
        const btn = document.getElementById('sndb');
        if (btn && !btn.disabled) composeSubmission.submit('b');
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
    const head = e.target.closest('[data-column-drag-handle]');
    const interactive = e.target.closest('button,a,input,textarea,select,[contenteditable="true"],.feed,.post,.notif,.col-webview,[data-column-resize-handle]');
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

// ─── INIT ───────────────────────────────────────
delegatedActionRuntime = window.SocialDeckDelegatedActionRuntime.createDelegatedActionRuntime({
  root: document,
  actions: createUiActionHandlers(),
});
if (!window.electronAPI?.devToolsEnabled) {
  document.querySelectorAll('.dev-only').forEach(element => element.remove());
}
state = E2E_FIXTURES?.state ? structuredClone(E2E_FIXTURES.state) : stateStore.load();
state.appearance = appearanceRuntime.apply(state.appearance);
if (state.x && !(state.xs && state.xs.length > 0)) {
  state.xs = [{ ...state.x, partition: 'persist:x-0' }];
  state.activeX = 0;
  delete state.x;
  saveState();
}
webviewPreloadReady = initWvPreloadPath();
const blueskySessionReady = initializeBlueskySession();
const accountSessionReady = blueskySessionReady.then(() => accountSessionRuntime.start());
accountSessionReady.then(() => desktopNotificationRuntime.start()).catch(() => {});
initDnD();

const hasStoredAccounts = (state.xs && state.xs.length > 0) || state.b;
if (hasStoredAccounts) {
  Promise.all([accountSessionReady, webviewPreloadReady, initializeXLoginStates()]).finally(() => {
    if ((state.xs && state.xs.length > 0) || state.b) enterApp();
    if (state.b) {
      setTimeout(() => fetchBskyUnreadCount(), 3000);
      setInterval(() => fetchBskyUnreadCount(), 5 * 60 * 1000);
    }
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
      <select id="wg-col-select" data-change-action="widget-select-column"
        style="-webkit-app-region:no-drag;background:var(--bg3);border:1px solid var(--border);border-radius:5px;color:var(--text2);font-size:10px;font-family:inherit;padding:2px 4px;max-width:150px">
        ${colOptions}
      </select>
    </div>
    <input type="range" min="30" max="100" value="100" title="Opacity" id="wg-opacity"
      data-input-action="widget-set-opacity">
    <button id="wg-top-btn" title="Always on top" data-action="widget-toggle-top">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>
    </button>
    <button title="Close" data-action="widget-close">
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
