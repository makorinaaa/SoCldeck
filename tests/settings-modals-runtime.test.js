const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRuntime() {
  const context = { window: { setTimeout: callback => callback() } };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'settings-modals-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckSettingsModalsRuntime;
}

function createElement(id = '') {
  const classes = new Set();
  return {
    id,
    className: '',
    dataset: {},
    disabled: false,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    removed: false,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle(name, force) {
        if (force) classes.add(name); else classes.delete(name);
      },
      contains: name => classes.has(name),
    },
    focus() {},
    remove() { this.removed = true; },
  };
}

function createDocument({ queries = {} } = {}) {
  const elements = {};
  const appended = [];
  return {
    elements,
    appended,
    register(element) { elements[element.id] = element; },
    getElementById(id) { return elements[id] || null; },
    querySelector: () => null,
    querySelectorAll: selector => queries[selector] || [],
    createElement: () => createElement(),
    body: {
      appendChild(element) {
        appended.push(element);
        elements[element.id] = element;
      },
    },
  };
}

function createHarness({
  documentRef = createDocument(),
  rules = { words: [], users: [] },
  memoryInterval = 0,
  measure = async () => ({ host: null }),
  clear = async () => ({ after: { host: null }, runtimeCleanup: {} }),
  appearanceState = { theme: 'dark', accent: '#4e9af0' },
} = {}) {
  const calls = {
    added: [],
    removed: [],
    toasts: [],
    refilters: 0,
    intervals: [],
    fontSizes: [],
    persisted: 0,
    memoryIntervals: [],
    appearance: [],
  };
  const runtime = loadRuntime().createSettingsModalsRuntime({
    documentRef,
    storage: {
      values: {},
      getItem(key) { return this.values[key] ?? null; },
      setItem(key, value) { this.values[key] = String(value); },
    },
    muteRules: {
      getRules: () => rules,
      add: (kind, value) => {
        const clean = String(value || '').trim();
        calls.added.push([kind, clean]);
        return { value: clean };
      },
      remove: (kind, index) => calls.removed.push([kind, index]),
    },
    appearance: {
      begin: () => { calls.appearance.push('begin'); return appearanceState; },
      preview: partial => { calls.appearance.push(['preview', partial]); return appearanceState; },
      cancel: () => calls.appearance.push('cancel'),
      commit: () => { calls.appearance.push('commit'); return appearanceState; },
    },
    memoryCleaner: {
      getInterval: () => memoryInterval,
      setIntervalMs: ms => calls.memoryIntervals.push(ms),
      measure,
      clear,
    },
    columns: {
      getRefreshInterval: () => 60000,
      setRefreshInterval: (id, ms) => calls.intervals.push([id, ms]),
      persistLayout: () => { calls.persisted += 1; },
      setFontSize: (id, colType, fontSize) => calls.fontSizes.push([id, colType, fontSize]),
    },
    intents: {
      toast: message => calls.toasts.push(message),
      refilterColumns: () => { calls.refilters += 1; },
    },
  });
  return { runtime, calls, documentRef };
}

test('renders NG rules into one overlay and routes changes through Mute Rules', () => {
  const documentRef = createDocument();
  const { runtime, calls } = createHarness({
    documentRef,
    rules: { words: ['spam<'], users: ['bad.example'] },
  });

  runtime.openNgSettings();

  const overlay = documentRef.appended[0];
  assert.equal(overlay.id, 'ng-modal-ov');
  assert.match(overlay.innerHTML, /spam&lt;/);
  assert.match(overlay.innerHTML, /@bad\.example/);
  assert.match(overlay.innerHTML, /data-action="remove-ng-rule" data-rule-kind="user" data-rule-index="0"/);

  const input = createElement('ng-word-input');
  input.value = ' 追加ワード ';
  documentRef.register(input);
  runtime.addNgRule('word');
  assert.deepEqual(calls.added, [['word', '追加ワード']]);
  assert.equal(calls.refilters, 1);
  assert.match(calls.toasts[0], /追加ワード/);

  runtime.removeNgRule('user', 0);
  assert.deepEqual(calls.removed, [['user', 0]]);
  assert.equal(calls.refilters, 2);
});

test('marks the active column interval and applies changes through the column boundary', () => {
  const documentRef = createDocument();
  const { runtime, calls } = createHarness({ documentRef });

  runtime.openColumnSettings('bsky-1', 'bsky');
  const overlay = documentRef.appended[0];
  assert.equal(overlay.id, 'col-settings-ov');
  assert.match(overlay.innerHTML, /class="chip-btn on" data-action="apply-column-interval" data-column-id="bsky-1" data-interval-ms="60000"/);
  assert.match(overlay.innerHTML, /class="chip-btn on"[^>]*data-font-size="13"/);

  runtime.applyColumnInterval('bsky-1', 30000);
  assert.deepEqual(calls.intervals, [['bsky-1', 30000]]);
  assert.equal(calls.persisted, 1);
  assert.equal(calls.toasts.at(-1), 'Auto refresh: 30 sec');
  assert.equal(overlay.removed, true);

  runtime.applyColumnFontSize('bsky-1', 'bsky', 15);
  assert.deepEqual(calls.fontSizes, [['bsky-1', 'bsky', 15]]);
  assert.equal(calls.toasts.at(-1), '文字サイズ: 15px');
});

test('renders memory metrics after opening the memory settings modal', async () => {
  const documentRef = createDocument();
  const metricsTarget = createElement('memory-metrics');
  const { runtime } = createHarness({
    documentRef,
    memoryInterval: 30 * 60000,
    measure: async () => ({
      host: { totalKb: 2048, processCount: 3, groups: { browser: 1024 } },
      runtime: { blueskyItems: 12, blueskyColumns: 2 },
    }),
  });

  runtime.openMemorySettings();
  const overlay = documentRef.appended[0];
  assert.equal(overlay.id, 'mem-settings-ov');
  assert.match(overlay.innerHTML, /class="chip-btn on"[^>]*data-interval-ms="1800000"/);
  documentRef.register(metricsTarget);
  await runtime.refreshMemoryMetrics();
  assert.match(metricsTarget.innerHTML, /2\.0 MB/);
  assert.match(metricsTarget.innerHTML, /Bluesky 12件 \/ 2カラム/);
});

test('reports a memory cleanup result and interval change', async () => {
  const documentRef = createDocument();
  documentRef.register(createElement('memory-metrics'));
  const { runtime, calls } = createHarness({
    documentRef,
    clear: async () => ({
      after: { host: null },
      runtimeCleanup: { blueskyItemsRemoved: 40, xNotificationReadersDisposed: 1 },
    }),
  });

  await runtime.clearMemoryNow(true);
  assert.equal(calls.toasts.at(-1), 'メモリを整理しました（投稿40件・Reader 1個を解放）');

  runtime.applyMemoryInterval(60 * 60000);
  assert.deepEqual(calls.memoryIntervals, [3600000]);
  assert.equal(calls.toasts.at(-1), 'メモリ自動整理: 1時間');
});

test('synchronizes appearance controls through the Appearance Runtime', () => {
  const themeButton = createElement();
  themeButton.dataset.theme = 'dark';
  const swatch = createElement();
  swatch.dataset.accent = '#4e9af0';
  const modal = createElement('appearanceMod');
  const custom = createElement('appearance-custom-color');
  const documentRef = createDocument({
    queries: {
      '.appearance-theme': [themeButton],
      '.appearance-swatch': [swatch],
    },
  });
  documentRef.register(modal);
  documentRef.register(custom);
  const { runtime, calls } = createHarness({ documentRef });

  runtime.openAppearanceSettings();
  assert.equal(calls.appearance[0], 'begin');
  assert.equal(themeButton.classList.contains('primary'), true);
  assert.equal(swatch.classList.contains('selected'), true);
  assert.equal(custom.value, '#4e9af0');
  assert.equal(modal.classList.contains('on'), true);

  runtime.saveAppearance();
  assert.equal(calls.appearance.at(-1), 'commit');
  assert.equal(modal.classList.contains('on'), false);
  assert.equal(calls.toasts.at(-1), 'テーマ設定を保存しました');

  runtime.openAppearanceSettings();
  runtime.cancelAppearance();
  assert.equal(calls.appearance.at(-1), 'cancel');
  assert.equal(modal.classList.contains('on'), false);
});
