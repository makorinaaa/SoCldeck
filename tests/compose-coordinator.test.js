const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createCoordinator() {
  const context = { window: {} };
  for (const moduleName of [
    'compose-attempt.js',
    'cross-post-runtime.js',
    'compose-coordinator.js',
  ]) {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'renderer', moduleName),
      'utf8',
    );
    vm.runInNewContext(source, context);
  }
  const completions = [];
  return {
    coordinator: context.window.SocialDeckComposeCoordinator.createComposeCoordinator({
      createAttemptRuntime:
        context.window.SocialDeckComposeAttempt.createComposeAttemptRuntime,
      createCrossPostRuntime:
        context.window.SocialDeckCrossPostRuntime.createCrossPostRuntime,
      complete: plan => completions.push(plan),
    }),
    completions,
  };
}

test('coordinates a successful single-network attempt and completion', async () => {
  const { coordinator, completions } = createCoordinator();
  const request = { target: { networkId: 'x' }, text: 'hello' };
  const completionPlan = { message: 'Posted to X' };

  const result = await coordinator.submitSingle({
    networkId: 'x',
    request,
    deliver: async retained => ({ status: 'succeeded', text: retained.text }),
    completionPlan,
  });

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(completions, [completionPlan]);
  assert.equal(coordinator.getStatus('x').single.status, 'succeeded');
});

test('retains a failed single request and completes only after retry succeeds', async () => {
  const { coordinator, completions } = createCoordinator();
  const request = { target: { networkId: 'b' }, text: 'keep me' };
  const completionPlan = { message: 'Posted to Bluesky' };
  let attempts = 0;
  const deliver = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return { status: 'succeeded' };
  };

  const failed = await coordinator.submitSingle({
    networkId: 'b', request, deliver, completionPlan,
  });
  assert.equal(failed.status, 'failed');
  assert.strictEqual(coordinator.getStatus('b').single.retainedRequest, request);
  assert.deepEqual(completions, []);

  const succeeded = await coordinator.submitSingle({
    networkId: 'b', request, deliver, completionPlan,
  });
  assert.equal(succeeded.status, 'succeeded');
  assert.deepEqual(completions, [completionPlan]);
});

test('coordinates partial cross-post retries and completes both targets once', async () => {
  const { coordinator, completions } = createCoordinator();
  let xAttempts = 0;
  const entries = [
    {
      id: 'x',
      request: { text: 'shared' },
      deliver: async () => {
        xAttempts += 1;
        if (xAttempts === 1) throw new Error('X failed');
      },
      completionPlan: { message: 'X complete' },
    },
    {
      id: 'b',
      request: { text: 'shared' },
      deliver: async () => {},
      completionPlan: { message: 'Bluesky complete' },
    },
  ];

  assert.equal((await coordinator.submitCrossPost(entries)).status, 'partial');
  assert.deepEqual(completions, []);
  assert.equal((await coordinator.submitCrossPost(entries)).status, 'succeeded');
  assert.equal(xAttempts, 2);
  assert.deepEqual(completions, [
    { message: 'X complete' },
    { message: 'Bluesky complete' },
  ]);
});

test('exposes unknown and sending state without leaking child runtimes', async () => {
  const { coordinator } = createCoordinator();
  let finish;
  const pending = coordinator.submitSingle({
    networkId: 'x',
    request: { text: 'pending' },
    deliver: () => new Promise(resolve => { finish = resolve; }),
    completionPlan: {},
  });

  assert.equal(coordinator.getStatus('x').isSending, true);
  finish({ status: 'unknown' });
  await pending;
  assert.equal(coordinator.getStatus('x').single.status, 'unknown');

  coordinator.reset('x');
  assert.equal(coordinator.getStatus('x').single.status, 'idle');
});
