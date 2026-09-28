const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { registerTrustedIpcHandler } = require('../src/main/electron-trust-policy');
const indexPath = path.join(__dirname, 'renderer.html');
app.whenReady().then(async () => {
  // Block all non-loopback network requests, including subresources.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: !(['file:', 'devtools:'].includes(url.protocol)
      || (url.protocol === 'http:' && url.hostname === '127.0.0.1')) });
  });
  const owner = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  registerTrustedIpcHandler({ ipcMain, indexPath, channel: 'security-probe',
    isAllowedContents: contents => contents === owner.webContents,
    handler: () => 'owner-only',
  });
  await owner.loadFile(indexPath);
});
app.on('window-all-closed', () => app.quit());
