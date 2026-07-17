const { app, BrowserWindow, ipcMain, session, Menu, shell, Notification, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const { pathToFileURL } = require('url');
const { ensureDefaultXDarkTheme, isXSessionAuthenticated } = require('./main/x-session-theme');
const { createAppUpdater } = require('./main/app-updater');
const { createXAccountRuntime, isXPartition } = require('./main/x-account-runtime');
const { createAnimeScheduleService } = require('./main/anime-schedule');
const { createDesktopNotificationService } = require('./main/desktop-notification-service');
const { resolveFfmpegPath, runFfmpegTrim } = require('./main/ffmpeg-runtime');
const { denyWebviewPermissions } = require('./main/webview-permission-policy');
const { createBlueskySessionVault } = require('./main/bluesky-session-vault');
const { createAtprotoClient } = require('./main/bluesky-atproto-client');
const { createBlueskyGateway } = require('./main/bluesky-gateway');
const {
  registerTrustedIpcHandler,
  secureApplicationWebContents,
  secureWebviewContents,
} = require('./main/electron-trust-policy');
const { autoUpdater } = require('electron-updater');

const APP_USER_MODEL_ID = 'com.socialdeck.app';
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

// ── アドブロック（@cliqz/adblocker-electron）──
const { ElectronBlocker } = require('@cliqz/adblocker-electron');
const fetch = (...args) => import('node-fetch').then(m => m.default(...args)).catch(() => null);

// フィルタールールのキャッシュパス
const ADBLOCK_CACHE = path.join(app.getPath('userData'), 'adblocker-cache.bin');

let blocker = null;

const X_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const INDEX_PATH = path.join(__dirname, 'index.html');
const APP_PRELOAD_PATH = path.join(__dirname, 'preload.js');
const WEBVIEW_PRELOAD_PATH = path.join(__dirname, 'webview-preload.js');
const isDevelopment = process.argv.includes('--dev');

function handleTrustedIpc(channel, handler) {
  return registerTrustedIpcHandler({ ipcMain, indexPath: INDEX_PATH, channel, handler });
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

function isSocialDeckTempFile(filePath) {
  if (typeof filePath !== 'string') return false;
  const resolved = path.resolve(filePath);
  const tmpRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tmpRoot, resolved);
  return relative &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    path.basename(resolved).startsWith('socialdeck_trim_');
}

async function initAdBlocker() {
  try {
    // ipcMain のリスナー上限を引き上げ（セッション数分のリスナーが登録されるため）
    const { ipcMain } = require('electron');
    ipcMain.setMaxListeners(50);

    // キャッシュがあれば即ロード、なければダウンロード
    if (fs.existsSync(ADBLOCK_CACHE)) {
      const buf = fs.readFileSync(ADBLOCK_CACHE);
      blocker = ElectronBlocker.deserialize(new Uint8Array(buf));
      console.log('[AdBlock] キャッシュからロードしました');
    } else {
      console.log('[AdBlock] フィルタールールをダウンロード中...');
      blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      const serialized = blocker.serialize();
      fs.writeFileSync(ADBLOCK_CACHE, Buffer.from(serialized));
      console.log('[AdBlock] ルールをキャッシュしました');
    }
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
      (details, callback) => blocker.onBeforeRequest(details, callback)
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
const animeScheduleService = createAnimeScheduleService();

// ── 設定ファイルパス ──
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const BLUESKY_SESSION_PATH = path.join(app.getPath('userData'), 'bluesky-session.vault');
const blueskySessionVault = createBlueskySessionVault({
  filePath: BLUESKY_SESSION_PATH,
  safeStorage,
});
const blueskyGateway = createBlueskyGateway({
  vault: blueskySessionVault,
  client: createAtprotoClient({ fetchImpl: (...args) => net.fetch(...args) }),
});

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveConfig(data) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

// ── メインウィンドウ ──
let mainWindow;
let widgetWindow = null;
let appUpdaterController = null;
const desktopNotificationService = createDesktopNotificationService({
  NotificationClass: Notification,
  getWindow: () => mainWindow,
});

// ── ウィジェットウィンドウ（デスクトップTL表示） ──
function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.focus();
    return;
  }
  const config = loadConfig();
  const wb = config.widgetBounds || { width: 400, height: 700, x: undefined, y: undefined };

  widgetWindow = new BrowserWindow({
    width: wb.width,
    height: wb.height,
    x: wb.x,
    y: wb.y,
    minWidth: 280,
    minHeight: 300,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    alwaysOnTop: config.widgetAlwaysOnTop ?? false,
    title: 'SocialDeck Widget',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      preload: APP_PRELOAD_PATH,
      spellcheck: false,
    },
    show: false,
  });

  secureApplicationWebContents(widgetWindow.webContents, {
    indexPath: INDEX_PATH,
    webviewPreloadPath: WEBVIEW_PRELOAD_PATH,
    openExternalUrl,
  });
  widgetWindow.loadFile(INDEX_PATH, { query: { widget: '1' } });

  widgetWindow.once('ready-to-show', () => widgetWindow.show());

  widgetWindow.on('close', () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const cfg = loadConfig();
    cfg.widgetBounds = widgetWindow.getBounds();
    cfg.widgetAlwaysOnTop = widgetWindow.isAlwaysOnTop();
    saveConfig(cfg);
  });

  widgetWindow.on('closed', () => { widgetWindow = null; });

}

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

  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds();
    const cfg = loadConfig();
    cfg.windowBounds = bounds;
    cfg.maximized = mainWindow.isMaximized();
    saveConfig(cfg);
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
    denyWebviewPermissions(contents.session);
    secureWebviewContents(contents, { openExternalUrl });

    contents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = X_USER_AGENT;
      details.requestHeaders['sec-ch-ua'] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
      details.requestHeaders['sec-ch-ua-mobile'] = '?0';
      details.requestHeaders['sec-ch-ua-platform'] = '"Windows"';
      callback({ requestHeaders: details.requestHeaders });
    });

  }
});

// ── IPC ハンドラ ──

handleTrustedIpc('get-config', () => loadConfig());
handleTrustedIpc('set-config', (_, data) => { saveConfig(data); return true; });
handleTrustedIpc('get-app-version', () => app.getVersion());
handleTrustedIpc('load-bluesky-session', () => blueskyGateway.restoreAccount());
handleTrustedIpc('store-bluesky-session', (_, credentials) => blueskyGateway.migrateSession(credentials));
handleTrustedIpc('clear-bluesky-session', () => blueskyGateway.clear());
handleTrustedIpc('bluesky-login', (_, credentials) => blueskyGateway.login(credentials));
handleTrustedIpc('bluesky-operation', (_, operation, payload) =>
  blueskyGateway.execute(operation, payload)
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
handleTrustedIpc('open-widget', () => { createWidgetWindow(); return true; });
handleTrustedIpc('close-widget', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && win !== mainWindow) win.close();
  return true;
});
handleTrustedIpc('widget-toggle-top', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win === mainWindow) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next);
  const cfg = loadConfig();
  cfg.widgetAlwaysOnTop = next;
  saveConfig(cfg);
  return next;
});
handleTrustedIpc('widget-get-top', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  return win ? win.isAlwaysOnTop() : false;
});
handleTrustedIpc('widget-set-opacity', (e, value) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win === mainWindow) return false;
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return false;
  const clampedOpacity = Math.min(1, Math.max(0.3, opacity));
  win.setOpacity(clampedOpacity);
  const cfg = loadConfig();
  cfg.widgetOpacity = clampedOpacity;
  saveConfig(cfg);
  return true;
});
handleTrustedIpc('widget-get-opacity', () => loadConfig().widgetOpacity ?? 1);
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

handleTrustedIpc('get-useragent', () => X_USER_AGENT);

handleTrustedIpc('clear-memory', async () => {
  try {
    await session.defaultSession.clearCache();
    await session.fromPartition('persist:bsky').clearCache();
    await xAccountRuntime.clearCaches();
    if (global.gc) global.gc();
    return true;
  } catch (e) { return false; }
});

// ── 動画トリミング（検証済みFFmpeg / メインプロセスで実行）──
handleTrustedIpc('trim-video', async (_, { filePath, startSec, endSec }) => {
  if (typeof filePath !== 'string') throw new Error('Invalid video file');
  const inputPath = path.resolve(filePath);
  const ext = path.extname(inputPath).toLowerCase() || '.mp4';
  if (!VIDEO_EXTENSIONS.has(ext)) throw new Error('Unsupported video format');
  if (!fs.existsSync(inputPath)) throw new Error('Video file not found');

  const start = Number(startSec);
  const end = Number(endSec);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) {
    throw new Error('Invalid trim range');
  }
  const duration = end - start;
  if (duration <= 0) throw new Error('トリム範囲が不正です');
  if (duration > 140) throw new Error('動画が2分20秒を超えています');

  const outPath = path.join(os.tmpdir(), `socialdeck_trim_${randomUUID()}${ext}`);

  const ffmpegPath = resolveFfmpegPath({ isPackaged: app.isPackaged });
  return runFfmpegTrim({
    ffmpegPath,
    inputPath,
    outputPath: outPath,
    startSeconds: start,
    durationSeconds: duration,
  });
});

handleTrustedIpc('delete-temp-file', (_, filePath) => {
  try {
    if (isSocialDeckTempFile(filePath)) fs.unlinkSync(path.resolve(filePath));
    return true;
  } catch (e) { return false; }
});

handleTrustedIpc('read-file-base64', (_, filePath) => {
  try {
    if (!isSocialDeckTempFile(filePath)) throw new Error('Invalid temp file');
    const resolved = path.resolve(filePath);
    const ext = path.extname(resolved).slice(1).toLowerCase() || 'mp4';
    if (!VIDEO_EXTENSIONS.has(`.${ext}`)) throw new Error('Unsupported video format');
    const data = fs.readFileSync(resolved);
    const mime = ext === 'mp4' ? 'video/mp4' : `video/${ext}`;
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (e) {
    throw new Error('ファイル読み込みエラー: ' + e.message);
  }
});

// ── メニュー ──
function buildMenu() {
  const template = [
    {
      label: 'SocialDeck',
      submenu: [
        { label: 'SocialDeckについて', click: () => mainWindow.webContents.send('show-about') },
        { type: 'separator' },
        { label: '設定', accelerator: 'CmdOrCtrl+,', click: () => mainWindow.webContents.send('open-settings') },
        { type: 'separator' },
        { label: '終了', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ]
    },
    {
      label: 'カラム',
      submenu: [
        { label: 'カラムを追加', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('add-column') },
        { label: 'すべて更新', accelerator: 'CmdOrCtrl+R', click: () => mainWindow.webContents.send('refresh-all') },
        { type: 'separator' },
        { label: '← 左へ移動', accelerator: 'CmdOrCtrl+Left', click: () => mainWindow.webContents.send('scroll-left') },
        { label: '右へ移動 →', accelerator: 'CmdOrCtrl+Right', click: () => mainWindow.webContents.send('scroll-right') },
      ]
    },
    {
      label: '表示',
      submenu: [
        { label: '拡大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '縮小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'リセット', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全画面', accelerator: 'F11', role: 'togglefullscreen' },
        { label: '開発者ツール', accelerator: 'F12', role: 'toggleDevTools' },
      ]
    },
    {
      label: 'ヘルプ',
      submenu: [
        { label: 'GitHubで開く', click: () => shell.openExternal('https://github.com') },
      ]
    }
  ];
  const securedTemplate = isDevelopment
    ? template
    : template.map(item => ({
      ...item,
      submenu: Array.isArray(item.submenu)
        ? item.submenu.filter(entry => entry.role !== 'toggleDevTools')
        : item.submenu,
    }));
  Menu.setApplicationMenu(Menu.buildFromTemplate(securedTemplate));
}

// ── アプリ起動 ──
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-frame-options' || lower === 'x-content-type-options') {
        delete headers[key];
      }
    }
    callback({ responseHeaders: headers });
  });

  const xSession = session.fromPartition('persist:x');
  xSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-frame-options') {
        delete headers[key];
      }
    }
    callback({ responseHeaders: headers });
  });

  xSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    callback({ requestHeaders: details.requestHeaders });
  });

  // ── アドブロック初期化 ──
  // 初期化後にXの全セッションへネットワークブロックを適用
  if (process.env.SOCIALDECK_E2E !== '1') {
    initAdBlocker().then(() => {
      if (!blocker) return;
      xAccountRuntime.enableAdBlock();
    });
  }

  createWindow();

  appUpdaterController = createAppUpdater({
    autoUpdater,
    app,
    getWindow: () => mainWindow,
  });
  appUpdaterController.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
