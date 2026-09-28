const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');

test('local hostile server: HTML injection, privileged IPC, renderer isolation', { timeout: 30000 }, async t => {
  const payload = '</select><img src=x onerror="window.injected=true"><script>window.injected=true</script>';
  const server = http.createServer((req, res) => {
    if (req.url === '/payload') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ title: payload, link: 'javascript:window.injected=true' }));
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>Hostile local origin</body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const data = await (await fetch(base + '/payload')).json();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'socialdeck-security-'));
  const app = await electron.launch({ executablePath: require('electron'),
    args: [path.join(__dirname, 'electron-main.cjs'), '--disable-gpu', `--user-data-dir=${profile}`],
  });
  t.after(async () => {
    await app.close().catch(() => {});
    // Only remove the exact directory allocated by mkdtemp for this test.
    if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('socialdeck-security-')) {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  assert.equal(await page.evaluate(() => window.probe.invoke()), 'owner-only');
  const result = await page.evaluate(async data => {
    const ui = window.SocialDeckUiUtils.createUiUtils();
    document.getElementById('output').innerHTML = ui.formatText(data.title, [{
      index: { byteStart: 0, byteEnd: new TextEncoder().encode(data.title).length },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: data.link }],
    }]);
    const widget = window.SocialDeckWidgetModeRuntime.createWidgetModeRuntime({
      documentRef: document,
      columnRuntime: { readStoredLayout: () => [{ id: '" onclick="window.injected=true', title: data.title, sub: data.title }], getWidgetColumnId: () => null },
    });
    await widget.init();
    return {
      text: document.getElementById('output').textContent,
      injected: Boolean(window.injected),
      injectedElements: document.querySelectorAll('#output img, #output script, #output a, #widget-bar img, #widget-bar script, #widget-bar [onclick]').length,
      requireType: typeof window.require, processType: typeof window.process,
    };
  }, data);
  assert.equal(result.text, payload);
  assert.equal(result.injected, false);
  assert.equal(result.injectedElements, 0);
  assert.equal(result.requireType, 'undefined');
  assert.equal(result.processType, 'undefined');
  const denied = await app.evaluate(async ({ BrowserWindow }, { base, preloadPath, rendererPath }) => {
    const window = new BrowserWindow({ show: false, webPreferences: {
      preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false,
    } });
    try {
      // Deliberately give the attacker our narrow bridge: Main must still reject it.
      await window.loadURL(base + '/attack');
      const remote = await window.webContents.executeJavaScript('window.probe.invoke().then(() => "allowed", e => e.message)');
      await window.loadFile(rendererPath);
      const sameFile = await window.webContents.executeJavaScript('window.probe.invoke().then(() => "allowed", e => e.message)');
      return { remote, sameFile };
    } finally { window.destroy(); }
  }, { base, preloadPath: path.join(__dirname, 'preload.cjs'), rendererPath: path.join(__dirname, 'renderer.html') });
  assert.match(denied.remote, /Unauthorized IPC sender/);
  assert.match(denied.sameFile, /Unauthorized IPC sender/);
});
