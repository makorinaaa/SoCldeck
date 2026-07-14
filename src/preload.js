const { contextBridge, ipcRenderer } = require('electron');
const { normalizeNotificationWindowRequest } = require('./notification-window');

function isXPartition(partition) {
  return typeof partition === 'string' && /^persist:x(?:-\d+)?$/.test(partition);
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // 設定
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (data) => ipcRenderer.invoke('set-config', data),

  // ウィンドウ
  minimize: () => ipcRenderer.invoke('minimize'),
  maximize: () => ipcRenderer.invoke('maximize'),
  close: () => ipcRenderer.invoke('close'),
  zoomIn: () => ipcRenderer.invoke('zoom-in'),
  zoomOut: () => ipcRenderer.invoke('zoom-out'),
  zoomReset: () => ipcRenderer.invoke('zoom-reset'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  openDevTools: () => ipcRenderer.invoke('open-dev-tools'),
  openNotificationWindow: (value) => {
    const request = normalizeNotificationWindowRequest(value);
    return request
      ? ipcRenderer.invoke('open-notification-window', request)
      : Promise.resolve(false);
  },

  // UA
  getUserAgent: () => ipcRenderer.invoke('get-useragent'),

  // セッションクリア
  clearXSession: (partition) => isXPartition(partition)
    ? ipcRenderer.invoke('clear-x-session', partition)
    : Promise.resolve(false),
  clearAllXSessions: () => ipcRenderer.invoke('clear-all-x-sessions'),

  // メモリクリア
  clearMemory: () => ipcRenderer.invoke('clear-memory'),

  // 動画トリミング（メインプロセスのffmpegで実行）
  trimVideo: (filePath, startSec, endSec) =>
    ipcRenderer.invoke('trim-video', {
      filePath,
      startSec: toFiniteNumber(startSec),
      endSec: toFiniteNumber(endSec),
    }),

  // 一時ファイル削除
  deleteTempFile: (filePath) => ipcRenderer.invoke('delete-temp-file', filePath),

  // ファイルをBase64で読み込む
  readFileBase64: (filePath) => ipcRenderer.invoke('read-file-base64', filePath),

  // webview-preloadパス取得（X画像ライトボックス用）
  getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),

  // ウィジェットウィンドウ
  openWidget: () => ipcRenderer.invoke('open-widget'),
  closeWidget: () => ipcRenderer.invoke('close-widget'),
  widgetToggleTop: () => ipcRenderer.invoke('widget-toggle-top'),
  widgetGetTop: () => ipcRenderer.invoke('widget-get-top'),
  widgetSetOpacity: (v) => ipcRenderer.invoke('widget-set-opacity', toFiniteNumber(v, 1)),
  widgetGetOpacity: () => ipcRenderer.invoke('widget-get-opacity'),

  // メインプロセスからのイベント受信
  on: (channel, fn) => {
    const allowed = ['add-column', 'refresh-all', 'scroll-left', 'scroll-right', 'open-settings', 'show-about'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => fn(...args));
    }
  },

  // Electron環境かどうかの判定
  isElectron: true,
});
