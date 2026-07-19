const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { window: {} };
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
  return {
    elements,
    appended,
    bodyClasses,
    register(element) { elements[element.id] = element; },
    getElementById(id) { return elements[id] || null; },
    createElement: () => ({ id: '', innerHTML: '', textContent: '', style: {} }),
    head: { appendChild: element => appended.head.push(element) },
    body: {
      classList: { add: name => bodyClasses.add(name) },
      prepend(element) {
        appended.body.push(element);
        elements[element.id] = element;
      },
    },
  };
}

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
  assert.deepEqual(opacityCalls, [0.8]);
  assert.equal(topButton.classes.has('active'), true);
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
