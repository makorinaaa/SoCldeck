const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createRuntime({ items = {}, search = '' } = {}) {
  const storage = {
    getItem: key => items[key] ?? null,
    setItem: (key, value) => { items[key] = String(value); },
    removeItem: key => { delete items[key]; },
  };
  const context = {
    URL,
    URLSearchParams,
    window: {
      location: { search },
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

test('keeps a saved Bluesky Column out of the active layout without a Bluesky session', () => {
  const runtime = createRuntime();
  const layout = [
    { id: 'x-home', kind: 'wv', network: 'x' },
    { id: 'b-home', kind: 'bsky', network: 'b' },
    { id: 'anime-today', kind: 'schedule', network: 'anime' },
  ];

  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.filterLayoutForAccounts(layout, { bluesky: false }))),
    [layout[0], layout[2]],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.filterLayoutForAccounts(layout, { bluesky: true }))),
    layout,
  );
});

test('captures a native X Home Column with its account partition', () => {
  const runtime = createRuntime();
  const column = createColumnElement({
    id: 'col-x0-x-home-native-1',
    dataset: { kind: 'x-native', network: 'x', definitionId: 'x-home-native', partition: 'persist:x-1' },
    title: 'Home',
    sub: 'X · alice',
    iconClass: 'col-ic ic-x',
  });

  const layout = runtime.captureLayout([column], {
    resolveDefinition: storedColumn => {
      assert.equal(storedColumn.kind, 'x-native');
      return { network: 'x', id: 'x-home-native' };
    },
    getInterval: () => 300000,
    isCollapsed: () => false,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(layout)), [{
    kind: 'x-native',
    network: 'x',
    definitionId: 'x-home-native',
    id: 'x0-x-home-native-1',
    partition: 'persist:x-1',
    title: 'Home',
    sub: 'X · alice',
    icCls: 'ic-x',
    width: '',
    interval: 300000,
    collapsed: false,
  }]);
});

test('restores every widget tab Column and drops tabs whose Column was removed', () => {
  const layout = [
    { id: 'b-home', title: 'Following', width: '400px', collapsed: true },
    { id: 'x0-home-1', title: 'Home' },
    { id: 'b-notif', title: 'Notifications' },
  ];
  const items = {
    socialdeck_cols: JSON.stringify(layout),
    socialdeck_widget_tabs: JSON.stringify(['x0-home-1', 'missing', 'b-home']),
  };
  const runtime = createRuntime({ items, search: '?widget=1' });

  const widgetLayout = runtime.getLayoutForCurrentMode();
  assert.deepEqual([...widgetLayout.map(column => column.id)], ['x0-home-1', 'b-home']);
  assert.equal(widgetLayout[1].collapsed, false);
  assert.equal(widgetLayout[1].width, '');
  assert.deepEqual([...runtime.getWidgetTabIds()], ['x0-home-1', 'b-home']);

  runtime.setWidgetTabIds(['b-notif']);
  assert.deepEqual([...runtime.getLayoutForCurrentMode().map(column => column.id)], ['b-notif']);
});

test('uses the previously selected widget Column when no tabs were saved', () => {
  const items = {
    socialdeck_cols: JSON.stringify([{ id: 'b-home' }, { id: 'x0-home-1' }]),
    socialdeck_widget_col: 'x0-home-1',
    socialdeck_widget_tabs: 'not json',
  };
  const runtime = createRuntime({ items, search: '?widget=1' });
  assert.deepEqual([...runtime.getLayoutForCurrentMode().map(column => column.id)], ['x0-home-1']);
});
