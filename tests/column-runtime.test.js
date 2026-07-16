const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createRuntime() {
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const context = {
    URL,
    URLSearchParams,
    window: {
      location: { search: '' },
      localStorage: storage,
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'column-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckColumnRuntime.createColumnRuntime({
    storage,
    locationLike: context.window.location,
  });
}

function createColumnElement({
  id,
  dataset = {},
  width = '',
  webview = null,
  title = '',
  sub = '',
  iconClass = '',
}) {
  const children = {
    webview,
    '.col-title': { textContent: title },
    '.col-sub': { textContent: sub },
    '.col-ic': { className: iconClass },
  };
  return {
    id,
    dataset,
    style: { width },
    querySelector: selector => children[selector] || null,
  };
}

test('captures an X Column as durable Workspace State', () => {
  const runtime = createRuntime();
  const column = createColumnElement({
    id: 'col-x0-x-home-new-1',
    dataset: { network: 'x', definitionId: 'x-home-new' },
    width: '360px',
    webview: {
      src: 'https://x.com/home',
      partition: 'persist:x-0',
    },
    title: 'Home',
    sub: 'X · alice',
    iconClass: 'col-ic ic-x',
  });

  const layout = runtime.captureLayout([column], {
    resolveDefinition: () => ({ network: 'x', id: 'x-home-new' }),
    getInterval: () => 30000,
    isCollapsed: () => true,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(layout)), [{
    kind: 'wv',
    network: 'x',
    definitionId: 'x-home-new',
    id: 'x0-x-home-new-1',
    url: 'https://x.com/home',
    partition: 'persist:x-0',
    title: 'Home',
    sub: 'X · alice',
    icCls: 'ic-x',
    width: '360px',
    interval: 30000,
    collapsed: true,
  }]);
});

test('captures a Bluesky Column as durable Workspace State', () => {
  const runtime = createRuntime();
  const column = createColumnElement({
    id: 'col-b-discover-1',
    dataset: {
      network: 'b',
      definitionId: 'b-discover',
      type: 'feed',
      feeduri: 'at://example/app.bsky.feed.generator/discover',
    },
    title: 'Discover',
    sub: 'Bluesky',
    iconClass: 'col-ic ic-b',
  });

  const layout = runtime.captureLayout([column], {
    resolveDefinition: () => ({ network: 'b', id: 'b-discover' }),
    getInterval: () => 60000,
    isCollapsed: () => false,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(layout)), [{
    kind: 'bsky',
    network: 'b',
    definitionId: 'b-discover',
    id: 'b-discover-1',
    type: 'feed',
    feedUri: 'at://example/app.bsky.feed.generator/discover',
    title: 'Discover',
    sub: 'Bluesky',
    icCls: 'ic-b',
    width: '',
    interval: 60000,
    collapsed: false,
  }]);
});

test('captures an anime schedule Column without network account state', () => {
  const runtime = createRuntime();
  const column = createColumnElement({
    id: 'col-anime-today-1',
    dataset: {
      kind: 'schedule',
      network: 'anime',
      definitionId: 'anime-today',
    },
    title: '本日のアニメ',
    sub: '7月16日 · 12作品',
    iconClass: 'col-ic ic-anime',
  });

  const layout = runtime.captureLayout([column], {
    resolveDefinition: () => ({ network: 'anime', id: 'anime-today' }),
    getInterval: () => 300000,
    isCollapsed: () => false,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(layout)), [{
    kind: 'schedule',
    network: 'anime',
    definitionId: 'anime-today',
    id: 'anime-today-1',
    title: '本日のアニメ',
    sub: '7月16日 · 12作品',
    icCls: 'ic-anime',
    width: '',
    interval: 300000,
    collapsed: false,
  }]);
});
