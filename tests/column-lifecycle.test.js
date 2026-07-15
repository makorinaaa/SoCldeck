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
  const scheduled = {};
  const refreshStates = [];
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
    scheduleRefresh: (id, interval, callback) => {
      events.push(['schedule', id, interval]);
      scheduled[id] = callback;
    },
    clearRefreshSchedule: id => events.push(['clear-refresh', id]),
    executeRefresh: (id, plan) => events.push(['execute-refresh', id, plan.kind]),
    onRefreshStateChange: (id, state) => refreshStates.push([id, state]),
    now: () => new Date('2026-07-12T03:04:05.000Z'),
    insertPlan: plan => {
      events.push(['insert', plan.config.id]);
      return true;
    },
    applyWidth: (id, width) => events.push(['width', id, width]),
    applyCollapsed: id => events.push(['collapsed', id]),
    reportRestoreError: (storedColumn, error) => errors.push([storedColumn.id, error.message]),
    cleanupRuntimeState: id => events.push(['cleanup-runtime', id]),
    removeElement: id => {
      events.push(['remove-element', id]);
      return true;
    },
    persistWorkspace: () => events.push(['persist']),
  });
  return { lifecycle, events, saved, errors, scheduled, refreshStates };
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
    ['insert', 'x-home-2'],
    ['persist'],
  ]);
});

test('rejects a duplicate Column id without inserting or persisting it', async () => {
  const { lifecycle, events } = createHarness();
  lifecycle.create({ networkId: 'wv', definitionId: 'home', id: 'duplicate' });
  events.length = 0;

  const result = lifecycle.create({ networkId: 'bsky', definitionId: 'timeline', id: 'duplicate' });

  assert.equal(result.status, 'failed');
  assert.match(result.error.message, /already materialized/);
  assert.deepEqual(events, []);

  await lifecycle.refreshNow('duplicate');
  assert.deepEqual(events, [['execute-refresh', 'duplicate', 'wv']]);
});

test('returns an input requirement without registering an incomplete Column', () => {
  const events = [];
  const lifecycle = loadFactory()({
    createPlan: () => ({ kind: 'input-required', input: 'x-list' }),
    insertPlan: () => events.push('insert'),
  });

  const result = lifecycle.create({ networkId: 'x', definitionId: 'x-list-new' });

  assert.equal(result.status, 'input-required');
  assert.deepEqual(events, []);
});

test('removes a Column after cleaning all Runtime State', () => {
  const { lifecycle, events } = createHarness();

  const result = lifecycle.remove('timeline');

  assert.equal(result.status, 'removed');
  assert.deepEqual(events, [
    ['clear-refresh', 'timeline'],
    ['cleanup-runtime', 'timeline'],
    ['remove-element', 'timeline'],
    ['persist'],
  ]);
});

test('does not persist when a Column element no longer exists', () => {
  const events = [];
  const lifecycle = loadFactory()({
    createPlan: () => null,
    insertPlan: () => false,
    clearRefreshSchedule: id => events.push(['clear-refresh', id]),
    cleanupRuntimeState: id => events.push(['cleanup-runtime', id]),
    removeElement: id => {
      events.push(['remove-element', id]);
      return false;
    },
    persistWorkspace: () => events.push(['persist']),
  });

  const result = lifecycle.remove('missing');

  assert.equal(result.status, 'not-found');
  assert.deepEqual(events, [
    ['clear-refresh', 'missing'],
    ['cleanup-runtime', 'missing'],
    ['remove-element', 'missing'],
  ]);
});

test('reports refresh progress and completion when its schedule fires', async () => {
  const { lifecycle, events, scheduled, refreshStates } = createHarness();
  lifecycle.create({ networkId: 'wv', definitionId: 'home', id: 'x-home-3' });

  lifecycle.setRefreshInterval('x-home-3', 30000);
  await scheduled['x-home-3']();

  assert.deepEqual(events.slice(-3), [
    ['clear-refresh', 'x-home-3'],
    ['schedule', 'x-home-3', 30000],
    ['execute-refresh', 'x-home-3', 'wv'],
  ]);
  assert.equal(refreshStates[0][1].status, 'refreshing');
  assert.equal(refreshStates[1][1].status, 'succeeded');
  assert.equal(refreshStates[1][1].lastUpdatedAt.toISOString(), '2026-07-12T03:04:05.000Z');
});

test('reports a deferred refresh without changing the last successful time', async () => {
  const states = [];
  const lifecycle = loadFactory()({
    createPlan: request => ({
      kind: 'wv',
      refresh: { kind: 'wv' },
      config: { id: request.id, network: 'x', definitionId: request.definitionId },
    }),
    insertPlan: () => true,
    executeRefresh: async () => ({ status: 'deferred', detail: 'reading' }),
    onRefreshStateChange: (id, state) => states.push(state),
  });
  lifecycle.create({ networkId: 'x', definitionId: 'home', id: 'x-home-4' });

  const result = await lifecycle.refreshNow('x-home-4');

  assert.equal(result.status, 'deferred');
  assert.equal(states.at(-1).status, 'deferred');
  assert.equal(states.at(-1).lastUpdatedAt, undefined);
});

test('refreshes every registered plan exactly once and returns the results', async () => {
  const calls = [];
  const lifecycle = loadFactory()({
    createPlan: request => ({
      kind: request.networkId,
      refresh: { kind: request.networkId },
      config: { id: request.id, network: request.networkId, definitionId: request.definitionId },
    }),
    insertPlan: () => true,
    executeRefresh: async (id, plan) => {
      calls.push([id, plan.kind]);
      return { status: 'succeeded', detail: `${id}-refreshed` };
    },
  });
  lifecycle.create({ networkId: 'x', definitionId: 'home', id: 'first' });
  lifecycle.create({ networkId: 'b', definitionId: 'timeline', id: 'second' });

  const results = await lifecycle.refreshAll();

  assert.deepEqual(calls, [
    ['first', 'x'],
    ['second', 'b'],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(results)), [
    { status: 'succeeded', detail: 'first-refreshed' },
    { status: 'succeeded', detail: 'second-refreshed' },
  ]);
});

test('clears refresh and Runtime State for every registered Column without persisting', async () => {
  const { lifecycle, events } = createHarness();
  lifecycle.create({ networkId: 'wv', definitionId: 'home', id: 'first' });
  lifecycle.create({ networkId: 'bsky', definitionId: 'timeline', id: 'second' });
  lifecycle.setRefreshInterval('first', 1000);
  events.length = 0;

  lifecycle.clear();

  assert.deepEqual(events, [
    ['clear-refresh', 'first'],
    ['cleanup-runtime', 'first'],
    ['clear-refresh', 'second'],
    ['cleanup-runtime', 'second'],
  ]);
  assert.equal((await lifecycle.refreshNow('first')).status, 'failed');
});

test('clear can remove registered elements without persisting', () => {
  const { lifecycle, events } = createHarness();
  lifecycle.create({ networkId: 'wv', definitionId: 'home', id: 'first' });
  lifecycle.create({ networkId: 'bsky', definitionId: 'timeline', id: 'second' });
  events.length = 0;

  lifecycle.clear({ removeElements: true });

  assert.deepEqual(events, [
    ['clear-refresh', 'first'],
    ['cleanup-runtime', 'first'],
    ['remove-element', 'first'],
    ['clear-refresh', 'second'],
    ['cleanup-runtime', 'second'],
    ['remove-element', 'second'],
  ]);
});

test('clear can remove an unregistered restore error element', () => {
  const events = [];
  const lifecycle = loadFactory()({
    createPlan: () => null,
    insertPlan: () => false,
    listElementIds: () => ['restore-error'],
    clearRefreshSchedule: id => events.push(['clear-refresh', id]),
    cleanupRuntimeState: id => events.push(['cleanup-runtime', id]),
    removeElement: id => {
      events.push(['remove-element', id]);
      return true;
    },
  });

  lifecycle.clear({ removeElements: true });

  assert.deepEqual(events, [
    ['clear-refresh', 'restore-error'],
    ['cleanup-runtime', 'restore-error'],
    ['remove-element', 'restore-error'],
  ]);
});

test('removes registration when materialization fails so the id can be retried', async () => {
  let shouldInsert = false;
  const events = [];
  const lifecycle = loadFactory()({
    createPlan: request => ({
      kind: 'wv',
      refresh: { kind: 'wv' },
      config: { id: request.id, network: 'x', definitionId: request.definitionId },
    }),
    insertPlan: plan => {
      events.push(['insert', plan.config.id]);
      return shouldInsert;
    },
    clearRefreshSchedule: id => events.push(['clear-refresh', id]),
    persistWorkspace: () => events.push(['persist']),
  });

  const failed = lifecycle.create({ networkId: 'x', definitionId: 'home', id: 'retry' });
  const refreshAfterFailure = await lifecycle.refreshNow('retry');
  shouldInsert = true;
  const retried = lifecycle.create({ networkId: 'x', definitionId: 'home', id: 'retry' });

  assert.equal(failed.status, 'failed');
  assert.equal(refreshAfterFailure.status, 'failed');
  assert.equal(retried.status, 'created');
  assert.deepEqual(events, [
    ['insert', 'retry'],
    ['clear-refresh', 'retry'],
    ['insert', 'retry'],
    ['persist'],
  ]);
});

test('rolls back the mounted Column when workspace persistence fails', async () => {
  const events = [];
  const lifecycle = loadFactory()({
    createPlan: request => ({
      kind: 'wv',
      refresh: { kind: 'wv' },
      config: { id: request.id, network: 'x', definitionId: request.definitionId },
    }),
    insertPlan: plan => {
      events.push(['insert', plan.config.id]);
      return true;
    },
    clearRefreshSchedule: id => events.push(['clear-refresh', id]),
    cleanupRuntimeState: id => events.push(['cleanup-runtime', id]),
    removeElement: id => {
      events.push(['remove-element', id]);
      return true;
    },
    persistWorkspace: () => { throw new Error('storage unavailable'); },
  });

  const result = lifecycle.create({ networkId: 'x', definitionId: 'home', id: 'rollback' });
  const refreshResult = await lifecycle.refreshNow('rollback');

  assert.equal(result.status, 'failed');
  assert.match(result.error.message, /storage unavailable/);
  assert.equal(refreshResult.status, 'failed');
  assert.deepEqual(events, [
    ['insert', 'rollback'],
    ['clear-refresh', 'rollback'],
    ['cleanup-runtime', 'rollback'],
    ['remove-element', 'rollback'],
  ]);
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
    ['insert', 'x-home-1'],
    ['clear-refresh', 'x-home-1'],
    ['schedule', 'x-home-1', 15000],
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
    ['clear-refresh', 'broken'],
    ['insert', 'timeline'],
  ]);
  assert.deepEqual(saved, []);
  assert.deepEqual(result.normalizedLayout[0], layout[0]);
});
