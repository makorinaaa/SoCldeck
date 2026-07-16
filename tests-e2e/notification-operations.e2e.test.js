const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { _electron: electron } = require('playwright-core');
const { version: appVersion } = require('../package.json');

const APP_ROOT = path.join(__dirname, '..');
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
    const intercept = (partition, network) => new Promise((resolve, reject) => {
      const targetSession = partition ? session.fromPartition(partition) : session.defaultSession;
      targetSession.protocol.interceptBufferProtocol('https', (request, callback) => {
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
        const notificationsHtml = partition === 'persist:x-1'
          ? fixture.notificationsHtml
          : fixture.notificationsHtml.replaceAll('Alice', 'Other');
        const body = network === 'x' && fixture.simulateXLogin && url.pathname !== '/i/flow/login'
          ? '<!doctype html><html><body><script>location.replace("https://x.com/i/flow/login")</script></body></html>'
          : network === 'x' && url.pathname === '/notifications'
            ? notificationsHtml
            : fixture.pageHtml.replaceAll('__PATH__', url.pathname);
        callback({ mimeType: 'text/html', charset: 'utf-8', data: Buffer.from(body) });
      }, error => error ? reject(error) : resolve());
    });
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
    pageHtml: `<!doctype html><html><body data-e2e-path="__PATH__">
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
    avatarPng: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  });
  const page = await electronApp.firstWindow();
  await page.evaluate(() => {
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
  try {
    await page.waitForFunction(({ selector, expectedUrl }) => {
      const webview = document.querySelector(selector);
      return webview && (webview.getURL?.() === expectedUrl || webview.src === expectedUrl);
    }, { selector, expectedUrl }, { timeout: 10000 });
  } catch {
    const actual = await page.locator(selector).evaluate(webview => ({
      currentUrl: webview.getURL?.() || '',
      src: webview.src,
      toast: document.getElementById('toast')?.textContent || '',
      warnings: window.__e2eWarnings || [],
    }));
    assert.equal(actual.currentUrl || actual.src, expectedUrl, JSON.stringify(actual));
  }
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
    const diagnostics = await page.evaluate(() => ({
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

test('X notification journey reuses the account column and returns to notifications', async t => {
  const { page } = await launchApp(t, X_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await openXLikeNotification(page);
  const column = page.locator('.col[data-definition-id="x-notif-new"]');
  const webviewSelector = '.col[data-definition-id="x-notif-new"] webview';
  await column.waitFor();
  assert.equal(await column.count(), 1);
  assert.equal(await column.locator('webview').getAttribute('partition'), 'persist:x-1');
  await expectWebviewUrl(page, webviewSelector, LIKED_POST_URL);

  await column.locator('button[title="戻る"]').click();
  await expectWebviewUrl(page, webviewSelector, NOTIFICATIONS_URL);

  await openXLikeNotification(page);
  await expectWebviewUrl(page, webviewSelector, LIKED_POST_URL);
  await column.locator('button[id^="rfr-"]').click();
  await expectWebviewUrl(page, webviewSelector, NOTIFICATIONS_URL);

  await openXLikeNotification(page);
  await expectWebviewUrl(page, webviewSelector, LIKED_POST_URL);
  await column.locator('.col-info').click();
  await expectWebviewUrl(page, webviewSelector, NOTIFICATIONS_URL);

  await openXLikeNotification(page);
  await expectWebviewUrl(page, webviewSelector, LIKED_POST_URL);
  assert.equal(await column.count(), 1);
});

test('new X accounts use one login WebView and default to the black theme', async t => {
  const { electronApp, page } = await launchApp(t, NEW_X_ACCOUNT_FIXTURES);
  await page.locator('#login-screen').waitFor({ state: 'visible' });
  await page.waitForFunction(() => typeof window.loginX === 'function');
  await page.evaluate(() => {
    localStorage.setItem('socialdeck_cols', JSON.stringify([
      { kind: 'wv', network: 'x', definitionId: 'x-home-new', id: 'login-home', url: 'https://x.com/home', partition: 'persist:x-0' },
      { kind: 'wv', network: 'x', definitionId: 'x-notif-new', id: 'login-notifications', url: 'https://x.com/notifications', partition: 'persist:x-0' },
      { kind: 'wv', network: 'x', definitionId: 'x-search-new', id: 'login-search', url: 'https://x.com/search', partition: 'persist:x-0' },
    ]));
  });

  await page.locator('#x-user').fill('new-account');
  await page.evaluate(() => window.loginX());
  await page.locator('#app').waitFor({ state: 'visible' });
  await page.waitForFunction(() =>
    document.querySelectorAll('webview[data-sd-login-parked="true"]').length === 2
  );
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.col[data-network="x"] webview'))
      .some(webview => webview.getURL().includes('/i/flow/login'))
  );

  const loginWebViews = await page.locator('.col[data-network="x"] webview').evaluateAll(webviews =>
    webviews.map(webview => ({
      parked: webview.dataset.sdLoginParked,
      url: webview.getURL(),
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

test('Bluesky follow notifications reuse one profile column and switch its URL', async t => {
  const { page } = await launchApp(t, BLUESKY_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await page.evaluate(() => openAbout());
  await page.locator('#aboutMod.on').waitFor();
  assert.equal(await page.locator('#about-version').textContent(), `Version ${appVersion}`);
  await page.locator('#about-close-btn').click();

  await page.locator('#sb-notif-b').click();
  await page.locator('.notif-center-tab[data-network="b"]').click();
  await page.locator('.notif-center-item').nth(0).click();

  const column = page.locator('.col[data-definition-id="b-profile"]');
  const webviewSelector = '.col[data-definition-id="b-profile"] webview';
  await column.waitFor();
  assert.equal(await column.count(), 1);
  await expectWebviewUrl(page, webviewSelector, 'https://bsky.app/profile/did:plc:alice');

  await page.locator('#sb-notif-b').click();
  await page.locator('.notif-center-tab[data-network="b"]').click();
  await page.locator('.notif-center-item').nth(1).click();

  await expectWebviewUrl(page, webviewSelector, 'https://bsky.app/profile/did:plc:bob');
  assert.equal(await column.count(), 1);
});

test('Compose Experience retains media and executes Bluesky delivery through its Adapter', async t => {
  const { page } = await launchApp(t, COMPOSE_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await page.evaluate(() => openXPost());
  await page.evaluate(() => {
    addXImgFiles([new File(['x-image'], 'x-image.png', { type: 'image/png' })]);
  });
  await page.locator('#x-alt-0').fill('X image description');
  assert.equal(await page.locator('#x-sndb').isEnabled(), true);
  assert.match(await page.locator('#x-compose-preview').textContent(), /画像 1枚 \/ ALT入力 1枚/);
  await page.evaluate(() => closeOv('xPostMod'));
  assert.equal(await page.locator('#x-img-preview').textContent(), '');

  await page.evaluate(() => openComp());
  await page.evaluate(() => {
    addBImgFiles([new File(['b-image'], 'b-image.png', { type: 'image/png' })]);
  });
  await page.locator('#b-alt-0').fill('Bluesky image description');
  assert.equal(await page.locator('#sndb').isEnabled(), true);
  assert.match(await page.locator('#b-compose-preview').textContent(), /画像 1枚 \/ ALT入力 1枚/);
  await page.locator('#sndb').click();
  await page.locator('#compMod').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#b-img-preview').textContent(), '');
});

test('anime schedule Column can be added and persisted from the picker', async t => {
  const { page } = await launchApp(t, ANIME_SCHEDULE_FIXTURES);
  await page.locator('#app').waitFor({ state: 'visible' });

  await page.evaluate(() => openAddMod());
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

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('socialdeck_cols')));
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
