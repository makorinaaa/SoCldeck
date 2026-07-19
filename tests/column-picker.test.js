const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'column-picker.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckColumnPicker;
}

const DEFINITIONS = {
  x: [{ id: 'home', icon: '<svg/>', label: 'Home', description: 'X home timeline' }],
  b: [
    { id: 'b-home', icon: '<svg/>', label: 'Following', description: 'Bluesky home' },
    { id: 'b-hidden', icon: '<svg/>', label: 'Hidden', description: 'not in picker', picker: false },
  ],
  anime: [{ id: 'anime-schedule', icon: '<svg/>', label: 'アニメ番組表', description: '今期の放送予定' }],
};

function createHarness({
  accounts = {
    x: [{ username: 'stl', bg: '#123', initials: 'ST' }],
    b: { handle: 'me.bsky.social' },
  },
  createResult = { status: 'created' },
  existingIds = new Set(),
} = {}) {
  const calls = { created: [], toasts: [], closed: [], xListRequests: [], scrolled: 0 };
  const grid = { id: 'opt-grid', innerHTML: '' };
  const modal = {
    id: 'addMod',
    classes: new Set(),
    classList: {
      add(name) { modal.classes.add(name); },
      remove(name) { modal.classes.delete(name); },
    },
  };
  const lastColumn = { scrollIntoView: () => { calls.scrolled += 1; } };
  const documentRef = {
    getElementById(id) {
      if (id === 'opt-grid') return grid;
      if (id === 'addMod') return modal;
      if (id === 'cols') return { querySelector: () => lastColumn };
      if (existingIds.has(id)) return {};
      return null;
    },
  };
  const picker = loadModule().createColumnPicker({
    documentRef,
    getAccounts: () => accounts,
    getColumnDefinitions: networkId => DEFINITIONS[networkId] || [],
    createColumn: plan => {
      calls.created.push(plan);
      return createResult;
    },
    intents: {
      toast: message => calls.toasts.push(message),
      close: modalId => calls.closed.push(modalId),
      requestXListInput: accountIndex => calls.xListRequests.push(accountIndex),
    },
  });
  return { picker, calls, grid, modal };
}

test('renders picker sections per X account with Bluesky and info definitions', () => {
  const { picker, grid, modal } = createHarness();

  picker.open();

  assert.equal(modal.classes.has('on'), true);
  assert.match(grid.innerHTML, /X · stl/);
  assert.match(grid.innerHTML, /data-definition-id="home" data-network="x" data-account-index="0"/);
  assert.match(grid.innerHTML, /Bluesky · @me\.bsky\.social/);
  assert.match(grid.innerHTML, /data-definition-id="b-home" data-network="b"/);
  assert.doesNotMatch(grid.innerHTML, /b-hidden/, 'picker:false definitions stay hidden');
  assert.match(grid.innerHTML, /アニメ番組表/);
});

test('creates a Column with a unique account-scoped id and closes the picker', () => {
  const { picker, calls } = createHarness({
    existingIds: new Set(['col-x0-home-1']),
  });

  picker.addColumn('home', 'x', 0);

  assert.deepEqual(calls.closed, ['addMod']);
  assert.equal(calls.created[0].id, 'x0-home-2', 'skips ids already present in the DOM');
  assert.equal(calls.created[0].networkId, 'x');
  assert.equal(calls.created[0].account.username, 'stl');
  assert.equal(calls.created[0].account.index, 0);
  assert.equal(calls.scrolled, 1);
  assert.deepEqual(calls.toasts, ['Column added']);
});

test('routes an x-list input request instead of creating the Column', () => {
  const { picker, calls } = createHarness({
    createResult: { status: 'input-required', plan: { input: 'x-list' } },
  });

  picker.addColumn('list', 'x', 1);

  assert.deepEqual(calls.xListRequests, [1]);
  assert.deepEqual(calls.toasts, []);
});

test('reports an unavailable Column type', () => {
  const { picker, calls } = createHarness({
    createResult: { status: 'unavailable' },
  });

  picker.addColumn('b-home', 'b');

  assert.deepEqual(calls.toasts, ['Column type is unavailable']);
  assert.equal(calls.scrolled, 0);
});
