const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadComposeCompletion() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'compose-completion.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckComposeCompletion;
}

test('notifies immediately and schedules the planned refresh', async () => {
  const events = [];
  let scheduledTask;
  const runtime = loadComposeCompletion().createComposeCompletionRuntime({
    notify: message => events.push(['notify', message]),
    refresh: target => events.push(['refresh', target]),
    schedule: (task, delayMs) => {
      events.push(['schedule', delayMs]);
      scheduledTask = task;
    },
  });

  runtime.complete({
    message: 'Posted',
    refresh: { kind: 'timeline' },
    delayMs: 1200,
  });

  assert.deepEqual(events, [
    ['notify', 'Posted'],
    ['schedule', 1200],
  ]);

  await scheduledTask();
  assert.deepEqual(events, [
    ['notify', 'Posted'],
    ['schedule', 1200],
    ['refresh', { kind: 'timeline' }],
  ]);
});

test('reports refresh errors without rejecting the scheduled task', async () => {
  const errors = [];
  let scheduledTask;
  const runtime = loadComposeCompletion().createComposeCompletionRuntime({
    notify: () => {},
    refresh: async () => { throw new Error('refresh failed'); },
    onRefreshError: error => errors.push(error.message),
    schedule: task => { scheduledTask = task; },
  });

  runtime.complete({ message: 'Posted', refresh: { kind: 'timeline' }, delayMs: 0 });

  await scheduledTask();
  assert.deepEqual(errors, ['refresh failed']);
});
