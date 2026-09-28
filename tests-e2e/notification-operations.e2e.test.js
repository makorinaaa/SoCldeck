const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { _electron: electron } = require('playwright-core');
const { version: appVersion } = require('../package.json');

const APP_ROOT = path.join(__dirname, '..');

test('X submission waits for composer attachments and ignores media in the timeline', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, { ...X_FIXTURES, pageHtml: `<!doctype html><html><body>
    <article data-testid="attachments"><div data-testid="tweetPhoto"></div><div data-testid="tweetPhoto"></div></article>
    <div role="dialog">
      <div contenteditable="true" data-testid="tweetTextarea_0"></div>
      <div data-testid="toolBar"><input type="file" data-testid="fileInput" multiple></div>
      <div data-testid="attachments" id="media"></div>
      <button data-testid="tweetButton">Post</button>
    </div>
    <script>
      window.submissions = [];
      document.querySelector('[contenteditable]').addEventListener('paste', function(event) {
        if (getComputedStyle(this).display !== 'none' && getComputedStyle(this.parentElement).display !== 'none') {
          this.textContent = event.clipboardData.getData('text/plain');
        }
      });
      document.querySelector('input').addEventListener('change', event => {
        const count = event.target.files.length;
        const progress = document.createElement('div'); progress.setAttribute('role', 'progressbar');
        document.querySelector('[role="dialog"]').appendChild(progress);
        setTimeout(() => {
          document.getElementById('media').innerHTML = '<div data-testid="tweetPhoto"></div>'.repeat(count);
          setTimeout(() => progress.remove(), 250);
        }, 250);
      });
      document.querySelector('button').addEventListener('click', () => window.submissions.push({
        count: document.getElementById('media').children.length,
        busy: Boolean(document.querySelector('[role="progressbar"]'))
      }));
    </script>
  </body></html>` });
  const column = await addXHomeColumn(page);
  const view = column.locator('webview');
  const { createSubmissionScript } = await import('../src/renderer/x-composer-submit.mjs');
  const photo = { name: 'image.png', type: 'image/png', dataUrl: 'data:image/png;base64,eA==' };
  await view.evaluate(element => new Promise(resolve => {
    if (element.dataset.ready === 'true') resolve();
    else element.addEventListener('dom-ready', resolve, { once: true });
  }));
  await view.evaluate((element, script) => element.executeJavaScript(script), createSubmissionScript({
    text: 'hello', images: [photo, photo], timeoutMs: 5000,
  }));
  assert.deepEqual(await view.evaluate(element => element.executeJavaScript('window.submissions')), [{ count: 2, busy: false }]);
});

test('conversation filter combines replies mentions and quotes and survives restart', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, { ...X_FIXTURES, useNotificationReaders: false,
    xNotifications: ['replied to you', 'mentioned you', 'quoted your post', 'liked your post'].map((action, index) => ({
      accountIndex: 0, text: `Alice ${action}`, actorName: 'Alice', profileUrl: 'https://x.com/alice',
      targetUrl: `https://x.com/alice/status/${9000 + index}`,
    })),
  });
  await page.locator('#sb-notif-b').click();
  await page.locator('.notif-center-item').first().waitFor({ state: 'visible' });
  await page.locator('#notif-center-reason').selectOption('conversation');
  assert.equal(await page.locator('.notif-center-item').count(), 3);
  assert.doesNotMatch(await page.locator('#notif-center-list').textContent(), /liked your post/);
  await page.reload();
  await page.locator('#sb-notif-b').click();
  await page.locator('.notif-center-item').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('#notif-center-reason').inputValue(), 'conversation');
  assert.equal(await page.locator('.notif-center-item').count(), 3);
});
const NOTIFICATIONS_URL = 'https://x.com/notifications';
const LIKED_POST_URL = 'https://x.com/socialdeck/status/123';
const X_AVATAR_URL = 'https://pbs.twimg.com/profile_images/alice.jpg';

const X_FIXTURES = {
  useNotificationReaders: true,
  authenticatedXPartitions: ['persist:x-0', 'persist:x-1'],
  state: {
    xs: [
      { username: '@first', initials: 'F', bg: '#334455', partition: 'persist:x-0' },
      { username: '@second', initials: 'S', bg: '#556677', partition: 'persist:x-1' },
    ],
    activeX: 0,
    b: null,
    composePreferences: { crossPostFromX: false, crossPostFromBluesky: false },
  },
};

const BLUESKY_FIXTURES = {
  state: {
    xs: [],
    activeX: 0,
    b: {
      did: 'did:plc:socialdeck',
      handle: 'socialdeck.test',
      accessJwt: 'e2e-token',
      refreshJwt: '',
      initials: 'SD',
      bg: '#336699',
    },
    composePreferences: { crossPostFromX: false, crossPostFromBluesky: false },
  },
  blueskyNotifications: [
    {
      reason: 'follow',
      uri: 'at://did:plc:alice/app.bsky.graph.follow/1',
      indexedAt: '2026-07-15T01:00:00Z',
      author: { did: 'did:plc:alice', handle: 'alice.test', displayName: 'Alice' },
    },
    {
      reason: 'follow',
      uri: 'at://did:plc:bob/app.bsky.graph.follow/2',
      indexedAt: '2026-07-15T00:00:00Z',
      author: { did: 'did:plc:bob', handle: 'bob.test', displayName: 'Bob' },
    },
  ],
};

const COMPOSE_FIXTURES = {
  authenticatedXPartitions: ['persist:x-0'],
  state: {
    xs: [
      { username: '@compose', initials: 'C', bg: '#445566', partition: 'persist:x-0' },
    ],
    activeX: 0,
    b: {
      did: 'did:plc:compose',
      handle: 'compose.test',
      accessJwt: 'e2e-token',
      refreshJwt: '',
      initials: 'CB',
      bg: '#336699',
    },
    composePreferences: { crossPostFromX: false, crossPostFromBluesky: false },
  },
};

const NEW_X_ACCOUNT_FIXTURES = {
  xPartitions: ['persist:x-0'],
  simulateXLogin: true,
  state: {
    xs: [],
    activeX: 0,
    b: null,
    composePreferences: { crossPostFromX: false, crossPostFromBluesky: false },
  },
};

const ANIME_SCHEDULE_FIXTURES = {
  state: {
    xs: [],
    activeX: 0,
    b: {
      did: 'did:plc:anime',
      handle: 'anime.test',
      accessJwt: 'e2e-token',
      refreshJwt: '',
      initials: 'AN',
      bg: '#336699',
    },
    composePreferences: { crossPostFromX: false, crossPostFromBluesky: false },
  },
  animeSchedule: {
    date: '2026-07-16',
    timezone: 'Asia/Tokyo',
    fetchedAt: '2026-07-16T00:00:00.000Z',
    items: [
      {
        id: '101:1:1',
        mediaId: 101,
        title: '朝のアニメ',
        episode: 1,
        airingAt: Date.parse('2026-07-16T01:00:00+09:00') / 1000,
        format: 'TV',
        coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/test-a.jpg',
        siteUrl: 'https://anilist.co/anime/101',
      },
      {
        id: '102:2:2',
        mediaId: 102,
        title: '夜のアニメ',
        episode: 2,
        airingAt: Date.parse('2026-07-16T23:59:00+09:00') / 1000,
        format: 'ONA',
        coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/test-b.jpg',
        siteUrl: 'https://anilist.co/anime/102',
      },
      {
        id: '103:3:3',
        mediaId: 103,
        title: '深夜のアニメ',
        episode: 3,
        airingAt: Date.parse('2026-07-17T02:30:00+09:00') / 1000,
        format: 'TV',
        coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/test-c.jpg',
        siteUrl: 'https://anilist.co/anime/103',
      },
    ],
  },
};

function xFixture(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/notifications') {
    return `<!doctype html><html><body>
      <div data-testid="cellInnerDiv">
        <a href="https://x.com/alice">Alice<img id="alice-avatar" alt="Alice" loading="lazy" src="${X_AVATAR_URL}"></a>
        <time datetime="2026-07-15T00:00:00Z"></time>
        <div role="link" onclick="location.href='${LIKED_POST_URL}'">
          <div data-testid="tweetText">Alice liked your post</div>
        </div>
      </div>
    </body></html>`;
  }
  return `<!doctype html><html><body data-e2e-path="${pathname}">Post ${pathname}</body></html>`;
}

async function launchApp(t, fixtures) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'socialdeck-e2e-'));
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [APP_ROOT, '--disable-gpu', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      SOCIALDECK_E2E: '1',
      SOCIALDECK_E2E_FIXTURES: JSON.stringify(fixtures),
    },
  });
  t.after(async () => {
    await electronApp.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  await electronApp.evaluate(async ({ session }, fixture) => {
    const intercept = (partition, network) => {
      const targetSession = partition ? session.fromPartition(partition) : session.defaultSession;
      const registered = targetSession.protocol.interceptBufferProtocol('https', (request, callback) => {
        const url = new URL(request.url);
        const allowed = network === 'x'
          ? ['x.com', 'pbs.twimg.com'].includes(url.hostname)
          : network === 'b'
            ? url.hostname === 'bsky.app'
            : network === 'api'
              ? ['bsky.social', 's4.anilist.co'].includes(url.hostname)
              : url.hostname === 'pbs.twimg.com';
        if (!allowed) return callback({ error: -3 });
        if (url.hostname === 'pbs.twimg.com' || url.hostname === 's4.anilist.co') {
          if (fixture.slowResourceDelay && url.pathname === '/slow.png') {
            setTimeout(() => callback({ mimeType: 'image/png', data: Buffer.from(fixture.avatarPng, 'base64') }), fixture.slowResourceDelay);
            return;
          }
          callback({ mimeType: 'image/png', data: Buffer.from(fixture.avatarPng, 'base64') });
          return;
        }
        if (network === 'api') {
          const body = url.pathname.endsWith('uploadBlob')
            ? '{"blob":{"ref":"e2e-blob"}}'
            : url.pathname.endsWith('createRecord')
              ? '{}'
              : url.pathname.endsWith('getUnreadCount')
                ? '{"count":0}'
                : url.pathname.endsWith('listNotifications')
                  ? '{"notifications":[]}'
                  : '{"feed":[]}';
          callback({ mimeType: 'application/json', charset: 'utf-8', data: Buffer.from(body) });
          return;
        }
        const notificationsHtml = global.__e2eNotificationHtml || (partition === 'persist:x-1'
          ? fixture.notificationsHtml
          : fixture.notificationsHtml.replaceAll('Alice', 'Other'));
        const body = network === 'x' && fixture.simulateXLogin && url.pathname !== '/i/flow/login'
          ? '<!doctype html><html><body><script>location.replace("https://x.com/i/flow/login")</script></body></html>'
          : network === 'x' && fixture.redirectNotifications && url.pathname === '/notifications' && !url.searchParams.has('ready')
            ? '<!doctype html><html><body><script>location.replace("https://x.com/notifications?ready=1")</script></body></html>'
          : network === 'x' && url.pathname === '/notifications'
            ? notificationsHtml
            : fixture.pageHtml.replaceAll('__PATH__', url.pathname);
        callback({ mimeType: 'text/html', charset: 'utf-8', data: Buffer.from(body) });
      });
      if (!registered) throw new Error('Failed to intercept test HTTPS protocol');
    };
    const tasks = fixture.xPartitions.map(partition => intercept(partition, 'x'));
    fixture.authenticatedXPartitions.forEach(partition => {
      tasks.push(session.fromPartition(partition).cookies.set({
        url: 'https://x.com/',
        name: 'auth_token',
        value: 'socialdeck-e2e',
        domain: '.x.com',
        path: '/',
        secure: true,
        sameSite: 'no_restriction',
        expirationDate: Date.now() / 1000 + 3600,
      }));
    });
    if (fixture.hasXAvatar) tasks.push(intercept('', 'avatar'));
    if (fixture.hasBluesky) {
      tasks.push(intercept('persist:bsky', 'b'));
      tasks.push(intercept('', 'api'));
    }
    await Promise.all(tasks);
  }, {
    notificationsHtml: xFixture(NOTIFICATIONS_URL),
    pageHtml: fixtures.pageHtml || `<!doctype html><html><body data-e2e-path="__PATH__">
      <nav>
        <a data-testid="AppTabBar_Home_Link" href="https://x.com/home">Home</a>
        <a data-testid="AppTabBar_Notifications_Link" href="https://x.com/notifications">Notifications</a>
      </nav>
      Page __PATH__
    </body></html>`,
    xPartitions: fixtures.xPartitions || fixtures.state.xs.map(account => account.partition),
    authenticatedXPartitions: fixtures.authenticatedXPartitions || [],
    hasXAvatar: Boolean(fixtures.useNotificationReaders),
    hasBluesky: Boolean(fixtures.state.b),
    simulateXLogin: Boolean(fixtures.simulateXLogin),
    redirectNotifications: Boolean(fixtures.redirectNotifications),
    slowResourceDelay: fixtures.slowResourceDelay || 0,
    avatarPng: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  });
  const page = await electronApp.firstWindow();
  const rendererErrors = [];
  page.on('pageerror', error => rendererErrors.push(error.message));
  t.after(() => assert.deepEqual(rendererErrors, [], 'renderer must not raise unhandled errors'));
  await page.reload();
  await page.locator('script[src="renderer.js"]').waitFor({ state: 'attached', timeout: 10000 });
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async () => {
    window.__e2eWarnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      window.__e2eWarnings.push(args.map(value => value?.message || String(value)).join(' '));
      originalWarn(...args);
    };
  });
  return { electronApp, page };
}

async function expectWebviewUrl(page, selector, expectedUrl) {
  const webview = page.locator(selector);
  const deadline = Date.now() + 10000;
  let actual = null;
  while (Date.now() < deadline) {
    actual = await webview.evaluate(element => ({
      currentUrl: element.getURL?.() || '',
      src: element.src,
    })).catch(() => null);
    if (actual && (actual.currentUrl === expectedUrl || actual.src === expectedUrl)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  actual = await webview.evaluate(element => ({
      currentUrl: element.getURL?.() || '',
      src: element.src,
      toast: document.getElementById('toast')?.textContent || '',
      warnings: window.__e2eWarnings || [],
    })).catch(() => actual || {});
  assert.equal(actual.currentUrl || actual.src, expectedUrl, JSON.stringify(actual));
}

async function openXLikeNotification(page) {
  await page.locator('#sb-notif-b').click();
  await page.locator('.notif-center-tab[data-network="x"]').click();
  const item = page.locator('.notif-center-item').filter({ hasText: 'Alice' }).first();
  try {
    await item.locator(`.av img[src="${X_AVATAR_URL}"]`).waitFor({
      state: 'attached',
      timeout: 10000,
    });
  } catch (error) {
    const diagnostics = await page.evaluate(async () => ({
      notificationText: document.getElementById('notif-center-list')?.textContent || '',
      notificationHtml: document.getElementById('notif-center-list')?.innerHTML || '',
      readers: [...document.querySelectorAll('#notif-center-x-readers webview')].map(webview => ({
        id: webview.id,
        partition: webview.partition,
        src: webview.src,
        url: webview.getURL?.() || '',
        ready: webview.dataset.ready || '',
      })),
      warnings: window.__e2eWarnings || [],
    }));
    throw new Error(`${error.message}\n${JSON.stringify(diagnostics)}`);
  }
  await item.click();
}

async function addXHomeColumn(page, accountIndex = 0) {
  await page.locator('button[data-action="open-add-column"]:visible').first().click();
  await page.locator('#addMod.on').waitFor();
  await page.locator(
    `#addMod [data-action="add-column"][data-definition-id="x-home-new"][data-account-index="${accountIndex}"]`,
  ).click();
  const column = page.locator('.col[data-definition-id="x-home-new"]').last();
  await column.waitFor({ state: 'attached' });
  return column;
}

test('X list dialog adds distinct columns for the chosen account and survives restart', async t => {
  const { page } = await launchApp(t, X_FIXTURES);
  for (const name of ['Friends', 'Friends again']) {
    await page.locator('button[data-action="open-add-column"]:visible').first().click();
    await page.locator('#addMod [data-definition-id="x-list-new"][data-account-index="1"]').click();
    await page.locator('#x-list-input').fill('https://x.com/i/lists/123');
    await page.locator('#x-list-name').fill(name);
    await page.locator('#x-list-name').press('Enter');
    await page.locator('#x-list-dialog-ov').waitFor({ state: 'detached' });
  }
  const columns = page.locator('.col[data-definition-id="x-list-new"]');
  assert.equal(await columns.count(), 2);
  const ids = await columns.evaluateAll(elements => elements.map(element => element.id));
  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(await columns.locator('webview').evaluateAll(elements => elements.map(element => element.partition)), ['persist:x-1', 'persist:x-1']);
  await page.reload();
  await page.locator('#app').waitFor({ state: 'visible' });
  assert.deepEqual(await columns.locator('.col-title').allTextContents(), ['Friends', 'Friends again']);
});

test('X like notifications open inside the center without creating a column', async t => {
  const { page } = await launchApp(t, X_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await openXLikeNotification(page);
  const webview = page.locator('#notif-reply-host webview');
  assert.equal(await webview.getAttribute('partition'), 'persist:x-1');
  let url = '';
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    url = await webview.evaluate(el => el.getURL()).catch(() => '');
    if (url === LIKED_POST_URL) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(url, LIKED_POST_URL);
  assert.equal(await page.locator('.col[data-definition-id="x-notif-new"]').count(), 0);
  assert.equal(await page.locator('#notifCenterMod').evaluate(el => el.classList.contains('on')), true);
  await page.locator('#notif-reply-back').click();
  await page.locator('.notif-center-item').first().waitFor({ state: 'visible' });
});

test('X detail diagnostic captures waiting and rendered states in the real preload', { timeout: 20000 }, async t => {
  const { page, electronApp } = await launchApp(t, { ...X_FIXTURES, useNotificationReaders: false,
    xNotifications: [{ accountIndex: 0, text: 'Alice replied', actorName: 'Alice', profileUrl: 'https://x.com/alice', targetUrl: 'https://x.com/alice/status/789' }],
  });
  await page.locator('#sb-notif-b').click();
  await page.locator('.notif-center-item').first().click();
  const view = page.locator('#notif-reply-host webview');
  const diagnosticPath = await electronApp.evaluate(({ app }) => app.getPath('userData'));
  async function waitForPhase(phase) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      let found = false;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(diagnosticPath, 'x-page-diagnostics.json'), 'utf8'));
        found = data.events.some(event => event.type === 'page' && event.phase === phase);
      } catch {}
      if (found) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`missing ${phase} diagnostic`);
  }
  await waitForPhase('waiting');
  await view.evaluate(el => el.executeJavaScript('document.body.innerHTML = \'<article data-testid="tweet"><a href="/alice/status/789">Post loaded</a></article>\''));
  await waitForPhase('visible');
});

test('post content becomes visible before a slow image finishes during column reload', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, { ...X_FIXTURES, slowResourceDelay: 4000,
    pageHtml: '<!doctype html><html><body><article>本文は準備済み</article><img src="https://pbs.twimg.com/slow.png"></body></html>',
  });
  const column = await addXHomeColumn(page);
  const id = (await column.getAttribute('id')).replace(/^col-/, '');
  const webview = column.locator('webview');
  await webview.evaluate(el => new Promise(resolve => {
    if (el.dataset.ready === 'true' && !el.isLoading()) resolve();
    else el.addEventListener('did-stop-loading', resolve, { once: true });
  }));
  await webview.evaluate(el => el.loadURL('https://x.com/alice/status/123'));
  const ready = await page.evaluate(async id => {
    const view = document.getElementById(`wv-${id}`);
    const started = performance.now();
    const ready = new Promise(resolve => view.addEventListener('dom-ready', () => resolve({
      opacity: view.style.opacity, overlay: document.getElementById(`wvov-${id}`).style.display,
      loading: view.isLoading(), elapsed: performance.now() - started,
    }), { once: true }));
    await (await import('./renderer.js')).xWebViewRuntime.reload(id);
    return ready;
  }, id);
  assert.equal(ready.loading, true, 'the image is still loading but the document is ready');
  assert.ok(ready.elapsed < 3000, JSON.stringify(ready));
  assert.notEqual(ready.opacity, '0');
  assert.equal(ready.overlay, 'none');
});

test('X Column refresh preserves an open reply composer', async t => {
  const { page } = await launchApp(t, X_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });
  const column = await addXHomeColumn(page);
  const webview = column.locator('webview');
  await webview.waitFor({ state: 'attached' });
  await webview.evaluate(element => element.executeJavaScript(`
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="dialog"><div data-testid="tweetTextarea_0">reply in progress</div></div>'
    );
  `));

  await column.locator('button[id^="rfr-"]').click();
  await new Promise(resolve => setTimeout(resolve, 250));

  assert.equal(await webview.evaluate(element => element.executeJavaScript(
    'Boolean(document.querySelector(\'[role="dialog"] [data-testid^="tweetTextarea_"]\'))',
  )), true);
});

test('new X accounts use one login WebView and default to the black theme', async t => {
  const { electronApp, page } = await launchApp(t, NEW_X_ACCOUNT_FIXTURES);
  await page.locator('#login-screen').waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    localStorage.setItem('socialdeck_cols', JSON.stringify([
      { kind: 'wv', network: 'x', definitionId: 'x-home-new', id: 'login-home', url: 'https://x.com/home', partition: 'persist:x-0' },
      { kind: 'wv', network: 'x', definitionId: 'x-notif-new', id: 'login-notifications', url: 'https://x.com/notifications', partition: 'persist:x-0' },
      { kind: 'wv', network: 'x', definitionId: 'x-search-new', id: 'login-search', url: 'https://x.com/search', partition: 'persist:x-0' },
    ]));
  });

  await page.locator('#x-user').fill('new-account');
  await page.locator('#x-login-btn').click();
  try {
    await page.locator('#app').waitFor({ state: 'visible' });
  } catch (error) {
    const diagnostics = await page.evaluate(async () => ({
      snapshot: typeof (await import('./renderer.js')).accountSessionRuntime !== 'undefined'
        ? (await import('./renderer.js')).accountSessionRuntime.getSnapshot()
        : null,
      input: document.getElementById('x-user')?.value || '',
      loginDisabled: document.getElementById('x-login-btn')?.disabled,
      loginError: document.getElementById('x-err')?.textContent || '',
      appDisplay: document.getElementById('app')?.style.display || '',
      loginHidden: document.getElementById('login-screen')?.classList.contains('hidden'),
      persistedState: localStorage.getItem('socialdeck_state'),
      warnings: window.__e2eWarnings || [],
    }));
    throw new Error(`${error.message}\n${JSON.stringify(diagnostics)}`);
  }
  await page.locator('webview[data-sd-login-parked="true"]').nth(1).waitFor({ state: 'attached' });
  const loginDeadline = Date.now() + 10000;
  while (Date.now() < loginDeadline) {
    const hasLoginView = await page.locator('.col[data-network="x"] webview').evaluateAll(webviews =>
      webviews.some(webview => {
        try { return webview.getURL().includes('/i/flow/login'); } catch { return false; }
      })
    );
    if (hasLoginView) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const loginWebViews = await page.locator('.col[data-network="x"] webview').evaluateAll(webviews =>
    webviews.map(webview => ({
      parked: webview.dataset.sdLoginParked,
      url: (() => {
        try {
          return webview.getURL();
        } catch {
          return '';
        }
      })(),
    }))
  );
  assert.equal(loginWebViews.filter(webview => webview.parked === 'true').length, 2);
  assert.equal(loginWebViews.filter(webview => webview.url.includes('/i/flow/login')).length, 1);

  const cookies = await electronApp.evaluate(({ session }) =>
    session.fromPartition('persist:x-0').cookies.get({
      url: 'https://x.com/',
      name: 'night_mode',
    })
  );
  assert.equal(cookies[0]?.value, '2');
});

test('Bluesky follow notifications open profiles inside the notification center', async t => {
  const { page } = await launchApp(t, BLUESKY_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await page.locator('[data-action="toggle-app-menu"][data-target-id="am-app"]').click();
  await page.locator('[data-action="open-about"]').click();
  await page.locator('#aboutMod.on').waitFor();
  assert.equal(await page.locator('#about-version').textContent(), `Version ${appVersion}`);
  await page.locator('#about-close-btn').click();

  await page.locator('#sb-notif-b').click();
  await page.locator('.notif-center-tab[data-network="b"]').click();
  await page.locator('.notif-center-item').nth(0).click();

  const webviewSelector = '#notif-reply-host webview';
  assert.equal(await page.locator(webviewSelector).getAttribute('partition'), 'persist:bsky');
  await expectWebviewUrl(page, webviewSelector, 'https://bsky.app/profile/did%3Aplc%3Aalice');

  await page.locator('#notif-reply-back').click();
  await page.locator('.notif-center-tab[data-network="b"]').click();
  await page.locator('.notif-center-item').nth(1).click();

  await expectWebviewUrl(page, webviewSelector, 'https://bsky.app/profile/did%3Aplc%3Abob');
  assert.equal(await page.locator('.col[data-definition-id="b-profile"]').count(), 0);
});

test('desktop notification rules persist through the settings modal', async t => {
  const { page } = await launchApp(t, BLUESKY_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await page.locator('[data-action="open-settings"]').click();
  await page.locator('#desktop-notif-settings-btn').click();
  await page.locator('#desktopNotifSettingsMod.on').waitFor();
  await page.locator('#desktop-notif-enabled').check();
  await page.locator('[data-desktop-notification-reason="like"]').check();
  await page.locator('#desktop-notif-users').fill('@alice.test');
  await page.locator('#desktop-notif-keywords').fill('release, 配信');
  await page.locator('[data-desktop-notification-action="save"]').click();
  await page.locator('#desktopNotifSettingsMod').waitFor({ state: 'hidden' });

  const persisted = await page.evaluate(async () =>
    JSON.parse(localStorage.getItem('socialdeck_desktop_notification_rules'))
  );
  assert.equal(persisted.rules.enabled, true);
  assert.equal(persisted.rules.reasons.like, true);
  assert.deepEqual(persisted.rules.users, ['alice.test']);
  assert.deepEqual(persisted.rules.keywords, ['release', '配信']);

  await page.locator('#desktop-notif-settings-btn').click();
  await page.locator('#desktopNotifSettingsMod.on').waitFor();
  assert.equal(await page.locator('#desktop-notif-enabled').isChecked(), true);
  assert.equal(await page.locator('#desktop-notif-users').inputValue(), 'alice.test');
});

test('strict CSP boots with delegated shell actions and no production DevTools', async t => {
  const { page } = await launchApp(t, COMPOSE_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  assert.equal(await page.locator('.dev-only').count(), 0);
  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.load('12px "Noto Sans JP"');
    return document.fonts.check('12px "Noto Sans JP"');
  });
  assert.equal(fontLoaded, true, 'the bundled Noto Sans JP font must load under strict CSP');
  await page.locator('button[data-action="open-add-column"]:visible').first().click();
  await page.locator('#addMod.on').waitFor();
  await page.locator('#addMod [data-action="close-overlay"]').evaluate(element => element.click());
  await page.locator('#addMod').waitFor({ state: 'hidden' });

  await page.locator('[data-action="toggle-app-menu"][data-target-id="am-app"]').click();
  await page.locator('[data-action="open-about"]').click();
  await page.locator('#aboutMod.on').waitFor();
  await page.locator('#about-close-btn').click();
  await page.locator('#aboutMod').waitFor({ state: 'hidden' });
});

test('memory management reports process usage and performs a manual cleanup', async t => {
  const { page } = await launchApp(t, COMPOSE_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await page.locator('[data-action="open-settings"]').click();
  await page.locator('[data-action="open-memory-settings"]').click();
  await page.locator('#mem-settings-ov.on').waitFor();
  await page.locator('#memory-metrics strong').waitFor();
  assert.match(await page.locator('#memory-metrics').textContent(), /MB/);
  assert.match(await page.locator('#memory-metrics').textContent(), /X WebView/);

  const cleanupButton = page.locator('[data-action="clear-memory-now"]');
  await cleanupButton.click();
  await page.locator('#toast').filter({ hasText: 'メモリを整理しました' }).waitFor();
  assert.equal(await cleanupButton.isEnabled(), true);
});

test('legacy Bluesky credentials migrate out of Workspace State into the Vault', async t => {
  const { page } = await launchApp(t, COMPOSE_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  const result = await page.evaluate(async () => ({
    workspaceState: localStorage.getItem('socialdeck_v4') || '',
    vaultSession: await window.electronAPI.loadBlueskySession(),
  }));

  assert.equal(result.workspaceState.includes('e2e-token'), false);
  assert.equal(result.workspaceState.includes('accessJwt'), false);
  assert.equal(result.workspaceState.includes('refreshJwt'), false);
  assert.deepEqual(result.vaultSession, {
    handle: 'compose.test',
    did: 'did:plc:compose',
  });
  assert.equal(JSON.stringify(result.vaultSession).includes('token'), false);
});

test('Compose Experience retains media and executes Bluesky delivery through its Adapter', async t => {
  const { page } = await launchApp(t, COMPOSE_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await page.locator('#sb-post-x').click();
  await page.locator('#x-img-file').setInputFiles({
    name: 'x-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from('x-image'),
  });
  await page.locator('#x-alt-0').fill('X image description');
  assert.equal(await page.locator('#x-sndb').isEnabled(), true);
  await page.locator('#xPostMod [data-compose-action="toggle-preview"]').click();
  assert.match(await page.locator('#x-compose-preview').textContent(), /画像 1枚 \/ ALT入力 1枚/);
  await page.locator('#xPostMod [data-compose-action="close"]').click();
  await page.locator('#sb-post-x').click();
  assert.equal(await page.locator('#x-alt-0').inputValue(), 'X image description');
  await page.locator('#xPostMod [data-compose-action="close"]').click();

  await page.locator('#sb-post-b').click();
  await page.locator('#b-img-file').setInputFiles({
    name: 'b-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from('b-image'),
  });
  await page.locator('#b-alt-0').fill('Bluesky image description');
  assert.equal(await page.locator('#sndb').isEnabled(), true);
  await page.locator('#compMod [data-compose-action="toggle-preview"]').click();
  assert.match(await page.locator('#b-compose-preview').textContent(), /画像 1枚 \/ ALT入力 1枚/);
  await page.locator('#sndb').click();
  await page.locator('#compMod').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#b-img-preview').textContent(), '');
});

test('polish journey restores drafts, previews density and opens column actions', async t => {
  const { page } = await launchApp(t, COMPOSE_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });
  await page.locator('#sb-post-b').click();
  await page.locator('#cta').fill('自動保存の確認です。');
  await page.locator('#compMod [data-compose-action="close"]').click();
  await page.reload();
  await page.locator('#app').waitFor({ state: 'visible' });
  await page.locator('#sb-post-b').click();
  assert.equal(await page.locator('#cta').inputValue(), '自動保存の確認です。');
  await page.locator('#compMod [data-compose-action="close"]').click();

  await page.locator('[data-action="open-settings"]').click();
  await page.locator('#settingsMod [data-action="open-appearance-settings"]').click();
  await page.locator('[data-density="comfortable"]').click();
  assert.equal(await page.locator('html').getAttribute('data-density'), 'comfortable');
  await page.locator('[data-action="save-appearance"]').click();
  assert.equal(await page.evaluate(async () => JSON.parse(localStorage.getItem('socialdeck_v4')).appearance.density), 'comfortable');
  await page.locator('#desktop-notif-settings-btn').click();
  assert.equal(await page.locator('.desktop-notif-label').first().evaluate(element => getComputedStyle(element).fontSize), '15px');
  await page.locator('[data-desktop-notification-action="close"]').click();
  if (process.env.SOCIALDECK_POLISH_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SOCIALDECK_POLISH_SCREENSHOTS, 'settings.png') });
  await page.locator('#settingsMod [data-action="close-overlay"]').click();

  const column = await addXHomeColumn(page);
  assert.equal(await column.locator('[data-shell-action="settings"]').isVisible(), false);
  await column.locator('[data-shell-action="more"]').click();
  assert.equal(await column.locator('[data-shell-action="settings"]').isVisible(), true);
  if (process.env.SOCIALDECK_POLISH_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SOCIALDECK_POLISH_SCREENSHOTS, 'column-menu.png') });
  await column.locator('[data-shell-action="settings"]').click();
  await page.locator('#col-settings-ov.on').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#sb-post-b').click();
  if (process.env.SOCIALDECK_POLISH_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SOCIALDECK_POLISH_SCREENSHOTS, 'compose.png') });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#compMod [data-compose-action="discard"]').click();
  await page.reload();
  await page.locator('#sb-post-b').click();
  assert.equal(await page.locator('#cta').inputValue(), '');
});

test('video Compose exposes precise trim controls and MP4 cross-posting', async t => {
  const { page } = await launchApp(t, COMPOSE_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await page.locator('#sb-post-x').click();
  await page.locator('#x-img-file').setInputFiles({
    name: 'shared.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('e2e-video-placeholder'),
  });
  await page.locator('#x-video-wrap').waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    const video = document.getElementById('x-video-preview');
    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    video.dispatchEvent(new Event('loadedmetadata'));
  });

  assert.equal(await page.locator('#x-cross-post-b').isEnabled(), true);
  assert.match(await page.locator('#x-cross-post-note').textContent(), /同じトリム範囲/);
  await page.locator('#x-trim-start-input').fill('0:10.5');
  await page.locator('#x-trim-start-input').press('Tab');
  assert.equal(await page.locator('#x-trim-start-label').textContent(), '0:10.5');
  assert.equal(await page.locator('#x-trim-timeline .trim-range').count(), 2);
  assert.equal(await page.locator('[data-compose-action="preview-trim"]').first().isVisible(), true);
});

test('anime schedule Column can be added and persisted from the picker', async t => {
  const { page } = await launchApp(t, ANIME_SCHEDULE_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await page.locator('[data-action="open-add-column"]:visible').first().click();
  await page.locator('.opt').filter({ hasText: '本日のアニメ' }).click();

  const column = page.locator('.col[data-definition-id="anime-today"]');
  await column.waitFor();
  await column.locator('.anime-item').nth(2).waitFor();
  assert.equal(await column.locator('.anime-item').count(), 3);
  assert.match(await column.locator('.col-sub').textContent(), /7月16日（木） · 3作品/);
  assert.match(await column.locator('.anime-item').nth(1).textContent(), /夜のアニメ/);
  assert.match(await column.locator('.anime-item').nth(1).textContent(), /第2話/);
  assert.match(await column.locator('.anime-item').nth(2).textContent(), /26:30/);
  assert.match(await column.locator('.anime-item').nth(2).textContent(), /深夜のアニメ/);
  assert.equal(await column.locator('.anime-cover img').count(), 3);

  const stored = await page.evaluate(async () => JSON.parse(localStorage.getItem('socialdeck_cols')));
  const schedule = stored.find(item => item.definitionId === 'anime-today');
  assert.equal(schedule.kind, 'schedule');
  assert.equal(schedule.network, 'anime');
  assert.equal(schedule.interval, 300000);

  await page.reload();
  await page.locator('#app').waitFor({ state: 'visible' });
  const restored = page.locator('.col[data-definition-id="anime-today"]');
  await restored.locator('.anime-item').nth(2).waitFor();
  assert.equal(await restored.count(), 1);
  assert.equal(await restored.locator('.anime-item').count(), 3);

  if (process.env.SOCIALDECK_E2E_SCREENSHOT) {
    await page.screenshot({ path: process.env.SOCIALDECK_E2E_SCREENSHOT });
  }
});

test('X replies show a toast and remain unread until the conversation opens', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, { ...X_FIXTURES, useNotificationReaders: false, xNotifications: [] });
  await page.evaluate(async () => {
    await (await import('./renderer.js')).notificationCenterRuntime.reload();
    (await import('./renderer.js')).replyNotificationRuntime.observe([(await import('./renderer.js')).notificationCenter.normalizeXNotification({ text: 'Alice replied: Hello!', actorName: 'Alice', profileUrl: 'https://x.com/alice', targetUrl: 'https://x.com/socialdeck/status/123' }, { account: (await import('./renderer.js')).state.xs[0], accountIndex: 0 })], (await import('./renderer.js')).state.xs[0], 0);
    await (await import('./renderer.js')).notificationCenterRuntime.reload();
  });
  await page.locator('#reply-toast').waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await page.locator('#bsky-notif-badge').textContent(), '1');
  await page.locator('#reply-toast-close').click();
  assert.equal(await page.locator('#bsky-notif-badge').textContent(), '1');
  assert.equal(await page.locator('#sb-notif-icons > button').count(), 1);
  await page.locator('#sb-notif-b').click();
  const item = page.locator('.notif-center-item.unread').filter({ hasText: 'Alice' });
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await page.locator('#bsky-notif-badge').waitFor({ state: 'hidden', timeout: 5000 }).catch(async error => { throw new Error(error.message + JSON.stringify(await page.evaluate(async () => ({ toast: document.getElementById('toast').textContent, warnings: window.__e2eWarnings, unread: (await import('./renderer.js')).replyNotificationRuntime.unreadItems() })))); });
});

test('notification center shows the conversation in the correct account and retains the reply draft', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, {
    ...X_FIXTURES, useNotificationReaders: false,
    pageHtml: '<!doctype html><html><body><main><article>親の投稿</article><article>通知の対象投稿</article><textarea aria-label="返信"></textarea><article>続きの返信</article></main></body></html>',
    xNotifications: [{ accountIndex: 1, text: 'Alice replied: Hello!', actorName: 'Alice',
      profileUrl: 'https://x.com/alice', targetUrl: 'https://x.com/alice/status/456' }],
  });
  await page.locator('#sb-notif-b').click();
  const button = page.locator('[data-notification-reply]').first();
  await button.waitFor({ state: 'visible', timeout: 5000 });
  await button.click();
  await page.locator('#notif-reply-panel').waitFor({ state: 'visible', timeout: 5000 });
  const composer = page.locator('#notif-reply-host webview');
  assert.equal(await composer.getAttribute('partition'), 'persist:x-1');
  assert.equal(await composer.getAttribute('src'), 'https://x.com/alice/status/456');
  assert.match(await page.locator('#notif-reply-title').textContent(), /@second/);
  assert.equal(await page.locator('#notifCenterMod').evaluate(el => el.classList.contains('on')), true);
  let conversation = '';
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    conversation = await composer.evaluate(el => el.executeJavaScript('document.body.innerText')).catch(() => '');
    if (conversation.includes('続きの返信')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.match(conversation, /親の投稿/);
  assert.match(conversation, /通知の対象投稿/);
  assert.match(conversation, /続きの返信/);
  await composer.evaluate(el => el.executeJavaScript('document.querySelector("textarea").value = "入力中の返信"'));
  await composer.evaluate(el => { el.dataset.retained = 'yes'; });
  await page.locator('#notif-reply-back').click();
  await button.click();
  assert.equal(await composer.getAttribute('data-retained'), 'yes');
  assert.equal(await composer.evaluate(el => el.executeJavaScript('document.querySelector("textarea").value')), '入力中の返信');
  assert.equal(await page.locator('#sb-notif-icons > button').count(), 1);
});

test('X reply read buttons clear individual and all unread replies without navigation', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, { ...X_FIXTURES, useNotificationReaders: false, xNotifications: [] });
  await page.evaluate(async () => {
    await (await import('./renderer.js')).notificationCenterRuntime.reload();
    const account = (await import('./renderer.js')).state.xs[0];
    const { notificationCenter } = await import('./renderer.js');
    (await import('./renderer.js')).replyNotificationRuntime.observe([123, 456].map(id => notificationCenter.normalizeXNotification({
      text: 'Alice replied: Hello!', actorName: 'Alice', profileUrl: 'https://x.com/alice',
      targetUrl: `https://x.com/alice/status/${id}`,
    }, { account, accountIndex: 0 })), account, 0);
    await (await import('./renderer.js')).notificationCenterRuntime.reload();
  });
  await page.locator('#sb-notif-b').click();
  await page.locator('[data-notification-read]').first().click();
  assert.equal(await page.locator('#bsky-notif-badge').textContent(), '1');
  assert.equal(await page.locator('#notifCenterMod').evaluate(el => el.classList.contains('on')), true);
  await page.locator('[data-notification-action="mark-x-read"]').click();
  await page.locator('#bsky-notif-badge').waitFor({ state: 'hidden', timeout: 5000 });
  await page.evaluate(async () => (await import('./renderer.js')).notificationCenterRuntime.reload());
  assert.equal(await page.locator('[data-notification-read]').count(), 0);
  assert.equal(await page.evaluate(async () => (await import('./renderer.js')).replyNotificationRuntime.unreadItems().length), 0);
});

test('fetches X notifications at startup with the notification center and Columns closed', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, X_FIXTURES);
  const deadline = Date.now() + 10000;
  let received = false;
  while (Date.now() < deadline) {
    received = await page.evaluate(async () => (await import('./renderer.js')).notificationCenterRuntime.getAllItems().some(item => item.networkId === 'x'));
    if (received) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(received, true);
  assert.equal(await page.locator('.col[data-definition-id="x-notif-new"]').count(), 0);
  assert.equal(await page.locator('#notifCenterMod').evaluate(el => el.classList.contains('on')), false);
  assert.equal(await page.evaluate(async () => (await import('./renderer.js')).desktopNotificationRuntime.getSnapshot().rules.enabled), false);
});

test('X notification extraction survives a client redirect without aborted navigation', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, { ...X_FIXTURES, redirectNotifications: true });
  const result = await page.evaluate(async () => {
    const outcome = await (await import('./renderer.js')).notificationCenterRuntime.reload();
    return { errors: outcome.snapshot.xErrors, count: outcome.snapshot.items.filter(item => item.networkId === 'x').length };
  });
  assert.deepEqual(result.errors, []);
  assert.ok(result.count > 0);
  const repeated = await page.evaluate(async () => {
    await (await import('./renderer.js')).desktopNotificationRuntime.updateRules({ enabled: true });
    const outcomes = [];
    for (let count = 0; count < 2; count++) {
      outcomes.push(await (await import('./renderer.js')).desktopNotificationRuntime.poll());
    }
    return { statuses: outcomes.map(outcome => outcome.status),
      count: (await import('./renderer.js')).notificationCenterRuntime.getAllItems().filter(item => item.networkId === 'x').length };
  });
  assert.deepEqual(repeated.statuses, ['succeeded', 'succeeded']);
  assert.ok(repeated.count > 0);
});

test('notification account choices are saved and restored after renderer restart', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, { ...X_FIXTURES, useNotificationReaders: false, xNotifications: [] });
  await page.locator('#sb-notif-b').click();
  await page.locator('#notif-center-settings summary').click();
  await page.locator('[data-fetch-account="0"]').uncheck();
  assert.match(await page.locator('.notif-fetch-account').first().textContent(), /取得オフ/);
  const saved = await page.evaluate(async () => JSON.parse(localStorage.getItem('socialdeck_notification_accounts_v1')));
  assert.equal(saved['persist:x-0'], false);
  await page.reload();
  await page.locator('#sb-notif-b').click();
  await page.locator('#notif-center-settings summary').click();
  assert.equal(await page.locator('[data-fetch-account="0"]').isChecked(), false);
  assert.equal(await page.locator('[data-fetch-account="1"]').isChecked(), true);
  await page.locator('[data-fetch-account="0"]').check();
  assert.equal(await page.locator('[data-fetch-account="0"]').isChecked(), true);
});

test('notification center shows account errors while keeping cached rows and supports retry', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, X_FIXTURES);
  await page.locator('#sb-notif-b').click();
  await page.locator('.notif-center-item').first().waitFor({ state: 'visible', timeout: 10000 });
  const before = await page.locator('.notif-center-item').count();
  await page.evaluate(async () => {
    window.__savedNotificationReader = (await import('./renderer.js')).xWebViewRuntime.listNotifications;
    (await import('./renderer.js')).xWebViewRuntime.listNotifications = async options => {
      if (options.accountId === '@first') throw new Error('test account offline');
      return window.__savedNotificationReader(options);
    };
    await (await import('./renderer.js')).notificationCenterRuntime.reload();
  });
  assert.equal(await page.locator('.notif-center-item').count(), before);
  assert.match(await page.locator('.notif-fetch-account').first().textContent(), /取得失敗.*最終取得.*test account offline/);
  await page.evaluate(async () => { (await import('./renderer.js')).xWebViewRuntime.listNotifications = window.__savedNotificationReader; });
  assert.match(await page.locator('#notif-center-health').textContent(), /1アカウントを確認/);
  await page.locator('#notif-center-settings summary').click();
  await page.locator('[data-fetch-retry="0"]').click();
  await page.locator('.notif-fetch-account').first().filter({ hasText: '取得済み' }).waitFor({ state: 'visible', timeout: 10000 });
  assert.doesNotMatch(await page.locator('.notif-fetch-account').first().textContent(), /test account offline/);
});

test('closed notification center receives replies and likes through the real background timer', { timeout: 45000 }, async t => {
  const { page, electronApp } = await launchApp(t, { ...X_FIXTURES,
    state: { ...X_FIXTURES.state, xs: [X_FIXTURES.state.xs[0]] },
  });
  const baselineDeadline = Date.now() + 10000;
  while (Date.now() < baselineDeadline) {
    if (await page.evaluate(async () => (await import('./renderer.js')).notificationCenterRuntime.getAllItems().length > 0)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(await page.evaluate(async () => (await import('./renderer.js')).notificationCenterRuntime.getAllItems().length > 0));
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await electronApp.evaluate(() => {
    global.__e2eNotificationHtml = `<!doctype html><html><body>
      <div data-testid="cellInnerDiv"><a href="https://x.com/carol">Carol</a><a href="https://x.com/carol/status/501">Carol replied to you</a></div>
      <div data-testid="cellInnerDiv"><a href="https://x.com/dave">Dave</a><a href="https://x.com/socialdeck/status/502">Dave liked your post</a></div>
    </body></html>`;
  });
  await page.locator('#bsky-notif-badge').waitFor({ state: 'visible', timeout: 35000 });
  assert.equal(await page.locator('#bsky-notif-badge').textContent(), '2');
  assert.equal(await page.locator('#notifCenterMod').evaluate(el => el.classList.contains('on')), false);
  assert.equal(await page.locator('.col[data-definition-id="x-notif-new"]').count(), 0);
  await page.locator('#reply-toast').waitFor({ state: 'visible', timeout: 2000 });
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await page.locator('#reply-toast-content').click();
  await page.locator('#notifCenterMod.on').waitFor({ state: 'visible', timeout: 2000 });
  assert.equal(await page.locator('.notif-center-item.unread').count(), 2);
});

test('unread filter survives closing and app reload and unchanged refresh keeps rows', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, { ...X_FIXTURES, useNotificationReaders: false,
    xNotifications: [{ accountIndex: 0, text: 'Alice replied: hello', actorName: 'Alice', profileUrl: 'https://x.com/alice', targetUrl: 'https://x.com/alice/status/999' }],
  });
  await page.locator('#sb-notif-b').click();
  await page.locator('.notif-center-item').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.notif-center-item').first().evaluate(element => { element.dataset.preserved = 'yes'; });
  await page.evaluate(async () => (await import('./renderer.js')).notificationCenterRuntime.reload());
  assert.equal(await page.locator('.notif-center-item').first().getAttribute('data-preserved'), 'yes');
  await page.locator('#notif-center-unread').check();
  await page.locator('#notifCenterMod [data-notification-action="close"]').click();
  await page.locator('#sb-notif-b').click();
  assert.equal(await page.locator('#notif-center-unread').isChecked(), true);
  await page.reload();
  await page.locator('#sb-notif-b').click();
  assert.equal(await page.locator('#notif-center-unread').isChecked(), true);
  await page.locator('#notif-center-unread').uncheck();
  await page.locator('#notifCenterMod [data-notification-action="close"]').click();
  await page.locator('#sb-notif-b').click();
  assert.equal(await page.locator('#notif-center-unread').isChecked(), false);
});

test('notification search and pagination keep actions bound to the matching account and post', { timeout: 20000 }, async t => {
  const { page } = await launchApp(t, { ...X_FIXTURES, useNotificationReaders: false,
    xNotifications: Array.from({ length: 125 }, (_, index) => ({ accountIndex: index === 100 ? 1 : 0,
      text: `Alice replied: message ${index}`, actorName: 'Alice', profileUrl: 'https://x.com/alice',
      targetUrl: `https://x.com/alice/status/${1000 + index}` })),
  });
  await page.locator('#sb-notif-b').click();
  await page.locator('.notif-center-item').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('#notif-center-settings').evaluate(el => el.open), false);
  assert.equal(await page.locator('.notif-center-item').count(), 60);
  await page.locator('[data-notification-action="more"]').click();
  assert.equal(await page.locator('.notif-center-item').count(), 120);
  await page.locator('[data-notification-action="more"]').click();
  assert.equal(await page.locator('.notif-center-item').count(), 125);
  await page.locator('#notif-center-search').fill('ＭＥＳＳＡＧＥ 100 @second');
  assert.equal(await page.locator('.notif-center-item').count(), 1);
  assert.match(await page.locator('.notif-center-meta').textContent(), /@second/);
  await page.locator('[data-notification-reply]').click();
  assert.equal(await page.locator('#notif-reply-host webview').getAttribute('partition'), 'persist:x-1');
  assert.equal(await page.locator('#notif-reply-host webview').getAttribute('src'), 'https://x.com/alice/status/1100');
  await page.locator('#notif-reply-back').click();
  await page.locator('#notif-center-search').fill('nothing-matches-this');
  assert.match(await page.locator('.notif-center-state').textContent(), /検索に一致/);
  await page.evaluate(async () => (await import('./renderer.js')).notificationCenterRuntime.open({ network: 'x' }));
  assert.equal(await page.locator('#notif-center-search').inputValue(), '');
  assert.equal(await page.locator('.notif-center-item').count(), 60);
  if (process.env.SOCIALDECK_NOTIFICATION_PREVIEW) {
    await page.locator('#notifCenterMod').screenshot({ path: process.env.SOCIALDECK_NOTIFICATION_PREVIEW });
  }
});

test('column reorder persists in both directions and restores after reload', async t => {
  const { page } = await launchApp(t, BLUESKY_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });
  const titles = () => page.locator('#cols > .col .col-title').allTextContents();
  const original = await titles();
  assert.equal(original.length, 2);
  const move = () => page.evaluate(async () => {
    const columns = [...document.querySelectorAll('#cols > .col')];
    const dataTransfer = new DataTransfer();
    const fire = (target, type) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    fire(columns[0].querySelector('[data-column-drag-handle]'), 'dragstart');
    fire(columns[1], 'dragover');
    fire(columns[1], 'drop');
    fire(columns[0], 'dragend');
  });
  await move();
  assert.deepEqual(await titles(), [...original].reverse());
  assert.equal(await page.locator('.col-drag-shield,.drag-over').count(), 0);
  await page.reload();
  await page.locator('#app').waitFor({ state: 'visible' });
  assert.deepEqual(await titles(), [...original].reverse());
  // Move the last column back before the first one.
  await page.evaluate(async () => {
    const columns = [...document.querySelectorAll('#cols > .col')];
    const dataTransfer = new DataTransfer();
    columns[1].querySelector('[data-column-drag-handle]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    columns[0].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
  });
  assert.deepEqual(await titles(), original);
  await page.reload();
  await page.locator('#app').waitFor({ state: 'visible' });
  assert.deepEqual(await titles(), original);
});

test('column reorder ignores external drags and cleans up cancellation and disposal', async t => {
  const { page } = await launchApp(t, BLUESKY_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });
  const result = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="col"><div data-column-drag-handle><button>Action</button></div></div><div class="col"></div>';
    document.body.appendChild(host);
    const frames = [];
    let changes = 0;
    const runtime = window.SocialDeckColumnReorderRuntime.createColumnReorderRuntime({
      container: host, requestFrame: callback => frames.push(callback), onReorder: () => changes++,
    });
    runtime.attach();
    runtime.attach();
    const [first, second] = host.children;
    const handle = first.firstElementChild;
    const fire = (target, type) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    const externalAllowed = fire(second, 'dragover');
    fire(second, 'drop');
    const externalMarked = second.classList.contains('drag-over');
    fire(handle.firstElementChild, 'dragstart');
    const buttonStarted = runtime.isDragging();
    fire(handle, 'dragstart');
    fire(second, 'dragover');
    fire(handle, 'dragend');
    frames.splice(0).forEach(callback => callback());
    const cancelledClean = !runtime.isDragging() && first.style.opacity === '' && !host.querySelector('.col-drag-shield,.drag-over');
    fire(handle, 'dragstart');
    fire(second, 'dragover');
    runtime.dispose();
    frames.splice(0).forEach(callback => callback());
    const disposedClean = !runtime.isDragging() && first.style.opacity === '' && !host.querySelector('.col-drag-shield,.drag-over');
    fire(handle, 'dragstart');
    const restartedAfterDispose = runtime.isDragging();
    host.remove();
    return { externalAllowed, externalMarked, buttonStarted, cancelledClean, disposedClean, restartedAfterDispose, changes };
  });
  assert.deepEqual(result, {
    externalAllowed: true, externalMarked: false, buttonStarted: false,
    cancelledClean: true, disposedClean: true, restartedAfterDispose: false, changes: 0,
  });
});

test('deleted column undo restores position width collapse interval and font after reload', async t => {
  const { page } = await launchApp(t, BLUESKY_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    (await import('./renderer.js')).columnShellRuntime.applyWidth('b-home', '410px');
    (await import('./renderer.js')).columnShellRuntime.setCollapsed('b-home', true);
    (await import('./renderer.js')).columnLifecycle.setRefreshInterval('b-home', 120000);
    localStorage.setItem('col_fs_b-home', '16');
    (await import('./renderer.js')).columnLifecycle.persist();
    (await import('./renderer.js')).removeCol('b-home');
  });
  assert.equal(await page.locator('#col-b-home').count(), 0);
  await page.locator('#column-undo [data-action="undo-column"]').click();
  assert.equal(await page.locator('#column-undo').isVisible(), false);
  assert.deepEqual(await page.locator('#cols > .col').evaluateAll(elements => elements.map(element => element.id)), ['col-b-home', 'col-b-notif']);
  await page.reload();
  await page.locator('#app').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#col-b-home').getAttribute('data-saved-width'), '410px');
  assert.equal(await page.evaluate(async () => (await import('./renderer.js')).columnLifecycle.getRefreshInterval('b-home')), 120000);
  assert.equal(await page.locator('#feed-b-home').evaluate(element => element.style.fontSize), '16px');
  await page.evaluate(async () => (await import('./renderer.js')).columnShellRuntime.setCollapsed('b-home', false));
  assert.equal(await page.locator('#col-b-home').evaluate(element => element.style.width), '410px');
});

test('workspace backup file export import preview recovery and invalid file preserve accounts', async t => {
  const { electronApp, page } = await launchApp(t, BLUESKY_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });
  const backupFile = path.join(await electronApp.evaluate(({ app }) => app.getPath('userData')), 'workspace-test.json');
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ filePath, canceled: false });
    dialog.showOpenDialog = async () => ({ filePaths: [filePath], canceled: false });
  }, backupFile);
  const openBackup = async () => {
    await page.locator('[data-action="open-settings"]').click();
    await page.locator('[data-action="open-backup"]').click();
  };
  await openBackup();
  await page.locator('[data-action="export-backup"]').click();
  await page.locator('#backup-status').filter({ hasText: '書き出しました' }).waitFor();
  const exported = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  assert.equal(exported.columns.length, 2);
  assert.equal(typeof exported.notifications.enabled, 'boolean');
  assert.equal(typeof exported.memoryInterval, 'number');
  assert.doesNotMatch(JSON.stringify(exported), /e2e-token|accessJwt|refreshJwt/);
  await page.evaluate(async () => (await import('./renderer.js')).removeCol('b-home'));
  await page.locator('[data-action="import-backup"]').click();
  await page.locator('#backup-apply').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#cols > .col').count(), 1);
  await page.locator('#backup-apply').click();
  await page.locator('#backupMod').waitFor({ state: 'hidden' });
  await page.locator('#col-b-home').waitFor();
  await openBackup();
  await page.locator('[data-action="recover-backup"]').click();
  await page.locator('#backup-apply').waitFor({ state: 'visible' });
  await page.locator('#backup-apply').click();
  await page.locator('#backupMod').waitFor({ state: 'hidden' });
  await page.locator('#col-b-notif').waitFor();
  assert.equal(await page.locator('#cols > .col').count(), 1);
  assert.equal(await page.evaluate(async () => (await import('./renderer.js')).state.b.did), BLUESKY_FIXTURES.state.b.did);
  fs.writeFileSync(backupFile, '{"format":"socialdeck-workspace","version":999}');
  await openBackup();
  await page.locator('[data-action="import-backup"]').click();
  await page.locator('#backup-status').filter({ hasText: '不正' }).waitFor();
  assert.equal(await page.locator('#backup-apply').isVisible(), false);
  assert.equal(await page.locator('#cols > .col').count(), 1);
  if (process.env.SOCIALDECK_BACKUP_SCREENSHOT) await page.screenshot({ path: process.env.SOCIALDECK_BACKUP_SCREENSHOT });
  exported.columns = [];
  fs.writeFileSync(backupFile, JSON.stringify(exported));
  await page.locator('[data-action="import-backup"]').click();
  await page.locator('#backup-apply').waitFor({ state: 'visible' });
  await page.locator('#backup-apply').click();
  await page.locator('#backupMod').waitFor({ state: 'hidden' });
  await page.locator('#app').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#cols > .col').count(), 0);
});

test('corrupted workspace layout recovers its previous save and displays a notice', async t => {
  const { page } = await launchApp(t, BLUESKY_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    (await import('./renderer.js')).columnLifecycle.persist();
    (await import('./renderer.js')).removeCol('b-home');
    localStorage.setItem('socialdeck_cols', '{broken');
  });
  await page.reload();
  await page.locator('#app').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#cols > .col').count(), 2);
  assert.equal(await page.locator('#workspace-recovery').isVisible(), true);
  assert.match(await page.locator('#workspace-recovery-message').textContent(), /復旧/);
  assert.equal(await page.evaluate(async () => localStorage.getItem('socialdeck_cols.corrupt')), '{broken');
  await page.locator('[data-action="dismiss-workspace-recovery"]').click();
  assert.equal(await page.locator('#workspace-recovery').isVisible(), false);
});
