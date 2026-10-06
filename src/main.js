const { app, BrowserWindow, ipcMain, session, Menu, shell, dialog, Notification, safeStorage, net, webContents, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createWorkspaceBackupFiles } = require('./main/workspace-backup-files');
const { createAppConfigStore } = require('./main/app-config-store');
const { createWidgetWindowController } = require('./main/widget-window');
const { createXPageDiagnostics } = require('./main/x-page-diagnostics');
const { pathToFileURL } = require('node:url');
const { ensureDefaultXDarkTheme, getXSessionUserId, isXSessionAuthenticated } = require('./main/x-session-theme');
const { createAppUpdater } = require('./main/app-updater');
const { createXAccountRuntime, isXPartition } = require('./main/x-account-runtime');
const { createAnimeScheduleService } = require('./main/anime-schedule');
const {
  createDesktopNotificationService,
  resolveWindowsNotificationIdentity,
} = require('./main/desktop-notification-service');
const { createXVideoFileService } = require('./main/x-video-file');
const { denyWebviewPermissions } = require('./main/webview-permission-policy');
const { createWebviewBrowserIdentityPolicy } = require('./main/webview-browser-identity');
const { createBlueskySessionVault } = require('./main/bluesky-session-vault');
const { createAtprotoClient } = require('./main/bluesky-atproto-client');
const { createBlueskyGateway } = require('./main/bluesky-gateway');
const { executeBlueskyOperation } = require('./main/bluesky-operation-result');
const { createBlueskyVideoFileService } = require('./main/bluesky-video-file');
const { createMemoryMetricsService } = require('./main/memory-metrics');
const { createXTimelineTap } = require('./main/x-timeline-tap');
const {
  registerTrustedIpcHandler,
  secureApplicationWebContents,
  secureWebviewContents,
} = require('./main/electron-trust-policy');
const { autoUpdater } = require('electron-updater');

const workspaceBackupFiles = createWorkspaceBackupFiles({ dialog });
const xVideoFiles = createXVideoFileService({ isPackaged: app.isPackaged });

const APP_USER_MODEL_ID = 'com.socialdeck.app';
if (process.platform === 'win32') {
  app.setAppUserModelId(resolveWindowsNotificationIdentity({
    appId: APP_USER_MODEL_ID,
    execPath: process.execPath,
    isPackaged: app.isPackaged,
  }));
}

// ── アドブロック（@cliqz/adblocker-electron）──
const { ElectronBlocker } = require('@cliqz/adblocker-electron');
const { loadAdBlocker } = require('./main/adblock-filter-cache');

// フィルタールールのキャッシュパス
const ADBLOCK_CACHE = path.join(app.getPath('userData'), 'adblocker-cache.bin');

let blocker = null;
const X_PAGE_DIAGNOSTICS_PATH = path.join(app.getPath('userData'), 'x-page-diagnostics.json');
const xPageDiagnostics = createXPageDiagnostics({
  save: data => fs.promises.writeFile(X_PAGE_DIAGNOSTICS_PATH, JSON.stringify(data)),
  saveSync: data => fs.writeFileSync(X_PAGE_DIAGNOSTICS_PATH, JSON.stringify(data)),
});
app.on('before-quit', () => xPageDiagnostics.flush());

const webviewBrowserIdentity = createWebviewBrowserIdentityPolicy();
const INDEX_PATH = path.join(__dirname, 'index.html');
const APP_PRELOAD_PATH = path.join(__dirname, 'preload.js');
const WEBVIEW_PRELOAD_PATH = path.join(__dirname, 'webview-preload.js');
// Installed builds never open DevTools, even when started with --dev.
const isDevelopment = !app.isPackaged && process.argv.includes('--dev');

function handleTrustedIpc(channel, handler) {
  return registerTrustedIpcHandler({
    ipcMain, indexPath: INDEX_PATH, channel, handler,
    isAllowedContents: contents => [mainWindow, widgetWindowController.window].some(window =>
      window && !window.isDestroyed() && window.webContents === contents),
  });
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function openExternalUrl(value) {
  const url = parseHttpUrl(value);
  if (!url) return;
  shell.openExternal(url.toString());
}

async function initAdBlocker() {
  try {
    // ipcMain のリスナー上限を引き上げ（セッション数分のリスナーが登録されるため）
    ipcMain.setMaxListeners(50);

    // キャッシュがあれば即ロード（古ければ裏で更新）、なければダウンロード
    const loaded = await loadAdBlocker({
      cachePath: ADBLOCK_CACHE,
      deserialize: bytes => ElectronBlocker.deserialize(bytes),
      download: () => ElectronBlocker.fromPrebuiltAdsAndTracking((...args) => net.fetch(...args)),
      // セッションのフックは毎回 blocker を参照するため、差し替えるだけで新しいルールが効く
      onRefresh: fresh => {
        blocker = fresh;
        console.log('[AdBlock] フィルタールールを更新しました');
      },
    });
    blocker = loaded.blocker;
    console.log(`[AdBlock] ルールを読み込みました (${loaded.source})`);
    console.log('[AdBlock] 有効化しました');

    // ブロック可能なルール数をログ表示（動作確認用）
    try {
      const networkFilters = blocker.networkFilters?.length ?? blocker.filters?.length ?? '不明';
      console.log(`[AdBlock] ロード済みルール数: ${networkFilters}`);
    } catch {}
  } catch (e) {
    console.error('[AdBlock] 初期化失敗:', e.message);
  }
}

// セッションにアドブロックを適用（ネットワークブロックのみ・webviewとの競合なし）
function applyAdBlockToSession(targetSession) {
  if (!blocker) return;
  try {
    targetSession.webRequest.onBeforeRequest(
      (details, callback) => blocker.onBeforeRequest(details, result => {
        if (result.cancel || result.redirectURL) xPageDiagnostics.blocked(details);
        callback(result);
      })
    );
    console.log('[AdBlock] セッションに適用しました');
  } catch (e) {
    console.error('[AdBlock] セッション適用失敗:', e.message);
  }
}

const xAccountRuntime = createXAccountRuntime({
  getSession: partition => session.fromPartition(partition),
  applyAdBlock: applyAdBlockToSession,
});
const xTimelineTap = createXTimelineTap({
  resolveContents: id => webContents.fromId(id) || null,
});
const animeScheduleService = createAnimeScheduleService();
const memoryMetricsService = createMemoryMetricsService({
  getAppMetrics: () => app.getAppMetrics(),
});

// ── 設定ファイルパス ──
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const BLUESKY_SESSION_PATH = path.join(app.getPath('userData'), 'bluesky-session.vault');
const blueskySessionVault = createBlueskySessionVault({
  filePath: BLUESKY_SESSION_PATH,
  safeStorage,
});
const blueskyVideoFileService = createBlueskyVideoFileService({
  isPackaged: app.isPackaged,
});
const blueskyGateway = createBlueskyGateway({
  vault: blueskySessionVault,
  client: createAtprotoClient({ fetchImpl: (...args) => net.fetch(...args) }),
  prepareVideo: input => blueskyVideoFileService.prepare(input),
});

const appConfigStore = createAppConfigStore({ filePath: CONFIG_PATH });
const loadConfig = () => appConfigStore.load();
const updateConfig = patch => appConfigStore.update(patch);

// ── メインウィンドウ ──
let mainWindow;
let appUpdaterController = null;
const desktopNotificationService = createDesktopNotificationService({
  NotificationClass: Notification,
  getWindow: () => mainWindow,
});

// ── ウィジェットウィンドウ（デスクトップTL表示） ──
let isAppQuitting = false;
app.on('before-quit', () => {
  isAppQuitting = true;
  widgetWindowController.flushSave();
});

const widgetWindowController = createWidgetWindowController({
  BrowserWindow,
  screen,
  loadConfig,
  updateConfig,
  isAppQuitting: () => isAppQuitting,
  isMainWindowOpen: () => Boolean(mainWindow && !mainWindow.isDestroyed()),
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: true,
    preload: APP_PRELOAD_PATH,
    spellcheck: false,
  },
  configureWindow: win => secureApplicationWebContents(win.webContents, {
    indexPath: INDEX_PATH,
    webviewPreloadPath: WEBVIEW_PRELOAD_PATH,
    openExternalUrl,
  }),
  loadContents: win => win.loadFile(INDEX_PATH, { query: { widget: '1' } }),
});

function createWindow() {
  const config = loadConfig();
  const winBounds = config.windowBounds || { width: 1400, height: 900 };

  mainWindow = new BrowserWindow({
    width: winBounds.width,
    height: winBounds.height,
    x: winBounds.x,
    y: winBounds.y,
    minWidth: 600,
    minHeight: 500,
    backgroundColor: '#0d0d0d',
    title: 'SocialDeck',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      preload: APP_PRELOAD_PATH,
      spellcheck: false,
      backgroundThrottling: false,
    },
    frame: false,        // フレームレス化
    titleBarStyle: 'hidden',
    show: false,
  });

  secureApplicationWebContents(mainWindow.webContents, {
    indexPath: INDEX_PATH,
    webviewPreloadPath: WEBVIEW_PRELOAD_PATH,
    openExternalUrl,
  });
  mainWindow.loadFile(INDEX_PATH);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (config.maximized) mainWindow.maximize();
  });

  // backgroundThrottling is off so notifications keep polling while minimized, which
  // also keeps the page "visible". Tell the renderer directly when nobody can see it.
  const sendWindowVisibility = hidden => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window-visibility', { hidden });
  };
  mainWindow.on('minimize', () => sendWindowVisibility(true));
  mainWindow.on('hide', () => sendWindowVisibility(true));
  mainWindow.on('restore', () => sendWindowVisibility(false));
  mainWindow.on('show', () => sendWindowVisibility(false));

  mainWindow.on('close', () => {
    updateConfig({
      windowBounds: mainWindow.getBounds(),
      maximized: mainWindow.isMaximized(),
    });
  });

  if (isDevelopment) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // フレームレスのためネイティブメニューは不要（アプリ内メニューに置き換え済み）
  Menu.setApplicationMenu(null);
}

// ── webview の権限設定 ──
app.on('web-contents-created', (_, contents) => {
  if (contents.getType() === 'webview') {
    xPageDiagnostics.attachContents(contents);
    denyWebviewPermissions(contents.session);
    secureWebviewContents(contents, { openExternalUrl });
    webviewBrowserIdentity.apply(contents);
  }
});

// ── IPC ハンドラ ──

handleTrustedIpc('get-app-version', () => app.getVersion());
handleTrustedIpc('save-workspace-backup', (_, text) => workspaceBackupFiles.save(text));
handleTrustedIpc('open-workspace-backup', () => workspaceBackupFiles.open());
handleTrustedIpc('load-bluesky-session', () => blueskyGateway.restoreAccount());
handleTrustedIpc('store-bluesky-session', (_, credentials) => blueskyGateway.migrateSession(credentials));
handleTrustedIpc('clear-bluesky-session', () => blueskyGateway.clear());
handleTrustedIpc('bluesky-login', (_, credentials) => blueskyGateway.login(credentials));
handleTrustedIpc('bluesky-operation', (_, operation, payload) =>
  executeBlueskyOperation(blueskyGateway, operation, payload)
);
handleTrustedIpc('show-desktop-notification', (_, payload) =>
  desktopNotificationService.show(payload)
);
handleTrustedIpc('check-for-updates', () => appUpdaterController?.check({ manual: true }) ?? false);
handleTrustedIpc('install-update', () => appUpdaterController?.install() ?? false);
handleTrustedIpc('get-anime-schedule', (_, options = {}) =>
  animeScheduleService.listToday({ force: options?.force === true })
);
handleTrustedIpc('sync-x-network-accounts', (_, partitions) => {
  if (!Array.isArray(partitions)) return xAccountRuntime.getPartitions();
  return xAccountRuntime.sync(partitions);
});
handleTrustedIpc('initialize-x-session-theme', async (_, partition) => {
  if (!xAccountRuntime.register(partition)) return false;
  return ensureDefaultXDarkTheme(session.fromPartition(partition));
});
handleTrustedIpc('is-x-session-authenticated', async (_, partition) => {
  if (!xAccountRuntime.register(partition)) return false;
  return isXSessionAuthenticated(session.fromPartition(partition));
});
handleTrustedIpc('get-x-account-id', async (_, partition) => {
  if (!xAccountRuntime.register(partition)) return null;
  return getXSessionUserId(session.fromPartition(partition));
});

// Hidden X WebViews owned by this window may expose their timeline responses.
function resolveOwnedXWebview(sender, webContentsId) {
  const id = Number(webContentsId);
  if (!Number.isInteger(id)) return null;
  const contents = webContents.fromId(id);
  if (!contents || contents.isDestroyed() || contents.getType() !== 'webview') return null;
  if (!contents.hostWebContents || contents.hostWebContents.id !== sender.id) return null;
  const isXSession = xAccountRuntime.getPartitions()
    .some(partition => session.fromPartition(partition) === contents.session);
  return isXSession ? contents : null;
}

handleTrustedIpc('x-timeline-attach', (event, webContentsId) => {
  const contents = resolveOwnedXWebview(event.sender, webContentsId);
  if (!contents) return false;
  const host = event.sender;
  return xTimelineTap.attach(contents.id, timeline => {
    if (!host.isDestroyed()) host.send('x-timeline-captured', { webContentsId: contents.id, ...timeline });
  });
});
handleTrustedIpc('x-timeline-media', (event, webContentsId, blocked) => {
  const contents = resolveOwnedXWebview(event.sender, webContentsId);
  return contents ? xTimelineTap.setMediaBlocked(contents.id, blocked !== false) : false;
});
handleTrustedIpc('x-timeline-detach', (event, webContentsId) => {
  const contents = resolveOwnedXWebview(event.sender, webContentsId);
  return contents ? xTimelineTap.detach(contents.id) : false;
});

// webview-preloadのパスを返す（X画像ライトボックス用）
handleTrustedIpc('get-webview-preload-path', () =>
  pathToFileURL(WEBVIEW_PRELOAD_PATH).toString()
);

handleTrustedIpc('clear-x-session', async (_, partition) => {
  if (!isXPartition(partition)) return false;
  return xAccountRuntime.clearPartitionData(partition);
});

handleTrustedIpc('clear-all-x-sessions', () => xAccountRuntime.clearAll());

handleTrustedIpc('minimize', () => mainWindow.minimize());

// ── ウィジェットウィンドウ制御 ──
const ownsWidget = e => widgetWindowController.owns(BrowserWindow.fromWebContents(e.sender));
handleTrustedIpc('open-widget', () => { widgetWindowController.open(); return true; });
handleTrustedIpc('close-widget', (e) => {
  if (ownsWidget(e)) widgetWindowController.close();
  return true;
});
handleTrustedIpc('widget-get-state', () => widgetWindowController.getState());
handleTrustedIpc('widget-toggle-top', (e) => ownsWidget(e) ? widgetWindowController.toggleTop() : false);
handleTrustedIpc('widget-get-top', () => widgetWindowController.getState().alwaysOnTop);
handleTrustedIpc('widget-toggle-lock', (e) => ownsWidget(e) ? widgetWindowController.toggleLock() : false);
handleTrustedIpc('widget-set-opacity', (e, value) => ownsWidget(e) ? widgetWindowController.setOpacity(value) : false);
handleTrustedIpc('widget-get-opacity', () => widgetWindowController.getState().opacity);
handleTrustedIpc('widget-set-background-only', (e, enabled) =>
  ownsWidget(e) ? widgetWindowController.setBackgroundOnly(enabled) : false
);
handleTrustedIpc('maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
handleTrustedIpc('close', () => mainWindow.close());
handleTrustedIpc('zoom-in', () => {
  const wc = mainWindow.webContents;
  wc.setZoomLevel(wc.getZoomLevel() + 0.5);
});
handleTrustedIpc('zoom-out', () => {
  const wc = mainWindow.webContents;
  wc.setZoomLevel(wc.getZoomLevel() - 0.5);
});
handleTrustedIpc('zoom-reset', () => mainWindow.webContents.setZoomLevel(0));
handleTrustedIpc('toggle-fullscreen', () => mainWindow.setFullScreen(!mainWindow.isFullScreen()));
handleTrustedIpc('open-dev-tools', () => {
  if (!isDevelopment) return false;
  mainWindow.webContents.openDevTools({ mode: 'detach' });
  return true;
});

handleTrustedIpc('clear-memory', async () => {
  try {
    await session.defaultSession.clearCache();
    await session.fromPartition('persist:bsky').clearCache();
    await xAccountRuntime.clearCaches();
    return true;
  } catch (e) { return false; }
});

// ── 動画トリミング（検証済みFFmpeg / メインプロセスで実行）──
handleTrustedIpc('trim-video', (_, input) => xVideoFiles.trim(input));

handleTrustedIpc('get-memory-metrics', () => memoryMetricsService.snapshot());

handleTrustedIpc('delete-temp-file', (_, filePath) => xVideoFiles.remove(filePath));
handleTrustedIpc('read-file-base64', (_, filePath) => xVideoFiles.readDataUrl(filePath));

// ── アプリ起動 ──
app.whenReady().then(async () => {
  // ── アドブロック初期化 ──
  // 初期化後にXの全セッションへネットワークブロックを適用
  if (process.env.SOCIALDECK_E2E !== '1') {
    initAdBlocker().then(() => {
      if (!blocker) return;
      xAccountRuntime.enableAdBlock();
    });
  }

  createWindow();
  widgetWindowController.restoreOnLaunch();

  appUpdaterController = createAppUpdater({
    autoUpdater,
    app,
    getWindow: () => mainWindow,
    showUpdatePrompt: async ({ version, releaseSummary }) => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'SocialDeck の更新',
        message: `新しいバージョン ${version} を利用できます。`,
        detail: [
          '更新の準備ができました。今すぐ再起動して適用しますか？',
          '',
          '主な変更:',
          releaseSummary,
        ].join('\n'),
        buttons: ['再起動して更新', 'あとで'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      return result.response === 0;
    },
  });
  appUpdaterController.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
