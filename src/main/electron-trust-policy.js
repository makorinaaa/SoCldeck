const path = require('path');
const { fileURLToPath } = require('url');

const X_HOSTS = new Set(['x.com', 'twitter.com']);
const BSKY_HOSTS = new Set(['bsky.app']);
const X_PARTITION_PATTERN = /^persist:x(?:-\d+)?$/;

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isHostOrSubdomain(hostname, allowedHosts) {
  const normalized = String(hostname || '').toLowerCase();
  return [...allowedHosts].some(host => (
    normalized === host || normalized.endsWith(`.${host}`)
  ));
}

function getWebviewNetwork(value) {
  if (value === 'about:blank') return 'x';
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:') return null;
  if (isHostOrSubdomain(url.hostname, X_HOSTS)) return 'x';
  if (isHostOrSubdomain(url.hostname, BSKY_HOSTS)) return 'bsky';
  return null;
}

function isAllowedWebviewUrl(value) {
  return getWebviewNetwork(value) !== null;
}

function normalizeFilePath(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const filePath = value.startsWith('file:') ? fileURLToPath(value) : value;
    return path.resolve(filePath);
  } catch {
    return '';
  }
}

function isSameFile(first, second) {
  const left = normalizeFilePath(first);
  const right = normalizeFilePath(second);
  return Boolean(left && right) && left.toLowerCase() === right.toLowerCase();
}

function isTrustedRendererUrl(value, indexPath) {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'file:') return false;
  try {
    return isSameFile(fileURLToPath(url), indexPath);
  } catch {
    return false;
  }
}

function isAllowedWebviewAttachment({ src, partition, preload }, expectedPreloadPath) {
  const network = getWebviewNetwork(src);
  if (network === 'x') {
    return X_PARTITION_PATTERN.test(partition || '') && isSameFile(preload, expectedPreloadPath);
  }
  if (network === 'bsky') {
    return partition === 'persist:bsky' && !preload;
  }
  return false;
}

function isTrustedIpcSender(event, indexPath) {
  const frame = event?.senderFrame;
  if (!frame) return false;
  const isMainFrame = frame.parent === null || frame.top === frame;
  return isMainFrame && isTrustedRendererUrl(frame.url, indexPath);
}

function registerTrustedIpcHandler({ ipcMain, indexPath, channel, handler }) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedIpcSender(event, indexPath)) {
      throw new Error('Unauthorized IPC sender');
    }
    return handler(event, ...args);
  });
}

function secureApplicationWebContents(contents, {
  indexPath,
  webviewPreloadPath,
  openExternalUrl,
}) {
  const blockUntrustedNavigation = (event, url) => {
    if (!isTrustedRendererUrl(url, indexPath)) event.preventDefault();
  };

  contents.on('will-navigate', blockUntrustedNavigation);
  contents.on('will-redirect', blockUntrustedNavigation);
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    const requestedPreload = webPreferences.preload || params.preload || '';
    const allowed = isAllowedWebviewAttachment({
      src: params.src,
      partition: params.partition,
      preload: requestedPreload,
    }, webviewPreloadPath);
    if (!allowed) {
      console.warn('[Security] Blocked WebView attachment', {
        src: params.src,
        partition: params.partition || webPreferences.partition || '',
        hasPreload: Boolean(requestedPreload),
      });
      event.preventDefault();
      return;
    }

    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.nodeIntegrationInWorker = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    if (getWebviewNetwork(params.src) === 'x') {
      webPreferences.preload = webviewPreloadPath;
    } else {
      delete webPreferences.preload;
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
}

function secureWebviewContents(contents, { openExternalUrl }) {
  contents.on('will-navigate', (event, url) => {
    if (isAllowedWebviewUrl(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedWebviewUrl(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
}

module.exports = {
  isAllowedWebviewAttachment,
  isAllowedWebviewUrl,
  isTrustedIpcSender,
  isTrustedRendererUrl,
  registerTrustedIpcHandler,
  secureApplicationWebContents,
  secureWebviewContents,
};
