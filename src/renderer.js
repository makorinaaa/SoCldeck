import { createAppShellRuntime } from './renderer/app-shell-runtime.mjs';
import { createKeyboardNavigation } from './renderer/keyboard-navigation.mjs';
import { icons as SVG } from './renderer/icons.mjs';
import { createAppInfoRuntime } from './renderer/app-info-runtime.mjs';
import { createPostMenuRuntime } from './renderer/post-menu-runtime.mjs';
import { createXListDialogRuntime } from './renderer/x-list-dialog-runtime.mjs';
import { createSubmissionScript } from './renderer/x-composer-submit.mjs';
import { createXAccounts, isSameXAccount, xPartitionOf } from './renderer/x-accounts.mjs';
import { createXNotificationLoader } from './renderer/x-notification-loader.mjs';
import { createColumnMounts } from './renderer/column-mounts.mjs';
import { readReplyPreview } from './renderer/reply-preview.mjs';
import {
  createXAutomationConsent,
  createXAutomationSetting,
  needsXAutomationDecision,
} from './renderer/x-automation-consent.mjs';
import {
  blueskyPostFacts,
  createColumnFilterStore,
  describeColumnFilter,
  matchesColumnFilter,
  xPostFacts,
} from './renderer/column-filters.mjs';
import { measurePost } from './renderer/post-length.mjs';
import {
  SocialDeckAccountSessionRuntime,
  SocialDeckAnimeScheduleRuntime,
  SocialDeckAppearanceRuntime,
  SocialDeckBackupSettingsRuntime,
  SocialDeckBlueskyColumnsRuntime,
  SocialDeckBlueskyGatewayAdapter,
  SocialDeckBlueskySessionRuntime,
  SocialDeckBskyComposeDelivery,
  SocialDeckBskyRichText,
  SocialDeckColumnLifecycle,
  SocialDeckColumnPicker,
  SocialDeckColumnReorderRuntime,
  SocialDeckColumnRuntime,
  SocialDeckColumnShellRuntime,
  SocialDeckColumnUndo,
  SocialDeckComposeAttempt,
  SocialDeckComposeCompletion,
  SocialDeckComposeCoordinator,
  SocialDeckComposeCrossPostPlan,
  SocialDeckComposeMedia,
  SocialDeckComposeMentionSuggest,
  SocialDeckComposeModalRuntime,
  SocialDeckComposeModalView,
  SocialDeckComposeQuote,
  SocialDeckComposeRequest,
  SocialDeckComposeSubmission,
  SocialDeckCrossPostRuntime,
  SocialDeckDelegatedActionRuntime,
  SocialDeckDesktopNotificationRuntime,
  SocialDeckFileDragShield,
  SocialDeckLightboxRuntime,
  SocialDeckMemoryCleaner,
  SocialDeckMuteRules,
  SocialDeckNetworkAdapters,
  SocialDeckNotificationCenter,
  SocialDeckNotificationCenterRuntime,
  SocialDeckNotificationReply,
  SocialDeckNotificationRuntime,
  SocialDeckRefreshScheduler,
  SocialDeckReplyNotifications,
  SocialDeckSettingsModalsRuntime,
  SocialDeckStateStore,
  SocialDeckUiUtils,
  SocialDeckWidgetModeRuntime,
  SocialDeckWorkspaceBackup,
  SocialDeckWorkspaceStorage,
  SocialDeckXComposeDelivery,
  SocialDeckXComposePreparation,
  SocialDeckXLoginGate,
  SocialDeckXNativeTimelineRuntime,
  SocialDeckXNotificationCapture,
  SocialDeckXPostConfirmation,
  SocialDeckXPostView,
  SocialDeckXStatusActions,
  SocialDeckXStatusRuntime,
  SocialDeckXTimelineRefresh,
  SocialDeckXWebViewRuntime
} from './renderer/legacy-runtime-modules.mjs';

// ═══════════════════════════════════════════════
//  SOCIALDECK — renderer.js
//  Bluesky AT Protocol + X WebView
// ═══════════════════════════════════════════════
const IS_ELECTRON = typeof window.electronAPI !== 'undefined';
const workspaceStorage = SocialDeckWorkspaceStorage.createWorkspaceStorage({
  onRecovery: message => {
    document.getElementById('workspace-recovery-message').textContent = message;
    document.getElementById('workspace-recovery').hidden = false;
  },
});
const composeMedia = SocialDeckComposeMedia;
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
const composeRequests = SocialDeckComposeRequest;
const composeCrossPostPlan = SocialDeckComposeCrossPostPlan;
const xComposePreparation = SocialDeckXComposePreparation;
const xPostConfirmation = SocialDeckXPostConfirmation;
const notificationCenter = SocialDeckNotificationCenter;
const E2E_FIXTURES = window.electronAPI?.e2eFixtures || null;
// X の自動化機能（画面外の X ページのデータの読み取りと、スクリプトでのボタン操作）は、
// 利用者が同意したときだけ作る。同意を変えたらアプリを読み込み直して反映する
const xAutomationSetting = createXAutomationSetting({ storage: localStorage, fallback: E2E_FIXTURES?.xAutomation ?? null });
const X_AUTOMATION_ENABLED = xAutomationSetting.isEnabled();
const xAutomationConsent = createXAutomationConsent({
  documentRef: document,
  getDecision: () => xAutomationSetting.get(),
});
const X_AUTOMATION_OFF_HTML = `<div class="feed-empty">X の自動化機能を使わない設定のため、ネイティブ版カラムは表示しません。<br>
  <button type="button" class="chip-btn" data-action="open-x-automation-consent">X の自動化機能について</button></div>`;

function isXColumn(id) {
  return columnShellRuntime.getRoot(id)?.dataset.network === 'x';
}
let xWebViewRuntime;
let bskyColumnsRuntime;
let notificationCenterRuntime;
let composeModalRuntime;
let accountSessionRuntime;
let desktopNotificationRuntime;
let delegatedActionRuntime;
let appShellRuntime;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const bskyRichText = SocialDeckBskyRichText.createBskyRichText();
const buildFacets = bskyRichText.buildFacets;
const bskyGateway = SocialDeckBlueskyGatewayAdapter.createBlueskyGatewayAdapter({
  invoke: (operation, payload) => window.electronAPI.invokeBluesky(operation, payload),
  login: credentials => window.electronAPI.loginBluesky(credentials),
  clearSession: () => window.electronAPI.clearBlueskySession(),
});



// ─── COLUMN PERSISTENCE ──────────────────────────
const columnRuntime = SocialDeckColumnRuntime.createColumnRuntime({ storage: workspaceStorage });
const COL_KEY = columnRuntime.layoutKey;
const animeScheduleRuntime = SocialDeckAnimeScheduleRuntime.createAnimeScheduleRuntime({
  documentRef: document,
  fetchSchedule: force => window.electronAPI?.getAnimeSchedule
    ? window.electronAPI.getAnimeSchedule(force)
    : Promise.reject(new Error('Anime schedule API is unavailable')),
});
const xComposeExecutor = SocialDeckXComposeDelivery.createXComposeDelivery({
  createSubmissionScript,
  createPreparationScript: () => xComposePreparation.createPreparationScript(),
  createConfirmationScript: options => xPostConfirmation.createConfirmationScript(options),
  readFileAsDataUrl,
  trimVideo: window.electronAPI?.trimVideo,
  readFileBase64: window.electronAPI?.readFileBase64,
  deleteTempFile: window.electronAPI?.deleteTempFile,
  setStatus: setFFmpegStatus,
});
const bskyComposeExecutor = SocialDeckBskyComposeDelivery.createBlueskyComposeDelivery({
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
  createRecord: ({ record, rkey }) => bskyGateway.createPostRecord({ record, rkey }),
});
const networkAdapters = SocialDeckNetworkAdapters.createNetworkAdapterRegistry({
  icons: SVG,
  composeExecutors: { x: xComposeExecutor, b: bskyComposeExecutor },
});
// カラムごとの表示フィルター（全体ミュートとは別）
const columnFilters = createColumnFilterStore({ storage: localStorage });

// 使えるのは投稿を自前で描くカラム（Bluesky のタイムライン・フィード・検索、ネイティブ版 X のホーム・リスト）
function supportsColumnFilter(id) {
  const root = columnShellRuntime.getRoot(id);
  if (!root) return false;
  if (root.dataset.network === 'b') return ['timeline', 'feed', 'search'].includes(root.dataset.type);
  return ['x-home-native', 'x-list-native'].includes(root.dataset.definitionId);
}

function setColumnFilter(id, filter) {
  columnFilters.set(id, filter);
  columnShellRuntime.update(id, { filterLabel: describeColumnFilter(columnFilters.get(id)) });
  const root = columnShellRuntime.getRoot(id);
  if (root?.dataset.network === 'b') {
    const reload = root.dataset.type === 'search'
      ? bskyColumnsRuntime.search(id)
      : bskyColumnsRuntime.refresh(id, { mode: 'replace' });
    Promise.resolve(reload).catch(() => {});
  } else {
    xNativeTimelineRuntime?.rerenderAll();
  }
}

const columnShellRuntime = SocialDeckColumnShellRuntime.createColumnShellRuntime({
  documentRef: document,
  container: document.getElementById('cols'),
  describeFilter: id => describeColumnFilter(columnFilters.get(id)),
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
    if (type === 'scroll-top' && kind === 'x-native') return xNativeScrollTop(id);
  },
});
const columnLifecycle = SocialDeckColumnLifecycle.createColumnLifecycle({
  createPlan: request => networkAdapters.createColumnPlan(request),
  insertPlan: plan => columnMounts.insertPlan(plan),
  // 同意していなければ X カラムは自動更新しない（手動の更新はページの再読み込みだけ）
  scheduleRefresh: (id, interval, callback) => (X_AUTOMATION_ENABLED || !isXColumn(id)
    ? refreshScheduler.set(id, interval, callback)
    : refreshScheduler.remove(id)),
  clearRefreshSchedule: id => refreshScheduler.remove(id),
  executeRefresh: (id, plan, context) => networkAdapters.executeColumnRefresh(id, plan, {
    refreshXNavigation: (id, destination) => (X_AUTOMATION_ENABLED
      ? xWebViewRuntime.refreshNavigation(id, destination)
      : 'automation-disabled'),
    reloadWebView: id => xWebViewRuntime.reload(id, { silent: true }),
    loadWebViewUrl: (id, url) => xWebViewRuntime.navigateToStart(id, url),
    refreshBlueskyFeed: silentRefreshBsky,
    refreshAnimeSchedule: id => animeScheduleRuntime.load(id, { force: context?.force === true }),
    refreshXNativeTimeline: id => xNativeTimelineRuntime
      ? xNativeTimelineRuntime.refresh(id, { force: context?.force === true, reload: context?.force === true })
      : { status: 'deferred', detail: 'unavailable' },
    refreshXNativeNotifications: id => xNativeTimelineRuntime
      ? xNativeTimelineRuntime.refreshNotifications(id, { force: context?.force === true })
      : { status: 'deferred', detail: 'unavailable' },
  }),
  applyWidth: (id, width) => columnShellRuntime.applyWidth(id, width),
  applyCollapsed: id => columnShellRuntime.setCollapsed(id, true),
  reportRestoreError: (column, error) => columnMounts.mountRestoreError(column, error),
  cleanupRuntimeState: id => {
    bskyColumnsRuntime?.dispose(id);
    xWebViewRuntime?.disposeColumn(id);
    animeScheduleRuntime.dispose(id);
    xNativeTimelineRuntime?.dispose(id);
    columnRuntime.removeFontSize(id);
    columnFilters.remove(id);
  },
  listElementIds: () => columnShellRuntime.listIds(),
  removeElement: id => columnShellRuntime.remove(id),
  persistWorkspace: saveColLayout,
  onRefreshStateChange: (id, state) => columnShellRuntime.setRefreshState(id, state),
});
const composeCompletion = SocialDeckComposeCompletion.createComposeCompletionRuntime({
  notify: toast,
  refresh: refreshAfterCompose,
  onRefreshError: error => console.warn('Compose refresh failed:', error),
});
const composeCoordinator = SocialDeckComposeCoordinator.createComposeCoordinator({
  createAttemptRuntime: SocialDeckComposeAttempt.createComposeAttemptRuntime,
  createCrossPostRuntime: SocialDeckCrossPostRuntime.createCrossPostRuntime,
  complete: plan => composeCompletion.complete(plan),
});

function saveColLayout() {
  if (columnRuntime.isWidgetMode()) return;
  const cols = document.getElementById('cols');
  if (!cols) return;
  const layout = columnRuntime.captureLayout(cols.querySelectorAll('.col'), {
    resolveDefinition: storedColumn => networkAdapters.resolveColumnDefinition(storedColumn),
    getInterval: id => columnLifecycle.getRefreshInterval(id, DEFAULT_INTERVAL_MS),
    isCollapsed: id => columnShellRuntime.isCollapsed(id),
  });
  columnRuntime.writeStoredLayout(layout);
}

// ウィジェットのタブとしてカラムを1つ追加で開く。ログイン前なら読み直して全体を組み直す
function mountWidgetColumn(columnId) {
  const column = columnRuntime.readStoredLayout().find(item => item.id === columnId);
  const [active] = column
    ? columnRuntime.filterLayoutForAccounts([{ ...column, collapsed: false, width: '' }], { bluesky: Boolean(state.b) })
    : [];
  if (!active || (!state.b && !(state.xs || []).length)) {
    location.reload();
    return;
  }
  columnLifecycle.restore([active]);
}

function unmountWidgetColumn(columnId) {
  columnLifecycle.remove(columnId);
}

function setColumnFontSize(columnId, fontSize) {
  columnRuntime.setFontSize(columnId, fontSize);
  if (!xWebViewRuntime.setFontSize(columnId, fontSize)) columnMounts.applyFontSize(columnId, 'feed', fontSize);
}

function loadColLayout() {
  return columnRuntime.getLayoutForCurrentMode();
}

function restoreColLayout() {
  const layout = loadColLayout();
  const activeLayout = columnRuntime.filterLayoutForAccounts(layout, {
    bluesky: Boolean(state.b),
  });
  if (!activeLayout.length) return false;

  columnLifecycle.restore(activeLayout, {
    persistNormalized: columnRuntime.isWidgetMode() || activeLayout.length !== layout.length
      ? undefined
      : normalized => columnRuntime.writeStoredLayout(normalized),
  });
  return true;
}

// ─── NG WORD / MUTE ──────────────────────────────
const muteRules = SocialDeckMuteRules.createMuteRules();

// NGルール変更時に全Bskyカラムを再読み込みして即時反映
function refilterBskyCols() {
  document.querySelectorAll('.col').forEach(col => {
    const cid = col.id?.replace('col-', '');
    const type = col.dataset?.type;
    if (cid && type) {
      silentRefreshBsky(cid, type, col.dataset.feeduri || null);
    }
  });
  xNativeTimelineRuntime?.rerenderAll();
}

// ─── STATE ────────────────────────────────────
const MEM_KEY = 'socialdeck_mem_interval'; // メモリクリア間隔設定キー
// state.xs: Xアカウントの配列 [{username, initials, bg, partition}]
// state.activeX: アクティブなXアカウントのindex
// state.b: Blueskyアカウント（単一）
const stateStore = SocialDeckStateStore.createStateStore(workspaceStorage);
const blueskySessionRuntime = SocialDeckBlueskySessionRuntime.createBlueskySessionRuntime({
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
let state = SocialDeckStateStore.defaultState();
const appearanceRuntime = SocialDeckAppearanceRuntime.createAppearanceRuntime({
  root: document.documentElement,
  persist: appearance => {
    state.appearance = appearance;
    saveState();
  },
});
const AVBG = ['linear-gradient(135deg,#4e9af0,#6a5cf0)', 'linear-gradient(135deg,#e05c7a,#9a5cf0)', 'linear-gradient(135deg,#3dc98a,#4e9af0)', 'linear-gradient(135deg,#f5c842,#e05c7a)', 'linear-gradient(135deg,#9a5cf0,#e05c7a)', 'linear-gradient(135deg,#4e9af0,#3dc98a)', 'linear-gradient(135deg,#e05c7a,#f5c842)', 'linear-gradient(135deg,#3dc98a,#6a5cf0)'];
const uiUtils = SocialDeckUiUtils.createUiUtils({
  avatarBackgrounds: AVBG,
  bskyIcon: SVG.bsky,
});
const { esc, relTime, avBgFor, renderAvatar, formatText } = uiUtils;
const lightboxRuntime = SocialDeckLightboxRuntime.createLightboxRuntime();
const memoryCleaner = SocialDeckMemoryCleaner.createMemoryCleaner({
  key: MEM_KEY,
  clearMemory: IS_ELECTRON ? () => window.electronAPI?.clearMemory?.() : null,
  getMemoryMetrics: IS_ELECTRON ? () => window.electronAPI?.getMemoryMetrics?.() : null,
  getRuntimeMetrics: () => {
    const bluesky = bskyColumnsRuntime?.getMemoryStats?.() || {};
    const x = xWebViewRuntime?.getMemoryStats?.() || {};
    const xNative = xNativeTimelineRuntime?.getMemoryStats?.() || {};
    return {
      blueskyColumns: bluesky.columnCount || 0,
      blueskyItems: bluesky.renderedItemCount || 0,
      xColumnWebViews: x.columnWebViewCount || 0,
      xNotificationReaders: x.notificationReaderCount || 0,
      xNativeReaders: xNative.readers || 0,
      xNativeStatusReaders: xNative.statusReaders || 0,
      xNativePosts: xNative.posts || 0,
    };
  },
  trimRuntime: () => {
    const blueskyItemsRemoved = bskyColumnsRuntime?.trimAll?.() || 0;
    const desktopNotificationsEnabled = desktopNotificationRuntime
      ?.getSnapshot?.().rules.enabled === true;
    const xNotificationReadersDisposed = desktopNotificationsEnabled
      ? 0
      : xWebViewRuntime?.disposeNotificationReaders?.() || 0;
    const xNative = xNativeTimelineRuntime?.trim?.() || {};
    return {
      blueskyItemsRemoved,
      xNotificationReadersDisposed,
      xNativeReadersReloaded: xNative.readersReloaded || 0,
      xNativeStatusReadersDisposed: xNative.statusReadersDisposed || 0,
    };
  },
});
const settingsModals = SocialDeckSettingsModalsRuntime.createSettingsModalsRuntime({
  documentRef: document,
  muteRules,
  appearance: appearanceRuntime,
  memoryCleaner,
  columns: {
    getRefreshInterval: id => columnLifecycle.getRefreshInterval(id, DEFAULT_INTERVAL_MS),
    setRefreshInterval: (id, ms) => columnLifecycle.setRefreshInterval(id, ms),
    persistLayout: () => columnLifecycle.persist(),
    getFontSize: id => columnRuntime.getFontSize(id),
    getFilter: id => (supportsColumnFilter(id) ? columnFilters.get(id) : undefined),
    setFilter: setColumnFilter,
    setFontSize: (id, colType, fontSize) => {
      columnRuntime.setFontSize(id, fontSize);
      columnMounts.applyFontSize(id, colType, fontSize);
    },
  },
  ui: { escape: esc },
  intents: {
    toast: message => toast(message),
    refilterColumns: () => refilterBskyCols(),
  },
});
const mentionSuggest = SocialDeckComposeMentionSuggest.createComposeMentionSuggest({
  documentRef: document,
  windowRef: window,
  searchActors: async query => (
    (await authenticatedBskyAdapter.searchActors({ query, limit: 6 })).actors || []
  ),
  isAvailable: () => Boolean(state.b),
  ui: { escape: esc, avatarBackground: avBgFor },
});
const columnPicker = SocialDeckColumnPicker.createColumnPicker({
  documentRef: document,
  getAccounts: () => ({ x: state.xs || [], b: state.b }),
  getColumnDefinitions: networkId => networkAdapters.getColumnDefinitions(networkId),
  createColumn: plan => columnLifecycle.create(plan),
  ui: { escape: esc },
  intents: {
    toast,
    close: modalId => closeOv(modalId),
    requestXListInput: (accountIndex, definitionId) => xListDialog.openXListDialog(accountIndex, definitionId),
  },
});
const widgetMode = SocialDeckWidgetModeRuntime.createWidgetModeRuntime({
  documentRef: document,
  widgetHost: IS_ELECTRON
    ? {
        getState: () => window.electronAPI.widgetGetState(),
        getOpacity: () => window.electronAPI.widgetGetOpacity(),
        setOpacity: opacity => window.electronAPI.widgetSetOpacity(opacity),
        getTop: () => window.electronAPI.widgetGetTop(),
        toggleTop: () => window.electronAPI.widgetToggleTop(),
        toggleLock: () => window.electronAPI.widgetToggleLock(),
        setBackgroundOnly: enabled => window.electronAPI.widgetSetBackgroundOnly(enabled),
        close: () => window.electronAPI.closeWidget(),
      }
    : null,
  columnRuntime,
  intents: {
    toast,
    reload: () => location.reload(),
    mountColumn: mountWidgetColumn,
    unmountColumn: unmountWidgetColumn,
    getFontSize: id => columnRuntime.getFontSize(id),
    setFontSize: setColumnFontSize,
  },
});
const composeQuote = SocialDeckComposeQuote.createComposeQuote({
  documentRef: document,
  measurePost,
  getAccount: () => state.b,
  buildFacets: text => buildFacets(text),
  resolveMentionDids: facets => resolveMentionDids(facets),
  createPostRecord: (record, { rkey } = {}) => authenticatedBskyAdapter.createPostRecord({ record, rkey }),
  createPostKey: () => SocialDeckBskyComposeDelivery.createPostKey(),
  isUnknownOutcome: error => SocialDeckBskyComposeDelivery.isUnknownPostOutcome(error),
  avatarFallbackBackground: AVBG[0],
  ui: { escape: esc },
  intents: {
    toast,
    refreshTimelines: () => {
      document.querySelectorAll('.col').forEach(col => {
        if (col.dataset.type === 'timeline') {
          const cid = col.id?.replace('col-', '');
          if (cid) silentRefreshBsky(cid, 'timeline', null);
        }
      });
    },
  },
});
const columnReorderRuntime = SocialDeckColumnReorderRuntime.createColumnReorderRuntime({
  container: document.getElementById('cols'),
  onReorder: () => {
    toast('カラムを移動しました');
    columnLifecycle.persist();
  },
});
const fileDragShield = SocialDeckFileDragShield.createFileDragShield({
  getIsColumnDragging: columnReorderRuntime.isDragging,
});
const workspaceBackup = SocialDeckWorkspaceBackup.createWorkspaceBackup({
  storage: workspaceStorage,
  getState: () => state,
  resolveDefinition: column => networkAdapters.resolveColumnDefinition(column),
  getNotificationRules: () => desktopNotificationRuntime.getSnapshot().rules,
  getMemoryInterval: () => memoryCleaner.getInterval(),
});
const backupSettings = SocialDeckBackupSettingsRuntime.createBackupSettingsRuntime({
  backup: workspaceBackup, files: window.electronAPI,
  beforeCapture: () => { saveColLayout(); },
  beforeRestore: () => {
    if (['x', 'b'].some(network => composeCoordinator.getStatus(network).isSending)) {
      throw new Error('投稿の送信が終わってから復元してください');
    }
    if (columnRuntime.isWidgetMode()) throw new Error('メイン画面から復元してください');
  },
  reload: () => location.reload(),
});
const columnUndo = SocialDeckColumnUndo.createColumnUndo({
  capture: id => {
    saveColLayout();
    const layout = columnRuntime.readStoredLayout();
    const index = layout.findIndex(column => column.id === id);
    if (index < 0) return null;
    const column = layout[index];
    return { column, index, nextId: layout[index + 1]?.id,
      fontSize: columnRuntime.getFontSize(id),
      filter: columnFilters.get(id),
      account: column.network === 'b' ? state.b?.did
        : state.xs.find(account => account.partition === column.partition)?.username };
  },
  remove: id => columnLifecycle.remove(id),
  canRestore: ({ column, account }) => column.network === 'b' ? state.b?.did === account
    : column.network === 'x' ? state.xs.some(item => item.partition === column.partition && item.username === account) : true,
  restore: snapshot => {
    const { column, index, nextId, fontSize, filter } = snapshot;
    if (columnShellRuntime.getRoot(column.id)) throw new Error('同じカラムが既に存在します');
    if (fontSize !== null) columnRuntime.setFontSize(column.id, fontSize);
    if (filter) columnFilters.set(column.id, filter);
    const result = columnLifecycle.restore([column]);
    if (result.failures.length) {
      columnShellRuntime.remove(column.id);
      throw result.failures[0].error;
    }
    const root = columnShellRuntime.getRoot(column.id);
    const container = document.getElementById('cols');
    const other = [...container.querySelectorAll('.col')].filter(item => item !== root);
    const before = columnShellRuntime.getRoot(nextId) || other[index] || container.querySelector('.add-col-btn');
    container.insertBefore(root, before);
    try { saveColLayout(); }
    catch (error) { columnLifecycle.remove(column.id); throw error; }
  },
  changed: pending => { document.getElementById('column-undo').hidden = !pending; },
});
{
  // カラム削除の案内は、ポインターかフォーカスが乗っている間は自動で閉じない
  const notice = document.getElementById('column-undo');
  const update = engaged => (engaged ? columnUndo.pauseDismiss() : columnUndo.resumeDismiss());
  notice.addEventListener('mouseenter', () => update(true));
  notice.addEventListener('mouseleave', () => update(notice.contains(document.activeElement)));
  notice.addEventListener('focusin', () => update(true));
  notice.addEventListener('focusout', event => update(notice.contains(event.relatedTarget) || notice.matches(':hover')));
}
const notificationRuntime = SocialDeckNotificationRuntime.createNotificationRuntime();
const xLoginGate = SocialDeckXLoginGate.createXLoginGate();
const composeModalView = SocialDeckComposeModalView.createComposeModalDomView({
  documentRef: document,
  ui: { escape: esc, formatSeconds: fmtSec, openImages: (urls, startIndex) => openImg(urls, startIndex) },
  maxVideoSeconds: { x: composeMedia.MAX_VIDEO_SECONDS, b: 180 },
});
composeModalRuntime = SocialDeckComposeModalRuntime.createComposeModalRuntime({
  storage: localStorage,
  measurePost,
  // Bluesky → X の同時投稿も X の投稿欄をスクリプトで操作するので、同意していなければ出さない
  getAccounts: () => ({ x: X_AUTOMATION_ENABLED ? state.xs || [] : [], b: state.b }),
  getPreferences: () => state.composePreferences || {},
  mediaDrafts: { x: xComposeMediaDraft, b: bskyComposeMediaDraft },
  coordinator: composeCoordinator,
  view: composeModalView,
  intents: {
    submit: networkId => composeSubmission.submit(networkId),
    confirm: message => confirm(message),
    closed: networkId => {
      if (networkId === 'b') replyTarget = null;
    },
    toast,
    updatePreference: (name, value) => {
      state.composePreferences = { ...(state.composePreferences || {}), [name]: value };
      saveState();
    },
    onBlueskyTextInput: event => mentionSuggest.onInput(event),
  },
});
const composeSubmission = SocialDeckComposeSubmission.createComposeSubmission({
  modalRuntime: {
    getSnapshot: networkId => composeModalRuntime.getSnapshot(networkId),
    setBusy: (networkId, busy, label, options) => composeModalRuntime.setBusy(networkId, busy, label, options),
    close: networkId => composeModalRuntime.close(networkId, { discard: true }),
  },
  coordinator: composeCoordinator,
  createRequest: composeRequests.createComposeRequest,
  adapters: networkAdapters,
  createCrossPostPlan: composeCrossPostPlan.createCrossPostPlan,
  mediaDrafts: { x: xComposeMediaDraft, b: bskyComposeMediaDraft },
  executeXDelivery: (delivery, context) => executeXComposeDelivery(delivery, context),
  getBlueskyAccount: () => state.b,
  getReplyTarget: () => composeModalRuntime.getSnapshot('b').reply,
  maxVideoSeconds: { x: composeMedia.MAX_VIDEO_SECONDS, b: 180 },
  formatSeconds: fmtSec,
  createPostKey: () => SocialDeckBskyComposeDelivery.createPostKey(),
  ui: {
    toast,
    confirm: message => confirm(message),
    clearTrimStatus: () => setFFmpegStatus(''),
  },
});
const authenticatedBskyAdapter = bskyGateway;
bskyColumnsRuntime = SocialDeckBlueskyColumnsRuntime.createBlueskyColumnsRuntime({
  adapter: authenticatedBskyAdapter,
  muteRules,
  columnFilter: (id, item) => matchesColumnFilter(columnFilters.get(id), blueskyPostFacts(item)),
  ui: { formatText, relTime, renderAvatar },
  icons: { reply: SVG.reply, repost: SVG.rt, heart: SVG.heart, bell: SVG.bell, follow: SVG.follow },
  documentRef: document,
  intents: {
    reply: ({ uri, cid, handle, rootUri, rootCid }) => openReply(uri, cid, handle, { rootUri, rootCid }),
    quote: ({ uri, cid, handle }) => composeQuote.open(uri, cid, handle),
    openImages: ({ urls, startIndex }) => openImg(urls, startIndex),
    openProfile: ({ did, handle }) => showProfile(did || handle),
    openPostMenu: ({ handle, x, y }) => postMenu.showPostMenu({ handle, x, y }),
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
    if (['migrated', 'recovered', 'missing', 'mismatch'].includes(result.status)) saveState();
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
}
function closeAmenu() { document.getElementById('amenu').classList.remove('open'); }

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
const refreshScheduler = SocialDeckRefreshScheduler.createRefreshScheduler();
const DEFAULT_INTERVAL_MS = refreshScheduler.DEFAULT_INTERVAL_MS;
const xTimelineTap = X_AUTOMATION_ENABLED && IS_ELECTRON && window.electronAPI?.attachXTimelineTap
  ? {
      attach: id => window.electronAPI.attachXTimelineTap(id),
      detach: id => window.electronAPI.detachXTimelineTap(id),
      onCaptured: fn => window.electronAPI.onXTimelineCaptured(fn),
    }
  : null;
const xNotificationLoader = createXNotificationLoader({
  readBadge: partition => xNativeTimelineRuntime?.readNotificationBadge(partition),
  hasNotificationColumn: partition => xNativeTimelineRuntime?.hasNotificationColumn?.(partition) === true,
  fetchNotifications: ({ accountId, retainReader }) => xWebViewRuntime.listNotifications({
    accountId,
    host: document.getElementById('notif-center-x-readers'),
    script: notificationCenter.buildXNotificationExtractionScript(40),
    retainReader,
    refreshReader: true,
    forceHidden: true,
  }),
});
const xAccounts = createXAccounts({
  getAccounts: () => state.xs,
  getAccountId: partition => window.electronAPI?.getXAccountId?.(partition),
  onHandleLearned: () => saveState(),
});

const xNotificationCapture = xTimelineTap
  ? SocialDeckXNotificationCapture.createXNotificationCapture({
      tap: xTimelineTap,
      log: (...args) => console.debug('[XNative]', ...args),
      onItems: (partition, items) => {
        items.forEach(item => xAccounts.learnHandle(partition, { id: item.targetAuthorId, handle: item.targetAuthorHandle }));
        xNativeTimelineRuntime?.setNotifications(partition, items);
      },
      onSourceChange: partition => {
        const account = xAccounts.byPartition(partition);
        if (account) replyNotificationRuntime?.rebaseline(account);
        desktopNotificationRuntime?.rebaseline?.();
      },
    })
  : null;
xWebViewRuntime = SocialDeckXWebViewRuntime.createXWebViewRuntime({
  notificationCapture: xNotificationCapture,
  documentRef: document,
  getFontSize: id => columnRuntime.getFontSize(id),
  isElectron: IS_ELECTRON,
  loginGate: xLoginGate,
  isLoginPending: partition => xAccounts.byPartition(partition)?.loginPending === true,
  completeLogin: completeXLogin,
  getRefreshInterval: id => columnLifecycle.getRefreshInterval(id),
  setRefreshInterval: (id, interval) => columnLifecycle.setRefreshInterval(id, interval),
  defaultRefreshInterval: DEFAULT_INTERVAL_MS,
  createRefreshScript: X_AUTOMATION_ENABLED
    ? destination => SocialDeckXTimelineRefresh.createRefreshScript(destination)
    : null,
  getCanonicalUrl: getXNotificationColumnUrl,
  getPreloadPath: () => wvPreloadPath,
  allowDevTools: window.electronAPI?.devToolsEnabled === true,
  openImage: openImg,
});
const xPostView = SocialDeckXPostView.createXPostView({
  icons: { reply: SVG.reply, repost: SVG.rt, heart: SVG.heart, more: SVG.more || '' },
  relTime,
  getPendingReaction: (kind, id, partition) => xNativeTimelineRuntime?.getPendingReaction(kind, id, partition) || null,
});
const xStatusRuntime = xTimelineTap
  ? SocialDeckXStatusRuntime.createXStatusRuntime({
      documentRef: document,
      getPreloadPath: () => wvPreloadPath,
      tap: xTimelineTap,
    })
  : null;
const xNativeTimelineRuntime = xTimelineTap
  ? SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
      documentRef: document,
      getPreloadPath: () => wvPreloadPath,
      tap: xTimelineTap,
      statusRuntime: xStatusRuntime,
      renderPost: xPostView.renderPost,
      renderThread: xPostView.renderThread,
      icons: { repost: SVG.rt, trash: SVG.trash || '' },
      getAccountId: partition => window.electronAPI?.getXAccountId?.(partition),
      isAuthenticated: partition => window.electronAPI?.isXSessionAuthenticated
        ? window.electronAPI.isXSessionAuthenticated(partition)
        : true,
      confirmAction: message => confirm(message),
      relTime,
      blocksPost: item => muteRules.blocksPost(item),
      columnFilter: (id, post) => matchesColumnFilter(columnFilters.get(id), xPostFacts(post)),
      isBusy: () => xWebViewRuntime.isPosting(),
      createRefreshScript: (destination, options) => SocialDeckXTimelineRefresh.createRefreshScript(destination, options),
      createToggleScript: options => SocialDeckXStatusActions.createToggleScript(options),
      log: (...args) => console.debug('[XNative]', ...args),
      loadNotifications: (partition, options) => {
        const accountIndex = xAccounts.indexOfPartition(partition);
        const account = state.xs?.[accountIndex];
        if (!account) return Promise.reject(new Error('X アカウントが見つかりません'));
        return xNotificationLoader.load(account, accountIndex, options);
      },
      getNotifications: partition => xNotificationCapture?.items(partition) || null,
      intents: {
        openImages: ({ urls, startIndex }) => openImg(urls, startIndex),
        openExternal: ({ url }) => window.open(url, '_blank', 'noopener'),
        reply: target => openXReply(target),
        postsSeen: (partition, posts) => xAccounts.learnHandlesFromPosts(partition, posts),
        loginCompleted: partition => completeXLogin(partition),
        quote: target => openXQuote(target),
        onOutcome: outcome => {
          if (outcome.kind === 'timeline') {
            toast(outcome.error?.message || 'タブを切り替えられませんでした');
            return;
          }
          if (outcome.kind === 'delete') {
            toast(outcome.status === 'failed'
              ? `削除できませんでした: ${outcome.error?.message || ''}`
              : 'ポストを削除しました');
            return;
          }
          const verb = outcome.kind === 'like'
            ? (outcome.active ? 'いいねしました' : 'いいねを取り消しました')
            : (outcome.active ? 'リポストしました' : 'リポストを取り消しました');
          toast(outcome.status === 'failed'
            ? `エラー: ${outcome.error?.message || '操作できませんでした'}`
            : verb);
        },
      },
    })
  : null;
if (xNativeTimelineRuntime) setInterval(() => xNativeTimelineRuntime.updateRelativeTimes(), 60_000);
const columnMounts = createColumnMounts({
  documentRef: document,
  shell: columnShellRuntime,
  xWebView: xWebViewRuntime,
  bluesky: bskyColumnsRuntime,
  animeSchedule: animeScheduleRuntime,
  xNative: xNativeTimelineRuntime,
  ...(IS_ELECTRON && !X_AUTOMATION_ENABLED ? { xNativeUnavailableHtml: X_AUTOMATION_OFF_HTML } : {}),
  setRefreshInterval: (id, interval) => columnLifecycle.setRefreshInterval(id, interval),
  getFontSize: id => columnRuntime.getFontSize(id),
  getPreloadPath: () => wvPreloadPath,
  intervals: { standard: DEFAULT_INTERVAL_MS, animeSchedule: 5 * 60 * 1000 },
});
function openUnreadReplies() {
  notificationReplyRuntime.back();
  notificationCenterRuntime.open({ network: 'x', reason: 'all', unreadOnly: true });
}
const replyNotificationView = SocialDeckReplyNotifications.createReplyNotificationDomView({
  documentRef: document,
  activate: item => replyNotificationRuntime.activate(item),
  openUnread: openUnreadReplies,
  onBadge: count => notificationRuntime.setXUnreadCount(count),
});
const replyNotificationRuntime = SocialDeckReplyNotifications.createReplyNotificationRuntime({
  storage: localStorage, view: replyNotificationView,
  // Desktop notifications and reply toasts open the post like the notification center does.
  openItem: item => openXNotificationNatively(item) || openXNotificationCenterItem(item),
});
const notificationReplyRuntime = SocialDeckNotificationReply.createNotificationReplyRuntime({
  documentRef: document,
  getAccounts: () => state.xs || [],
  getPreloadPath: () => wvPreloadPath,
  getBlueskyAccount: () => state.b,
  getActivationScript: item => notificationCenter.buildXNotificationActivationScript(item.raw),
});
const notificationCenterView = SocialDeckNotificationCenterRuntime.createNotificationCenterDomView({
  documentRef: document,
  ui: {
    escape: esc,
    renderAvatar,
    relativeTime: relTime,
    avatarBackground: avBgFor,
    canReply: item => Boolean(SocialDeckNotificationReply.replyUrl(item)),
  },
});
notificationCenterRuntime = SocialDeckNotificationCenterRuntime.createNotificationCenterRuntime({
  model: notificationCenter,
  getSession: () => ({
    bluesky: Boolean(state.b),
    blueskyAccountId: state.b?.did,
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
      if (!X_AUTOMATION_ENABLED) {
        throw new Error('X の自動化機能を使わない設定のため、X の通知は表示しません（設定 → X の自動化機能）');
      }
      if (E2E_FIXTURES && E2E_FIXTURES.useNotificationReaders !== true) {
        return (E2E_FIXTURES.xNotifications || []).filter(item =>
          (Number(item.accountIndex) || 0) === accountIndex
        );
      }
      return xNotificationLoader.load(account, accountIndex);
    },
    markBlueskySeen: seenAt => authenticatedBskyAdapter.markNotificationsSeen({ seenAt }),
  },
  view: notificationCenterView,
  intents: {
    close: () => closeOv('notifCenterMod'),
    openXAccountNotifications: ({ accountIndex }) => goToXNotifCol(accountIndex),
    observeX: (items, accounts, errors, enabled = accounts.map(() => true)) => {
      replyNotificationRuntime.syncAccounts(accounts);
      accounts.forEach((account, index) => {
        if (enabled[index] && !account.loginPending && !errors.some(error => error.accountIndex === index)) {
          replyNotificationRuntime.observe(items.filter(item => item.accountIndex === index), account, index);
        }
      });
      const currentKeys = new Set(items.map(replyNotificationRuntime.getItemKey));
      const retained = replyNotificationRuntime.unreadItems().filter(entry =>
        !currentKeys.has(replyNotificationRuntime.getItemKey(entry)));
      return [...items, ...retained].map(item => ({ ...item,
        accountIndex: accounts.findIndex(account => isSameXAccount(account, item.account)),
        isRead: ['reply', 'like'].includes(item.reason) ? replyNotificationRuntime.isRead(item) : null,
      }));
    },
    openNotification: item => openXNotificationNatively(item) || notificationReplyRuntime.open(item),
    markXRead: item => replyNotificationRuntime.markRead(item),
    markAllXRead: () => replyNotificationRuntime.markAllRead(),
    // Xポストの返信も詳細画面から行う（詳細画面の返信ボタンで投稿画面を開く）
    reply: item => openXNotificationNatively(item) || notificationReplyRuntime.open(item),
    clearUnread: () => notificationRuntime.clearUnread(),
    toast,
  },
});
const desktopNotificationView = SocialDeckDesktopNotificationRuntime.createDesktopNotificationDomView({
  documentRef: document,
});
desktopNotificationRuntime = SocialDeckDesktopNotificationRuntime.createDesktopNotificationRuntime({
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
      if (item.networkId === 'x') return replyNotificationRuntime.activate(item);
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
const accountSessionView = SocialDeckAccountSessionRuntime.createAccountSessionDomView({
  documentRef: document,
  escape: esc,
});
accountSessionRuntime = SocialDeckAccountSessionRuntime.createAccountSessionRuntime({
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
    clear: partition => {
      xNativeTimelineRuntime?.forgetAccount(partition);
      xNotificationLoader.forget(partition);
      xNotificationCapture?.forget(partition);
      return IS_ELECTRON
        ? window.electronAPI?.clearXSession?.(partition)
        : Promise.resolve(false);
    },
    clearAll: () => {
      xNativeTimelineRuntime?.forgetAccount();
      xNotificationLoader.forget();
      xNotificationCapture?.forget();
      return IS_ELECTRON
        ? window.electronAPI?.clearAllXSessions?.()
        : Promise.resolve(false);
    },
    sync: accounts => {
      xWebViewRuntime.syncAccounts(accounts);
      xAccounts.refreshUserIds(accounts);
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
  createDefaultState: SocialDeckStateStore.defaultState,
  view: accountSessionView,
  intents: {
    confirmLogout: account => confirm(`${account.username} をログアウトしますか？`),
    confirmLogoutAll: () => confirm('すべてのアカウントからログアウトしますか？'),
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
      if (network === 'all') composeModalRuntime.forgetAllDrafts();
      else if (network === 'x' && kind === 'logout') composeModalRuntime.forgetXAccount(account);
      if (network === 'x' && kind === 'login' && needsXAutomationDecision(xAutomationSetting.get(), state.xs)) {
        xAutomationConsent.open();
      }
      if (network === 'all') {
        accountSessionRuntime.openSettings();
        toast('すべてのアカウントからログアウトしました');
        return;
      }
      const app = document.getElementById('app');
      const appIsOpen = app.style.display && app.style.display !== 'none';
      if (kind === 'login' && !appIsOpen) enterApp();
      else if (appIsOpen) renderApp();
      if (network === 'x') {
        toast(kind === 'login' ? `${account.username} を追加しました` : 'X アカウントを削除しました');
      } else {
        toast(kind === 'login' ? `@${account.handle} でログインしました` : 'Bluesky からログアウトしました');
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
  // An explicitly saved empty workspace must remain empty after restore/reload.
  if (localStorage.getItem(COL_KEY) === '[]') return;

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
    const partition = xPartitionOf(account, index);
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

function completeXLogin(partition) {
  const account = xAccounts.byPartition(partition);
  if (account?.loginPending) {
    delete account.loginPending;
    saveState();
    xWebViewRuntime.syncAccounts(state.xs || []);
  }
}

// ─── WEBVIEW COLUMN (X) ─────────────────────────
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
  if (!xWebViewRuntime.openDevTools()) toast('X の WebView カラムが見つかりません');
}

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

function xNativeScrollTop(cid) {
  if (columnShellRuntime.isCollapsed(cid)) { columnShellRuntime.toggleCollapsed(cid); return; }
  xNativeTimelineRuntime?.scrollTop(cid);
}

function animeScheduleScrollTop(cid) {
  if (columnShellRuntime.isCollapsed(cid)) { columnShellRuntime.toggleCollapsed(cid); return; }
  animeScheduleRuntime.scrollTop(cid);
}


const X_NATIVE_FOLLOW_UP_MS = 10_000;
async function refreshAfterCompose(target) {
  if (target.kind === 'x-account-columns') {
    const partition = xAccounts.partitionForAccountId(target.accountId);
    console.info('[XNative] post-compose refresh', target.accountId, partition);
    await Promise.all([
      xWebViewRuntime.refreshAccount(target.accountId),
      partition && xNativeTimelineRuntime?.refreshPartition(partition, { force: true })
        .then(result => console.info('[XNative] post-compose result', result)),
    ]);
    // A post sent from a visible X Column can reach the timeline a little later: check once more.
    if (partition && xNativeTimelineRuntime) {
      setTimeout(() => xNativeTimelineRuntime.refreshPartition(partition).catch(() => {}), X_NATIVE_FOLLOW_UP_MS);
    }
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

// ─── COLUMN ACTIONS ─────────────────────────────
function removeCol(id) {
  try { columnUndo.remove(id); }
  catch (error) { toast(`カラムを削除できませんでした: ${error.message}`); }
}

async function refreshColumn(id, button) {
  button?.classList.add('spin');
  try {
    await columnLifecycle.refreshNow(id, { force: true });
  } finally {
    button?.classList.remove('spin');
  }
}

let replyTarget = null; // { uri, cid, rootUri, rootCid }

// 返信先の投稿が分かっていればスレッドの起点（root）もそこから決まる。分からないときだけスレッドを取得する
async function openReply(uri, cid, handle, { rootUri = null, rootCid = null } = {}) {
  const preview = readReplyPreview(document.querySelector(`.post[data-uri="${CSS.escape(uri)}"]`));
  replyTarget = {
    uri, cid, rootUri: rootUri || uri, rootCid: rootCid || cid, handle,
    ...(preview && { preview }),
  };

  openComp();

  if (!rootUri && state.b) {
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
      avEl.innerHTML = `<img src="${esc(state.b.avatar)}"><span id="comp-av-txt" style="display:none"></span>`;
    } else {
      avEl.innerHTML = `<span id="comp-av-txt">${esc(state.b.initials || '?')}</span>`;
    }
  }

  const xAvEl = document.getElementById('x-post-av');
  const activeXAcc = state.xs?.[state.activeX || 0];
  if (xAvEl && activeXAcc) {
    xAvEl.style.background = activeXAcc.bg || '';
    xAvEl.innerHTML = `<span id="x-post-av-txt">${esc(activeXAcc.initials || 'X')}</span>`;
  }
}

function openComp() {
  composeModalRuntime.open('b', { reply: replyTarget });
  setTimeout(() => document.getElementById('cta')?.focus(), 50);
}

function openXPost() {
  // SocialDeck からの X への投稿は、X の投稿欄をスクリプトで操作する
  if (!X_AUTOMATION_ENABLED) {
    xAutomationConsent.open();
    return;
  }
  composeModalRuntime.open('x');
  setTimeout(() => document.getElementById('x-cta')?.focus(), 50);
}

// ネイティブXカラムからの返信・引用は、そのカラムのアカウントで投稿する
function openXReply({ id, url, handle, partition }) {
  xNativeTimelineRuntime?.closeDetail();
  const preview = readReplyPreview(document.querySelector(`.x-native-post[data-x-id="${CSS.escape(id)}"]`));
  const result = composeModalRuntime.open('x', {
    reply: { id, url, handle, ...(preview && { preview }) },
    accountIndex: xAccounts.indexOfPartition(partition),
  });
  if (result?.status !== 'blocked' && result?.status !== 'cancelled') {
    setTimeout(() => document.getElementById('x-cta')?.focus(), 50);
  }
}

function openXQuote({ url, partition }) {
  xNativeTimelineRuntime?.closeDetail();
  composeModalRuntime.open('x', {
    accountIndex: xAccounts.indexOfPartition(partition),
    appendText: url,
  });
  setTimeout(() => {
    const input = document.getElementById('x-cta');
    input?.focus();
    input?.setSelectionRange?.(0, 0);
  }, 50);
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

// Hidden X pages do not load X's media; a post with attachments needs it for the upload
// previews, so it is allowed for the duration of that delivery only.
async function withXMediaAllowed(webview, delivery, task) {
  const hasMedia = Boolean(delivery.video) || (delivery.imageFiles?.length || 0) > 0;
  const hidden = /^x-(?:home|status)-reader-/.test(webview?.id || '');
  const setBlocked = window.electronAPI?.setXTimelineMediaBlocked;
  if (!hasMedia || !hidden || !setBlocked) return task();
  const webContentsId = webview.getWebContentsId?.();
  await setBlocked(webContentsId, false).catch(() => false);
  try {
    return await task();
  } finally {
    setBlocked(webContentsId, true).catch(() => false);
  }
}

function executeXComposeDelivery(delivery, context = {}) {
  // 返信はそのポストのページを操作用ビューで開き、ページ内の返信欄から送る
  if (delivery.replyTo) {
    const partition = xAccounts.partitionForAccountId(delivery.accountId);
    if (!xStatusRuntime || !partition) return Promise.reject(new Error('X の返信先を開けませんでした'));
    return xWebViewRuntime.withPosting(() => xStatusRuntime.run(partition, delivery.replyTo, async webview => {
      const composer = await webview.executeJavaScript(SocialDeckXStatusActions.createOpenReplyScript(delivery.replyTo.id));
      console.info('[XNative] reply composer', composer);
      if (composer?.status !== 'ready') {
        throw new Error(`X の返信画面を開けませんでした（${composer?.status || 'unknown'}）`);
      }
      return withXMediaAllowed(webview, delivery, () =>
        networkAdapters.executeComposeDelivery(delivery, { ...context, webview }));
    }));
  }
  return xWebViewRuntime.executeCompose(
    delivery,
    context,
    (preparedDelivery, preparedContext) => withXMediaAllowed(preparedContext.webview, preparedDelivery, () =>
      networkAdapters.executeComposeDelivery(preparedDelivery, preparedContext)),
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

const postMenu = createPostMenuRuntime({
  documentRef: document, esc, muteRules, toast, refilterBskyCols,
});

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
  btn.onclick = () => {
    notificationReplyRuntime.back();
    notificationCenterRuntime.open();
  };
  el.appendChild(btn);

  replyNotificationRuntime.render();
  notificationRuntime.renderBadge();
  if (state.b) startNotifPoll();
}

const appInfo = createAppInfoRuntime({
  documentRef: document, api: window.electronAPI,
});

// 通知センターのXポストも、タイムラインと同じ詳細画面で開く
function openXNotificationNatively(item) {
  if (item?.networkId !== 'x' || !xNativeTimelineRuntime) return false;
  const partition = xPartitionOf(item.account, Number(item.accountIndex) || 0);
  if (xAccounts.indexOfPartition(partition) < 0) return false;
  const match = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)\/status\/(\d+)/.exec(item.targetUrl || '');
  if (!match) {
    // Like / repost cells link only to the actor: follow the cell on X to find the post.
    if (!['like', 'repost', 'reply', 'mention', 'quote'].includes(item.reason) || !xStatusRuntime) return false;
    const body = SocialDeckNotificationCenter.extractXNotificationBody(item);
    xNativeTimelineRuntime.openPostFrom(partition, async () => {
      const target = await xStatusRuntime.resolveNotification(
        partition, notificationCenter.buildXNotificationActivationScript(item.raw));
      return target && {
        id: target.id,
        url: target.url,
        createdAt: '',
        author: { handle: target.handle, name: target.handle },
        segments: body ? [{ type: 'text', text: body }] : [],
        media: [],
      };
    }, { previewText: body }).then(detail => {
      if (!detail) notificationReplyRuntime.open(item);
    });
    return true;
  }
  const [, handle, id] = match;
  const author = item.author?.handle === handle ? item.author : { handle, displayName: handle };
  const detail = xNativeTimelineRuntime.openPost({
    id,
    url: `https://x.com/${handle}/status/${id}`,
    createdAt: item.indexedAt || '',
    author: { handle, name: author.displayName || handle, avatar: author.avatar || '' },
    segments: [{ type: 'text', text: SocialDeckNotificationCenter.extractXNotificationBody(item) }],
    media: [],
  }, partition);
  return Boolean(detail);
}

async function openXNotificationCenterItem(item) {
  const accountIndex = state.xs?.findIndex(account => isSameXAccount(account, item.account));
  const account = state.xs?.[accountIndex];
  if (!account) return false;
  const targetCol = goToXNotifCol(accountIndex, { webView: true });
  const columnId = targetCol?.id?.replace(/^col-/, '');
  if (!columnId) return false;

  try {
    const result = await xWebViewRuntime.openNotificationTarget({
      columnId,
      item,
      notificationUrl: 'https://x.com/notifications',
      activationScript: notificationCenter.buildXNotificationActivationScript(item.raw),
    });
    if (result.status !== 'opened') {
      toast('対象のポストを通知ページで見つけられませんでした');
      return false;
    }
  } catch (error) {
    console.warn('X notification target could not be opened:', error);
    toast('対象のポストを開けませんでした');
    return false;
  }
  return true;
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

// ─── REFRESH ALL ────────────────────────────────
async function refreshAll() {
  toast('すべてのカラムを更新しています…');
  await columnLifecycle.refreshAll({ force: true });
}

// ─── X NOTIFICATION COLUMN ──────────────────────

// The native notification Column is preferred: it runs no X page of its own. Opening a
// notification by its place on X's page (`webView`) needs the WebView Column.
function goToXNotifCol(accountIndex, { webView = false } = {}) {
  const account = state.xs?.[accountIndex];
  if (!account) return null;
  const partition = xPartitionOf(account, accountIndex);
  const native = !webView && Boolean(xNativeTimelineRuntime);
  const columns = document.querySelectorAll('.col');
  const nativeCol = native ? [...columns].find(col =>
    col.dataset.definitionId === 'x-notif-native' && col.dataset.partition === partition) : null;
  let targetCol = nativeCol || notificationCenter.findXNotificationColumn(columns, partition);
  if (!targetCol) {
    const id = native ? `x${accountIndex}-notif-native-auto` : `x${accountIndex}-notif-auto`;
    const result = columnLifecycle.create({
      networkId: 'x',
      definitionId: native ? 'x-notif-native' : 'x-notif-new',
      id,
      account: { ...account, index: accountIndex, partition },
    });
    if (result.status !== 'created') {
      toast('通知カラムを追加できませんでした');
      return null;
    }
    targetCol = document.getElementById(`col-${id}`);
    toast(`${account.username} の通知カラムを追加しました`);
  }

  // カラムにスクロール
  if (targetCol) {
    targetCol.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    targetCol.style.outline = '2px solid var(--accent)';
    setTimeout(() => { targetCol.style.outline = ''; }, 1200);
  }
  return targetCol;
}

// ─── MEMORY MANAGEMENT ──────────────────────────

function startMemoryCleaner() {
  memoryCleaner.start();
}

function scrollToStart() {
  document.getElementById('cols')?.scrollTo({ left: 0, behavior: 'smooth' });
}

const xListDialog = createXListDialogRuntime({
  documentRef: document, getAccounts: () => state.xs, esc, icon: SVG.x, toast,
  nextColumnId: prefix => columnPicker.nextColumnId(prefix), createColumn: request => columnLifecycle.create(request),
});

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
function toggleAmDrop(id, event) {
  appShellRuntime.toggleMenu(id, event);
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
    'open-about': () => appInfo.openAbout(),
    'close-app': () => window.electronAPI?.close(),
    'open-add-column': () => columnPicker.open(),
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
    'scroll-columns-start': () => scrollToStart(),
    'update-status': ({ status }) => appInfo.renderUpdateStatus(status),
    'scroll-start': () => scrollToStart(),
    'open-x-post': () => openXPost(),
    'open-x-automation-consent': () => xAutomationConsent.open(),
    'decide-x-automation': ({ dataset }) => {
      xAutomationSetting.set(dataset.decision);
      xAutomationConsent.close();
      // 動いている機能と選択が食い違うときだけ読み込み直す
      if (xAutomationSetting.isEnabled() !== X_AUTOMATION_ENABLED) location.reload();
    },
    'open-b-post': () => openComp(),
    'open-compose': ({ network }) => {
      if (network === 'x' || (!network && !state.b && state.xs?.length)) openXPost();
      else openComp();
    },
    'open-shortcuts': () => document.getElementById('shortcutsMod').classList.add('on'),
    'open-ng-settings': () => settingsModals.openNgSettings(),
    'open-memory-settings': () => settingsModals.openMemorySettings(),
    'open-settings': () => document.getElementById('settingsMod').classList.add('on'),
    'open-backup': () => backupSettings.open(),
    'export-backup': () => backupSettings.export(),
    'import-backup': () => backupSettings.import(),
    'recover-backup': () => backupSettings.recover(),
    'apply-backup': () => backupSettings.apply(),
    'undo-column': () => {
      try { if (columnUndo.undo()) toast('カラムを元に戻しました'); }
      catch (error) { toast(error.message); }
    },
    'dismiss-column-undo': () => columnUndo.clear(),
    'dismiss-workspace-recovery': () => { document.getElementById('workspace-recovery').hidden = true; },
    'settings-accounts': () => {
      document.getElementById('settingsMod').classList.remove('on');
      openLoginScreen();
    },
    'open-appearance-settings': () => settingsModals.openAppearanceSettings(),
    'preview-appearance-density': ({ dataset }) => settingsModals.previewAppearance({ density: dataset.density }),
    'preview-appearance-theme': ({ dataset }) => settingsModals.previewAppearance({ theme: dataset.theme }),
    'preview-appearance-accent': ({ dataset }) => settingsModals.previewAppearance({ accent: dataset.accent }),
    'preview-appearance-custom': ({ value }) => settingsModals.previewAppearance({ accent: value }),
    'cancel-appearance': ({ event, target }) => settingsModals.cancelAppearance(event, target),
    'save-appearance': () => settingsModals.saveAppearance(),
    'close-overlay': ({ dataset, event, target }) => (
      closeOv(dataset.overlayId, target.classList.contains('ov') ? event : undefined)
    ),
    'check-updates': () => appInfo.checkForUpdates(),
    'install-update': () => appInfo.installUpdate(),
    'close-lightbox': ({ event }) => lbClose(event),
    'move-lightbox': ({ dataset }) => lbMove(integer(dataset.direction)),
    'remove-ng-rule': ({ dataset }) => settingsModals.removeNgRule(dataset.ruleKind, integer(dataset.ruleIndex)),
    'add-ng-rule': ({ dataset }) => settingsModals.addNgRule(dataset.ruleKind),
    'remove-element': ({ dataset }) => removeElement(dataset.targetId),
    'close-quote': () => composeQuote.close(),
    'update-quote-count': () => composeQuote.updateCharacterCount(),
    'submit-quote': () => composeQuote.submit(),
    'add-column': ({ dataset }) => columnPicker.addColumn(
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
    'toggle-column-filter': ({ dataset }) => settingsModals.toggleColumnFilter(dataset.columnId, dataset.filterKey),
    'add-column-filter-word': ({ dataset }) => settingsModals.addColumnFilterWord(dataset.columnId),
    'remove-column-filter-word': ({ dataset }) => settingsModals.removeColumnFilterWord(
      dataset.columnId,
      integer(dataset.wordIndex, -1),
    ),
    'add-ng-user': ({ dataset }) => postMenu.addNgUser(dataset.handle),
    'copy-handle': ({ dataset }) => postMenu.copyHandle(dataset.handle),
    'apply-memory-interval': ({ dataset }) => settingsModals.applyMemoryInterval(integer(dataset.intervalMs)),
    'clear-memory-now': () => {
      settingsModals.clearMemoryNow(true);
    },
    'refresh-memory-metrics': () => settingsModals.refreshMemoryMetrics(),
    'confirm-x-list': ({ dataset }) => xListDialog.confirmXList(integer(dataset.accountIndex), dataset.definitionId),
    'insert-mention': ({ dataset }) => mentionSuggest.insert(dataset.handle),
    'widget-select-column': ({ value }) => widgetMode.selectColumn(value),
    'widget-set-opacity': ({ value }) => widgetMode.setOpacity(value),
    'widget-toggle-top': () => widgetMode.toggleTop(),
    'widget-toggle-lock': () => widgetMode.toggleLock(),
    'widget-toggle-background-only': () => widgetMode.toggleBackgroundOnly(),
    'widget-toggle-menu': () => widgetMode.toggleMenu(),
    'widget-open-picker': () => widgetMode.openPicker(),
    'widget-select-tab': ({ dataset }) => widgetMode.selectTab(dataset.columnId),
    'widget-add-tab': ({ dataset }) => widgetMode.addTab(dataset.columnId),
    'widget-close-tab': ({ dataset }) => widgetMode.closeTab(dataset.columnId),
    'widget-font-step': ({ dataset }) => widgetMode.stepFontSize(Number(dataset.step)),
    'widget-close': () => widgetMode.close(),
  };
}

function toast(message) {
  appShellRuntime.toast(message);
}

// ─── INIT ───────────────────────────────────────
const uiActions = createUiActionHandlers();
appShellRuntime = createAppShellRuntime({
  documentRef: document,
  windowRef: window,
  api: window.electronAPI,
  actions: uiActions,
  cancelAppearance: () => appearanceRuntime.cancel(),
  closeOverlay: id => closeOv(id),
  closeQuote: () => composeQuote.close(),
  keyboardNavigation: createKeyboardNavigation({ documentRef: document, actions: uiActions }),
});
appShellRuntime.attach();
delegatedActionRuntime = SocialDeckDelegatedActionRuntime.createDelegatedActionRuntime({
  root: document,
  actions: uiActions,
});
window.addEventListener('beforeunload', () => {
  appShellRuntime.dispose();
  delegatedActionRuntime.dispose();
}, { once: true });
if (!window.electronAPI?.devToolsEnabled) {
  document.querySelectorAll('.dev-only').forEach(element => element.remove());
}
state = E2E_FIXTURES?.state ? structuredClone(E2E_FIXTURES.state) : stateStore.load();
state.appearance = appearanceRuntime.apply(state.appearance);
webviewPreloadReady = initWvPreloadPath();
const blueskySessionReady = initializeBlueskySession();
const accountSessionReady = blueskySessionReady.then(() => accountSessionRuntime.start());
// Xのログイン状態を確定させてから通知ポーリングを開始する
// (未確定のままだとX通知リーダーが作られず初回取得が空になるため)
const xLoginStatesReady = accountSessionReady
  .then(() => initializeXLoginStates())
  .catch(() => {});
xLoginStatesReady.then(() => desktopNotificationRuntime.start()).catch(() => {});
fileDragShield.attach();
columnReorderRuntime.attach();

// X アカウントがあって、自動化機能を使うかまだ決めていなければ、起動時に1回確認する
if (needsXAutomationDecision(xAutomationSetting.get(), state.xs)) xAutomationConsent.open();

const hasStoredAccounts = (state.xs && state.xs.length > 0) || state.b;
if (hasStoredAccounts) {
  Promise.all([accountSessionReady, webviewPreloadReady, xLoginStatesReady]).finally(() => {
    if ((state.xs && state.xs.length > 0) || state.b) enterApp();
  });
}

// ─── VISIBILITY-BASED REFRESH THROTTLE ──────────
// The main window keeps background throttling off, so its page never reports itself
// hidden; Main sends minimize/restore instead. The widget window uses visibilitychange.
let windowHidden = false;
function setWindowHidden(hidden) {
  if (hidden === windowHidden) return;
  windowHidden = hidden;
  if (hidden) {
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
}
document.addEventListener('visibilitychange', () => setWindowHidden(document.hidden));
window.electronAPI?.onWindowVisibility?.(({ hidden }) => setWindowHidden(hidden));

startMemoryCleaner();

// ═══════════════════════════════════════════════
//  WIDGET MODE — デスクトップTLウィジェット
// ═══════════════════════════════════════════════
if (columnRuntime.isWidgetMode()) widgetMode.init();

Promise.all([xLoginStatesReady, webviewPreloadReady]).then(() => {
  const pollReplies = () => {
    if ((state.xs || []).length && !desktopNotificationRuntime.getSnapshot().rules.enabled) notificationCenterRuntime.reload({ background: true }).catch(() => {});
  };
  pollReplies();
  const timer = setInterval(pollReplies, 30000);
  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
});

// Integration tests import these live bindings; no renderer state is published on window.
export { xWebViewRuntime, accountSessionRuntime, notificationCenterRuntime, replyNotificationRuntime,
  notificationCenter, state, columnShellRuntime, columnLifecycle, desktopNotificationRuntime, removeCol };
