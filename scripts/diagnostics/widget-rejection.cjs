// Diagnostic only: isolated Electron/WebView reproduction, no SocialDeck account data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.realpathSync(os.tmpdir());
const profile = fs.mkdtempSync(path.join(tempRoot, 'socialdeck-widget-probe-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-gpu');
app.on('quit', () => {
  if (path.dirname(path.resolve(profile)) !== tempRoot) return;
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* OS may still hold cache files. */ }
});
const deadline = setTimeout(() => {
  console.error('Diagnostic timed out');
  app.exit(3);
}, 15000);

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false, width: 500, height: 700,
    webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true },
  });
  await window.loadURL('data:text/html,<div id="host" style="position:fixed;width:360px;height:640px;opacity:0;pointer-events:none"></div>');
  const count = await window.webContents.executeJavaScript(`(async () => {
    for (let index = 0; index < 40; index++) {
      const view = document.createElement('webview');
      view.style.cssText = 'width:360px;height:640px';
      view.src = 'data:text/html,notification';
      const ready = new Promise(resolve => view.addEventListener('dom-ready', resolve, { once: true }));
      document.getElementById('host').appendChild(view);
      await ready;
      if (await view.executeJavaScript('1') !== 1) throw new Error('Guest execution failed');
      view.remove();
    }
    return 40;
  })()`);
  console.log('Completed reads:', count);
  clearTimeout(deadline);
  window.destroy();
  app.quit();
}).catch(error => {
  console.error(error.message);
  app.exit(1);
});
