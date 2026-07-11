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
    createPlan: storedColumn => {
      if (storedColumn.id === failId) return null;
      return {
        kind: storedColumn.kind,
        refresh: { kind: storedColumn.kind },
        config: {
          id: storedColumn.id,
          network: storedColumn.kind === 'wv' ? 'x' : 'b',
          definitionId: storedColumn.kind === 'wv' ? 'x-home-new' : 'b-timeline-new',
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
