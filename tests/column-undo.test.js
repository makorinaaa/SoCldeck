const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { window: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'column-undo.js'), 'utf8');
  vm.runInNewContext(source, context);
  return context.window.SocialDeckColumnUndo;
}

function createTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    get pending() { return timers.size; },
  };
}

function createHarness() {
  const timers = createTimers();
  const changes = [];
  const restored = [];
  const undo = loadModule().createColumnUndo({
    capture: id => ({ column: { id } }),
    remove: () => ({ status: 'removed' }),
    restore: snapshot => restored.push(snapshot.column.id),
    canRestore: () => true,
    changed: pending => changes.push(pending ? pending.column.id : null),
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
  });
  return { undo, timers, changes, restored };
}

test('hides the restore notice by itself 10 seconds after a column is removed', () => {
  const { undo, timers, changes } = createHarness();

  undo.remove('col-1');
  timers.advance(9_999);
  assert.deepEqual(changes, ['col-1']);
  timers.advance(1);

  assert.deepEqual(changes, ['col-1', null]);
  assert.equal(undo.undo(), false);
});

test('restarts the 10 seconds when another column is removed', () => {
  const { undo, timers, changes } = createHarness();

  undo.remove('col-1');
  timers.advance(6_000);
  undo.remove('col-2');
  timers.advance(6_000);
  assert.deepEqual(changes, ['col-1', 'col-2']);
  timers.advance(4_000);

  assert.deepEqual(changes, ['col-1', 'col-2', null]);
  assert.equal(timers.pending, 0);
});

test('keeps the notice while the pointer or focus is on it', () => {
  const { undo, timers, changes, restored } = createHarness();

  undo.remove('col-1');
  timers.advance(8_000);
  undo.pauseDismiss();
  timers.advance(60_000);
  assert.deepEqual(changes, ['col-1']);
  undo.resumeDismiss();
  timers.advance(9_999);
  assert.equal(undo.undo(), true);

  assert.deepEqual(restored, ['col-1']);
  assert.equal(timers.pending, 0);
});

test('stops the timer when the notice is closed or undone', () => {
  const { undo, timers } = createHarness();

  undo.remove('col-1');
  undo.clear();
  assert.equal(timers.pending, 0);
  undo.remove('col-2');
  undo.undo();
  assert.equal(timers.pending, 0);
  undo.resumeDismiss();
  assert.equal(timers.pending, 0);
});

test('a notice closed while paused does not stay paused for the next removal', () => {
  const { undo, timers, changes } = createHarness();

  undo.remove('col-1');
  undo.pauseDismiss();
  undo.clear();
  undo.remove('col-2');
  timers.advance(10_000);

  assert.deepEqual(changes, ['col-1', null, 'col-2', null]);
});
