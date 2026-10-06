const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'html-escape.js'), 'utf8'), context);
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'widget-mode-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckWidgetModeRuntime;
}

function createElement(id = '') {
  const classes = new Set();
  const element = {
    id,
    hidden: false,
    value: '',
    textContent: '',
    style: { display: '' },
    classes,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : force;
        if (next) classes.add(name); else classes.delete(name);
        return next;
      },
    },
  };
  return element;
}

// innerHTML を代入したら id 付きの要素を登録するだけの最小限の DOM
function createDocument() {
  const elements = {};
  const appended = { head: [], body: [] };
  const body = createElement('body');
  const bodyStyle = {};
  body.style.setProperty = (name, value) => { bodyStyle[name] = value; };
  const register = element => { elements[element.id] = element; return element; };
  const createWithMarkup = () => {
    const element = createElement();
    let html = '';
    Object.defineProperty(element, 'innerHTML', {
      get: () => html,
      set(value) {
        html = value;
        for (const match of value.matchAll(/id="([^"]+)"([^>]*)>/g)) {
          if (elements[match[1]]) continue;
          const child = createWithMarkup();
          child.id = match[1];
          register(child);
          child.hidden = /\shidden(\s|$)/.test(match[2]);
          const valueMatch = match[2].match(/value="([^"]*)"/);
          if (valueMatch) child.value = valueMatch[1];
        }
      },
    });
    return element;
  };
  const cols = register(createElement('cols'));
  cols.columns = [];
  cols.querySelectorAll = () => cols.columns;
  return {
    elements,
    appended,
    body,
    bodyStyle,
    cols,
    register,
    getElementById: id => elements[id] || null,
    createElement: () => createWithMarkup(),
    addEventListener() {},
    head: { appendChild: element => appended.head.push(element) },
    addColumn(id, { badge } = {}) {
      const column = register(createElement(`col-${id}`));
      column.feed = { scrolls: [], scrollTo(options) { this.scrolls.push({ ...options }); } };
      column.querySelector = () => column.feed;
      cols.columns.push(column);
      if (badge) {
        const badgeElement = register(createElement(`badge-${id}`));
        badgeElement.style.display = 'none';
        badgeElement.clicks = 0;
        badgeElement.click = () => { badgeElement.clicks += 1; };
        column.badge = badgeElement;
      }
      return column;
    },
  };
}

function prepareBody(documentRef) {
  documentRef.body.prepend = element => {
    documentRef.appended.body.push(element);
    documentRef.register(element);
  };
}

class FakeMutationObserver {
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    FakeMutationObserver.instances.push(this);
  }
  observe(target) { this.target = target; }
  disconnect() { this.disconnected = true; }
  static notify(target) {
    FakeMutationObserver.instances.filter(item => item.target === target && !item.disconnected)
      .forEach(item => item.callback([]));
  }
}

function createColumnRuntime({ layout = [], tabs = null, active = null } = {}) {
  const calls = { tabs: [], active: [] };
  return {
    calls,
    readStoredLayout: () => layout,
    getWidgetColumnId: () => active,
    setWidgetColumnId: id => { active = id; calls.active.push(id); },
    getWidgetTabIds: () => tabs || (layout[0] ? [layout[0].id] : []),
    setWidgetTabIds: ids => { tabs = [...ids]; calls.tabs.push([...ids]); },
  };
}

async function createRuntime({ layout, tabs, active, widgetHost = null, intents = {}, columns = [] } = {}) {
  const documentRef = createDocument();
  prepareBody(documentRef);
  columns.forEach(column => documentRef.addColumn(column.id, column));
  const columnRuntime = createColumnRuntime({ layout, tabs, active });
  const runtime = loadModule().createWidgetModeRuntime({
    documentRef,
    widgetHost,
    columnRuntime,
    intents,
    MutationObserverRef: FakeMutationObserver,
  });
  await runtime.init();
  return { runtime, documentRef, columnRuntime };
}

const LAYOUT = [
  { id: 'b-home', title: 'Following', sub: '@me', network: 'b' },
  { id: 'x0-home-1', title: 'Home', network: 'x' },
  { id: 'b-notif', title: 'Notifications', network: 'b' },
];

test('escapes imported layout metadata in widget tabs and the column picker', async () => {
  const payload = '</div><img src=x onerror=alert(1)>';
  const { runtime, documentRef } = await createRuntime({
    layout: [
      { id: '" data-injected="yes', title: payload, sub: payload },
      { id: 'other', title: payload, sub: payload },
    ],
  });
  const tabsHtml = documentRef.getElementById('wg-tabs').innerHTML;
  assert.doesNotMatch(tabsHtml, /<img|data-column-id="" data-injected=/);
  assert.match(tabsHtml, /&lt;img/);
  assert.match(tabsHtml, /&quot; data-injected=&quot;yes/);

  runtime.openPicker();
  const pickerHtml = documentRef.getElementById('wg-picker').innerHTML;
  assert.doesNotMatch(pickerHtml, /<img/);
  assert.match(pickerHtml, /&lt;img/);
});

test('falls back to the selected Column when the Column Runtime has no tab list', async () => {
  const documentRef = createDocument();
  prepareBody(documentRef);
  const runtime = loadModule().createWidgetModeRuntime({
    documentRef,
    columnRuntime: { readStoredLayout: () => LAYOUT, getWidgetColumnId: () => 'x0-home-1' },
    MutationObserverRef: FakeMutationObserver,
  });
  await runtime.init();
  const html = documentRef.getElementById('wg-tabs').innerHTML;
  assert.match(html, /data-column-id="x0-home-1"/);
  assert.doesNotMatch(html, /data-column-id="b-home"/);
});

test('renders widget tabs and shows only the active tab Column', async () => {
  const { documentRef } = await createRuntime({
    layout: LAYOUT,
    tabs: ['b-home', 'x0-home-1'],
    active: 'x0-home-1',
    columns: [{ id: 'b-home' }, { id: 'x0-home-1' }],
  });

  assert.equal(documentRef.body.classes.has('widget-mode'), true);
  assert.match(documentRef.appended.head[0].textContent, /#widget-bar/);
  const html = documentRef.getElementById('wg-tabs').innerHTML;
  assert.match(html, /class="wg-tab active" data-action="widget-select-tab"\s+data-column-id="x0-home-1" data-network="x"/);
  assert.match(html, /data-column-id="b-home" data-network="b"/);
  assert.match(html, /Following · @me/);
  assert.equal(documentRef.getElementById('col-x0-home-1').classes.has('wg-active'), true);
  assert.equal(documentRef.getElementById('col-b-home').classes.has('wg-active'), false);
});

test('restores host state for opacity, always-on-top, lock and background-only', async () => {
  const { documentRef } = await createRuntime({
    layout: LAYOUT,
    widgetHost: {
      getState: async () => ({ opacity: 0.6, alwaysOnTop: true, locked: true, backgroundOnly: true }),
      setOpacity: () => {},
    },
  });

  assert.equal(documentRef.getElementById('wg-opacity').value, 60);
  assert.equal(documentRef.getElementById('wg-top-btn').classes.has('active'), true);
  assert.equal(documentRef.getElementById('wg-lock-btn').classes.has('active'), true);
  assert.equal(documentRef.getElementById('wg-bg-btn').classes.has('active'), true);
  assert.equal(documentRef.body.classes.has('widget-locked'), true);
  assert.equal(documentRef.body.classes.has('widget-bg-only'), true);
  assert.equal(documentRef.bodyStyle['--wg-bg-alpha'], '60%');
});

test('falls back to the legacy opacity and always-on-top host calls', async () => {
  const { documentRef } = await createRuntime({
    layout: LAYOUT,
    widgetHost: { getOpacity: async () => 0.8, getTop: async () => true, setOpacity: () => {} },
  });
  assert.equal(documentRef.getElementById('wg-opacity').value, 80);
  assert.equal(documentRef.getElementById('wg-top-btn').classes.has('active'), true);
});

test('toggles always-on-top, lock and background-only transparency through the host', async () => {
  const toasts = [];
  const opacityCalls = [];
  const backgroundRequests = [];
  const { runtime, documentRef } = await createRuntime({
    layout: LAYOUT,
    widgetHost: {
      getState: async () => ({ opacity: 0.5 }),
      setOpacity: value => opacityCalls.push(value),
      toggleTop: async () => true,
      toggleLock: async () => true,
      setBackgroundOnly: async enabled => { backgroundRequests.push(enabled); return enabled; },
    },
    intents: { toast: message => toasts.push(message) },
  });

  await runtime.toggleTop();
  assert.equal(documentRef.getElementById('wg-top-btn').classes.has('active'), true);
  await runtime.toggleLock();
  assert.equal(documentRef.body.classes.has('widget-locked'), true);
  await runtime.toggleBackgroundOnly();
  assert.deepEqual(backgroundRequests, [true]);
  assert.equal(documentRef.body.classes.has('widget-bg-only'), true);
  assert.equal(documentRef.bodyStyle['--wg-bg-alpha'], '50%');

  runtime.setOpacity(70);
  assert.deepEqual(opacityCalls, [0.7]);
  assert.equal(documentRef.bodyStyle['--wg-bg-alpha'], '70%');
  assert.deepEqual(toasts, ['Always on top enabled', 'Position locked', 'Background-only transparency']);
});

test('switches tabs and scrolls the active tab to the top when clicked again', async () => {
  const { runtime, documentRef, columnRuntime } = await createRuntime({
    layout: LAYOUT,
    tabs: ['b-home', 'x0-home-1'],
    active: 'b-home',
    columns: [{ id: 'b-home' }, { id: 'x0-home-1', badge: true }],
  });

  runtime.selectTab('x0-home-1');
  assert.deepEqual(columnRuntime.calls.active, ['x0-home-1']);
  assert.equal(documentRef.getElementById('col-x0-home-1').classes.has('wg-active'), true);
  assert.equal(documentRef.getElementById('col-b-home').classes.has('wg-active'), false);

  // 新着がなければ先頭へスクロールするだけ
  runtime.selectTab('x0-home-1');
  assert.deepEqual(documentRef.getElementById('col-x0-home-1').feed.scrolls, [{ top: 0, behavior: 'smooth' }]);

  // 新着があればカラムのバッジ操作（先頭へ移動して件数を消す）に任せる
  const badge = documentRef.getElementById('badge-x0-home-1');
  badge.style.display = '';
  badge.textContent = '+4';
  runtime.selectTab('x0-home-1');
  assert.equal(badge.clicks, 1);
});

test('mirrors Column new-post badges as tab counts', async () => {
  const { documentRef } = await createRuntime({
    layout: LAYOUT,
    tabs: ['b-home', 'x0-home-1'],
    active: 'b-home',
    columns: [{ id: 'b-home', badge: true }, { id: 'x0-home-1', badge: true }],
  });
  const badge = documentRef.getElementById('badge-x0-home-1');
  badge.style.display = '';
  badge.textContent = '+3';
  FakeMutationObserver.notify(badge);
  assert.match(documentRef.getElementById('wg-tabs').innerHTML,
    /data-column-id="x0-home-1"[\s\S]*?<span class="wg-tab-count">3<\/span>/);

  badge.style.display = 'none';
  FakeMutationObserver.notify(badge);
  assert.doesNotMatch(documentRef.getElementById('wg-tabs').innerHTML, /wg-tab-count/);
});

test('adds and closes widget tabs without reloading the page', async () => {
  const mounted = [];
  const unmounted = [];
  let reloads = 0;
  const { runtime, documentRef, columnRuntime } = await createRuntime({
    layout: LAYOUT,
    tabs: ['b-home'],
    active: 'b-home',
    columns: [{ id: 'b-home' }],
    intents: {
      mountColumn: id => { mounted.push(id); documentRef.addColumn(id); },
      unmountColumn: id => unmounted.push(id),
      reload: () => { reloads += 1; },
    },
  });

  runtime.openPicker();
  assert.equal(documentRef.getElementById('wg-picker').hidden, false);
  assert.doesNotMatch(documentRef.getElementById('wg-picker').innerHTML, /data-column-id="b-home"/);

  runtime.addTab('b-notif');
  assert.equal(documentRef.getElementById('wg-picker').hidden, true);
  assert.deepEqual(mounted, ['b-notif']);
  assert.deepEqual(columnRuntime.calls.tabs.at(-1), ['b-home', 'b-notif']);
  assert.equal(columnRuntime.calls.active.at(-1), 'b-notif');
  assert.equal(documentRef.getElementById('col-b-notif').classes.has('wg-active'), true);

  runtime.closeTab('b-notif');
  assert.deepEqual(unmounted, ['b-notif']);
  assert.deepEqual(columnRuntime.calls.tabs.at(-1), ['b-home']);
  assert.equal(columnRuntime.calls.active.at(-1), 'b-home');

  // 最後のタブは閉じない
  runtime.closeTab('b-home');
  assert.deepEqual(unmounted, ['b-notif']);
  assert.equal(reloads, 0);
});

test('steps the active Column font size within limits', async () => {
  const sizes = { 'b-home': 19 };
  const { runtime, documentRef } = await createRuntime({
    layout: LAYOUT,
    intents: {
      getFontSize: id => sizes[id],
      setFontSize: (id, size) => { sizes[id] = size; },
    },
  });

  runtime.toggleMenu();
  assert.equal(documentRef.getElementById('wg-menu').hidden, false);
  assert.equal(documentRef.getElementById('wg-font-size').textContent, '19px');
  runtime.stepFontSize(1);
  runtime.stepFontSize(1);
  assert.equal(sizes['b-home'], 20);
  assert.equal(documentRef.getElementById('wg-font-size').textContent, '20px');
  runtime.toggleMenu();
  assert.equal(documentRef.getElementById('wg-menu').hidden, true);
});

test('legacy Column selection reloads when the widget has no tabs', async () => {
  let reloads = 0;
  const selected = [];
  const documentRef = createDocument();
  prepareBody(documentRef);
  const runtime = loadModule().createWidgetModeRuntime({
    documentRef,
    columnRuntime: {
      readStoredLayout: () => [],
      getWidgetColumnId: () => null,
      setWidgetColumnId: id => selected.push(id),
    },
    intents: { reload: () => { reloads += 1; } },
    MutationObserverRef: FakeMutationObserver,
  });
  await runtime.init();
  runtime.selectColumn('bsky-home');
  assert.deepEqual(selected, ['bsky-home']);
  assert.equal(reloads, 1);

  // ホストなしでは何もしない
  runtime.setOpacity(50);
  runtime.close();
});
