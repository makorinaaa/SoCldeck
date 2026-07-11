const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadFactory() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'column-lifecycle.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckColumnLifecycle.createColumnLifecycle;
}

function createHarness({ failId } = {}) {
  const events = [];
  const saved = [];
  const errors = [];
  const lifecycle = loadFactory()({
    createPlan: request => {
      const storedColumn = request.storedColumn || request;
      if (storedColumn.id === failId) return null;
      const kind = storedColumn.kind || request.networkId;
      return {
        kind,
        refresh: { kind },
        config: {
          id: storedColumn.id,
          network: kind === 'wv' ? 'x' : 'b',
          definitionId: kind === 'wv' ? 'x-home-new' : 'b-timeline-new',
        },
      };
    },
    registerRefresh: (id, refresh) => events.push(['register', id, refresh.kind]),
    cleanupRefresh: id => events.push(['cleanup', id]),
    insertPlan: plan => {
      events.push(['insert', plan.config.id]);
      return true;
    },
    setRefreshInterval: (id, interval) => events.push(['interval', id, interval]),
    applyWidth: (id, width) => events.push(['width', id, width]),
    applyCollapsed: id => events.push(['collapsed', id]),
    reportRestoreError: (storedColumn, error) => errors.push([storedColumn.id, error.message]),
  });
  return { lifecycle, events, saved, errors };
}

test('creates a Column from a Definition through its lifecycle interface', () => {
  const { lifecycle, events } = createHarness();

  const result = lifecycle.create({
    networkId: 'wv',
    definitionId: 'home',
    id: 'x-home-2',
  });

  assert.equal(result.status, 'created');
  assert.equal(result.id, 'x-home-2');
  assert.deepEqual(events, [
    ['register', 'x-home-2', 'wv'],
    ['insert', 'x-home-2'],
  ]);
});

test('returns an input requirement without registering an incomplete Column', () => {
  const events = [];
  const lifecycle = loadFactory()({
    createPlan: () => ({ kind: 'input-required', input: 'x-list' }),
    registerRefresh: () => events.push('register'),
    insertPlan: () => events.push('insert'),
  });

  const result = lifecycle.create({ networkId: 'x', definitionId: 'x-list-new' });

  assert.equal(result.status, 'input-required');
  assert.deepEqual(events, []);
});

test('restores Column lifecycle state through a Network Adapter plan', () => {
  const { lifecycle, events, saved } = createHarness();
  const layout = [{
    kind: 'wv',
    id: 'x-home-1',
    interval: 15000,
    width: '420px',
    collapsed: true,
  }];

  const result = lifecycle.restore(layout, {
    persistNormalized: normalized => saved.push(normalized),
  });

  assert.deepEqual(events, [
    ['register', 'x-home-1', 'wv'],
    ['insert', 'x-home-1'],
    ['interval', 'x-home-1', 15000],
    ['width', 'x-home-1', '420px'],
    ['collapsed', 'x-home-1'],
  ]);
  assert.equal(result.restoredCount, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [[{
    ...layout[0],
    network: 'x',
    definitionId: 'x-home-new',
  }]]);
});

test('isolates a failed Column and preserves the original Workspace State', () => {
  const { lifecycle, events, saved, errors } = createHarness({ failId: 'broken' });
  const layout = [
    { kind: 'wv', id: 'broken', title: 'Unknown' },
    { kind: 'bsky', id: 'timeline' },
  ];

  const result = lifecycle.restore(layout, {
    persistNormalized: normalized => saved.push(normalized),
  });

  assert.equal(result.restoredCount, 1);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(errors, [['broken', 'Column Definition could not be resolved']]);
  assert.deepEqual(events, [
    ['cleanup', 'broken'],
    ['register', 'timeline', 'bsky'],
    ['insert', 'timeline'],
  ]);
  assert.deepEqual(saved, []);
  assert.deepEqual(result.normalizedLayout[0], layout[0]);
});
