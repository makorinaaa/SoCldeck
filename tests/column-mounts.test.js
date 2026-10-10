const assert = require('node:assert/strict');
const test = require('node:test');

function element(tagName = 'div') {
  return { tagName, style: {}, children: [], innerHTML: '', textContent: '',
    appendChild(child) { this.children.push(child); } };
}

async function harness({ xNative = true, fontSizes = {}, xNativeUnavailableHtml } = {}) {
  const { createColumnMounts } = await import('../src/renderer/column-mounts.mjs');
  const calls = { shells: [], intervals: [], xWebView: [], bluesky: [], refreshes: [], anime: [], xNative: [], fontSizes: [] };
  const elements = new Map();
  const documentRef = {
    createElement: tagName => element(tagName),
    getElementById: id => elements.get(id) || null,
  };
  const shell = {
    mount(config) {
      calls.shells.push(config);
      const hosts = Object.fromEntries((config.hosts || []).map(host => {
        const created = element();
        if (host.id) elements.set(host.id, created);
        return [host.name, created];
      }));
      if (config.subtitleId) elements.set(config.subtitleId, element('span'));
      return { root: element(), hosts, badge: config.badge ? element('span') : null };
    },
  };
  const mounts = createColumnMounts({
    documentRef,
    shell,
    xWebView: {
      mountColumn: request => calls.xWebView.push(request),
      setFontSize: (id, size) => calls.fontSizes.push(['wv', id, size]),
    },
    bluesky: {
      mount: request => calls.bluesky.push(request),
      refresh: (id, options) => { calls.refreshes.push([id, options]); return Promise.resolve(); },
    },
    animeSchedule: { load: id => { calls.anime.push(id); return Promise.resolve(); } },
    xNative: xNative ? {
      mount: request => calls.xNative.push(['home', request]),
      mountNotifications: request => calls.xNative.push(['notifications', request]),
    } : null,
    ...(xNativeUnavailableHtml ? { xNativeUnavailableHtml } : {}),
    setRefreshInterval: (id, interval) => calls.intervals.push([id, interval]),
    getFontSize: id => fontSizes[id] ?? null,
    getPreloadPath: () => 'file:///webview-preload.js',
    intervals: { standard: 60000, animeSchedule: 300000 },
  });
  return { mounts, calls, elements };
}

const common = { title: 'Title', sub: 'Sub', icCls: 'ic-x', icon: '<svg></svg>' };

test('mounts an X WebView Column with its loading cover', async () => {
  const { mounts, calls } = await harness();
  const config = { ...common, id: 'x-home', network: 'x', definitionId: 'x-home-new', url: 'https://x.com/home' };

  assert.equal(mounts.insertPlan({ kind: 'wv', config, partition: 'persist:x-1' }), true);

  const [shell] = calls.shells;
  assert.equal(shell.kind, 'x');
  assert.equal(shell.title, 'Title');
  assert.equal(shell.subtitle, 'Sub');
  assert.deepEqual(shell.actions.map(action => action.type || action), ['collapse', 'back', 'refresh', 'settings', 'remove']);
  const [request] = calls.xWebView;
  assert.equal(request.partition, 'persist:x-1');
  assert.equal(request.targetUrl, 'https://x.com/home');
  assert.equal(request.preloadPath, 'file:///webview-preload.js');
  assert.deepEqual(request.host.children.map(child => child.id), ['wvload-x-home', 'wvov-x-home']);
  assert.deepEqual(calls.intervals, []);
});

test('loads a Bluesky timeline and restores its font size', async () => {
  const { mounts, calls, elements } = await harness({ fontSizes: { 'b-home': 15 } });
  const config = { ...common, id: 'b-home', network: 'b', definitionId: 'b-timeline-new', type: 'timeline' };

  mounts.insertPlan({ kind: 'bsky', config });

  assert.deepEqual(calls.shells[0].metadata, { type: 'timeline', feeduri: '' });
  assert.equal(calls.bluesky[0].host, elements.get('feed-b-home'));
  assert.equal(calls.bluesky[0].searchInput, null);
  assert.deepEqual(calls.refreshes, [['b-home', { mode: 'replace' }]]);
  assert.deepEqual(calls.intervals, [['b-home', 60000]]);
  assert.equal(elements.get('feed-b-home').style.fontSize, '15px');
});

test('a Bluesky search Column waits for a keyword', async () => {
  const { mounts, calls, elements } = await harness();
  mounts.insertPlan({ kind: 'bsky', config: { ...common, id: 'b-search', network: 'b', type: 'search' } });

  assert.deepEqual(calls.shells[0].hosts.map(host => host.name), ['search', 'content']);
  assert.equal(calls.bluesky[0].searchInput.id, 'sq-b-search');
  assert.equal(calls.bluesky[0].searchButton.id, 'sq-btn-b-search');
  assert.deepEqual(calls.refreshes, []);
  assert.deepEqual(calls.intervals, []);
  assert.match(elements.get('feed-b-search').innerHTML, /検索キーワード/);
  assert.equal(elements.get('feed-b-search').style.fontSize, undefined);
});

test('the anime schedule refreshes every five minutes', async () => {
  const { mounts, calls } = await harness();
  mounts.insertPlan({ kind: 'schedule', config: { ...common, id: 'anime', network: 'anime' } });

  assert.equal(calls.shells[0].subtitleId, 'anime-sub-anime');
  assert.deepEqual(calls.anime, ['anime']);
  assert.deepEqual(calls.intervals, [['anime', 300000]]);
});

test('native X Columns read the Home or the notification page', async () => {
  const { mounts, calls, elements } = await harness();
  mounts.insertPlan({ kind: 'x-native', partition: 'persist:x-0',
    config: { ...common, id: 'xn', network: 'x', definitionId: 'x-home-native' } });
  mounts.insertPlan({ kind: 'x-native', partition: 'persist:x-0',
    config: { ...common, id: 'xn-notif', network: 'x', definitionId: 'x-notif-native' } });

  const [[homeKind, home], [notifKind, notif]] = calls.xNative;
  assert.equal(homeKind, 'home');
  assert.equal(home.subtitle, elements.get('xn-sub-xn'));
  assert.equal(home.partition, 'persist:x-0');
  assert.equal(notifKind, 'notifications');
  assert.equal(notif.host, elements.get('feed-xn-notif'));
  assert.equal(calls.shells[1].subtitleId, undefined);
  assert.match(calls.shells[1].hosts[0].className, /x-native-notif-feed/);
  assert.deepEqual(calls.intervals, [['xn', 60000], ['xn-notif', 60000]]);
});

test('native X Columns explain that they need the desktop app', async () => {
  const { mounts, elements } = await harness({ xNative: false });
  mounts.insertPlan({ kind: 'x-native', partition: 'persist:x-0',
    config: { ...common, id: 'xn', network: 'x', definitionId: 'x-home-native' } });
  assert.match(elements.get('feed-xn').innerHTML, /デスクトップ版でのみ/);
});

test('native X Columns show why they are off when X automation is not agreed to', async () => {
  const { mounts, elements, calls } = await harness({
    xNative: false,
    xNativeUnavailableHtml: '<div class="feed-empty">同意が必要です</div>',
  });
  mounts.insertPlan({ kind: 'x-native', partition: 'persist:x-0',
    config: { ...common, id: 'xn', network: 'x', definitionId: 'x-home-native' } });

  assert.match(elements.get('feed-xn').innerHTML, /同意が必要です/);
  assert.deepEqual(calls.xNative, []);
});

test('rejects unknown plans and keeps a Column that cannot be restored', async () => {
  const { mounts, calls } = await harness();
  assert.equal(mounts.insertPlan({ kind: 'unknown', config: {} }), false);
  assert.equal(mounts.insertPlan(null), false);

  mounts.mountRestoreError({ id: 'broken' }, new Error(''));
  const [shell] = calls.shells;
  assert.equal(shell.title, 'カラムを復元できませんでした');
  assert.deepEqual(shell.actions, ['remove']);
});

test('applies a new font size to the Column it belongs to', async () => {
  const { mounts, calls, elements } = await harness();
  mounts.insertPlan({ kind: 'bsky', config: { ...common, id: 'b-home', network: 'b', type: 'timeline' } });

  mounts.applyFontSize('b-home', 'bsky', 14);
  mounts.applyFontSize('x-home', 'wv', 16);

  assert.equal(elements.get('feed-b-home').style.fontSize, '14px');
  assert.deepEqual(calls.fontSizes, [['wv', 'x-home', 16]]);
});
