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

function createDocument() {
  const elements = {};
  const appended = { head: [], body: [] };
  const bodyClasses = new Set();
  const bodyStyle = {};
  return {
    elements,
    appended,
    bodyClasses,
    bodyStyle,
    register(element) { elements[element.id] = element; },
    getElementById(id) { return elements[id] || null; },
    createElement: () => ({ id: '', innerHTML: '', textContent: '', style: {} }),
    head: { appendChild: element => appended.head.push(element) },
    body: {
      classList: {
        add: name => bodyClasses.add(name),
        toggle(name, force) {
          if (force) bodyClasses.add(name); else bodyClasses.delete(name);
        },
      },
      style: { setProperty: (name, value) => { bodyStyle[name] = value; } },
      prepend(element) {
        appended.body.push(element);
        elements[element.id] = element;
      },
    },
  };
}

test('escapes imported layout metadata in widget options', async () => {
  const documentRef = createDocument();
  const payload = '</option></select><img src=x onerror=alert(1)>';
  const runtime = loadModule().createWidgetModeRuntime({
    documentRef,
    columnRuntime: {
      readStoredLayout: () => [{ id: '" data-injected="yes', title: payload, sub: payload }],
      getWidgetColumnId: () => null,
    },
  });
  await runtime.init();
  const html = documentRef.getElementById('widget-bar').innerHTML;
  assert.doesNotMatch(html, /<img|value="" data-injected=/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&quot; data-injected=&quot;yes/);
});

test('initializes widget chrome with stored layout options and host state', async () => {
  const documentRef = createDocument();
  const slider = { id: 'wg-opacity', value: '100' };
  const topButton = {
    id: 'wg-top-btn',
    classes: new Set(),
    classList: {
      add(name) { topButton.classes.add(name); },
      toggle(name, force) {
        if (force) topButton.classes.add(name); else topButton.classes.delete(name);
      },
    },
  };
  const opacityCalls = [];
  const runtime = loadModule().createWidgetModeRuntime({
    documentRef,
    widgetHost: {
      getOpacity: async () => 0.8,
      setOpacity: value => opacityCalls.push(value),
      getTop: async () => true,
      toggleTop: async () => false,
      close: () => {},
    },
    columnRuntime: {
      readStoredLayout: () => [
        { id: 'bsky-home', title: 'Following', sub: '@me' },
        { id: 'x0-home-1', title: 'Home' },
      ],
      getWidgetColumnId: () => 'x0-home-1',
      setWidgetColumnId: () => {},
    },
  });

  const initPromise = runtime.init();
  documentRef.register(slider);
  documentRef.register(topButton);
  await initPromise;

  assert.equal(documentRef.bodyClasses.has('widget-mode'), true);
  assert.match(documentRef.appended.head[0].textContent, /#widget-bar/);
  const bar = documentRef.getElementById('widget-bar');
  assert.match(bar.innerHTML, /<option value="bsky-home" >Following · @me<\/option>/);
  assert.match(bar.innerHTML, /<option value="x0-home-1" selected>Home<\/option>/);
  assert.equal(slider.value, 80);
  // 透明度は Main がウィンドウ表示時に適用するので、初期化で書き戻さない
  assert.deepEqual(opacityCalls, []);
  assert.equal(topButton.classes.has('active'), true);
  assert.match(bar.innerHTML, /data-action="widget-toggle-lock"/);
  assert.match(bar.innerHTML, /data-action="widget-toggle-background-only"/);
});

function createToggleButton(id) {
  const button = {
    id,
    classes: new Set(),
    classList: {
      toggle(name, force) {
        if (force) button.classes.add(name); else button.classes.delete(name);
      },
    },
  };
  return button;
}

test('restores lock and background-only state from the widget host', async () => {
  const documentRef = createDocument();
  const lockButton = createToggleButton('wg-lock-btn');
  const backgroundButton = createToggleButton('wg-bg-btn');
  documentRef.register(lockButton);
  documentRef.register(backgroundButton);
  documentRef.register({ id: 'wg-opacity', value: '100' });
  const runtime = loadModule().createWidgetModeRuntime({
    documentRef,
    widgetHost: {
      getState: async () => ({ opacity: 0.6, alwaysOnTop: false, locked: true, backgroundOnly: true }),
      setOpacity: () => {},
      toggleTop: async () => true,
      close: () => {},
    },
    columnRuntime: { readStoredLayout: () => [], getWidgetColumnId: () => null },
  });

  await runtime.init();

  assert.equal(documentRef.bodyClasses.has('widget-locked'), true);
  assert.equal(documentRef.bodyClasses.has('widget-bg-only'), true);
  assert.equal(documentRef.bodyStyle['--wg-bg-alpha'], '60%');
  assert.equal(lockButton.classes.has('active'), true);
  assert.equal(backgroundButton.classes.has('active'), true);
});

test('toggles position lock and background-only transparency through the host', async () => {
  const documentRef = createDocument();
  const lockButton = createToggleButton('wg-lock-btn');
  const backgroundButton = createToggleButton('wg-bg-btn');
  documentRef.register(lockButton);
  documentRef.register(backgroundButton);
  documentRef.register({ id: 'wg-opacity', value: '50' });
  const backgroundRequests = [];
  const opacityCalls = [];
  const toasts = [];
  const runtime = loadModule().createWidgetModeRuntime({
    documentRef,
    widgetHost: {
      setOpacity: value => opacityCalls.push(value),
      toggleLock: async () => true,
      setBackgroundOnly: async enabled => {
        backgroundRequests.push(enabled);
        return enabled;
      },
    },
    columnRuntime: { readStoredLayout: () => [], getWidgetColumnId: () => null },
    intents: { toast: message => toasts.push(message) },
  });

  await runtime.toggleLock();
  assert.equal(documentRef.bodyClasses.has('widget-locked'), true);
  assert.equal(lockButton.classes.has('active'), true);

  await runtime.toggleBackgroundOnly();
  assert.deepEqual(backgroundRequests, [true]);
  assert.equal(documentRef.bodyClasses.has('widget-bg-only'), true);
  assert.equal(documentRef.bodyStyle['--wg-bg-alpha'], '50%');
  assert.equal(backgroundButton.classes.has('active'), true);

  runtime.setOpacity(70);
  assert.deepEqual(opacityCalls, [0.7]);
  assert.equal(documentRef.bodyStyle['--wg-bg-alpha'], '70%');
  assert.deepEqual(toasts, ['Position locked', 'Background-only transparency']);
});

test('swaps the widget Column in place when the host page supports it', () => {
  const selected = [];
  let swaps = 0;
  let reloads = 0;
  const runtime = loadModule().createWidgetModeRuntime({
    documentRef: createDocument(),
    columnRuntime: {
      readStoredLayout: () => [],
      getWidgetColumnId: () => null,
      setWidgetColumnId: columnId => selected.push(columnId),
    },
    intents: { swapColumn: () => { swaps += 1; }, reload: () => { reloads += 1; } },
  });

  runtime.selectColumn('x0-home-1');
  assert.deepEqual(selected, ['x0-home-1']);
  assert.equal(swaps, 1);
  assert.equal(reloads, 0);
});

test('toggles always-on-top through the widget host and reports the result', async () => {
  const documentRef = createDocument();
  const topButton = {
    id: 'wg-top-btn',
    classes: new Set(),
    classList: {
      toggle(name, force) {
        if (force) topButton.classes.add(name); else topButton.classes.delete(name);
      },
    },
  };
  documentRef.register(topButton);
  const toasts = [];
  const runtime = loadModule().createWidgetModeRuntime({
    documentRef,
    widgetHost: {
      getOpacity: async () => 1,
      setOpacity: () => {},
      getTop: async () => false,
      toggleTop: async () => true,
      close: () => {},
    },
    columnRuntime: {
      readStoredLayout: () => [],
      getWidgetColumnId: () => null,
      setWidgetColumnId: () => {},
    },
    intents: { toast: message => toasts.push(message) },
  });

  await runtime.toggleTop();
  assert.equal(topButton.classes.has('active'), true);
  assert.deepEqual(toasts, ['Always on top enabled']);
});

test('persists the selected widget Column and reloads', () => {
  const documentRef = createDocument();
  const selected = [];
  let reloads = 0;
  const runtime = loadModule().createWidgetModeRuntime({
    documentRef,
    columnRuntime: {
      readStoredLayout: () => [],
      getWidgetColumnId: () => null,
      setWidgetColumnId: columnId => selected.push(columnId),
    },
    intents: { reload: () => { reloads += 1; } },
  });

  runtime.selectColumn('bsky-home');
  assert.deepEqual(selected, ['bsky-home']);
  assert.equal(reloads, 1);

  // ホストなしでは何もしない
  runtime.setOpacity(50);
  runtime.close();
});
