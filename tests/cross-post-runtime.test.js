const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createRuntime() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'cross-post-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckCrossPostRuntime.createCrossPostRuntime();
}

test('restored successes are never resent and unknown outcomes need confirmation', async () => {
  const runtime = createRuntime();
  const calls = [];
  runtime.restore([{ id: 'x', status: 'succeeded' }, { id: 'b', status: 'sending' }]);
  const entries = ['x', 'b'].map(id => ({ id, request: { text: 'hello' }, deliver: async () => calls.push(id) }));
  const unknown = await runtime.submit(entries);
  assert.equal(unknown.status, 'unknown');
  assert.deepEqual(calls, []);
  assert.equal((await runtime.submit(entries, { retryUnknown: true })).status, 'succeeded');
  assert.deepEqual(calls, ['b']);
});

test('reports each completed target before the other target finishes', async () => {
  const runtime = createRuntime();
  let finishBluesky;
  const pending = new Promise(resolve => { finishBluesky = resolve; });
  const progress = [];
  const submission = runtime.submit([
    { id: 'x', deliver: async () => {} },
    { id: 'b', deliver: () => pending },
  ], { onProgress: () => progress.push(runtime.getSnapshot().targets.map(target => target.status).join(',')) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(progress, ['succeeded,sending']);
  finishBluesky();
  await submission;
  assert.equal(progress.at(-1), 'succeeded,succeeded');
});

test('posts to both targets', async () => {
  const calls = [];
  const runtime = createRuntime();
  const result = await runtime.submit([
    { id: 'x', request: { text: 'hello' }, deliver: async () => calls.push('x') },
    { id: 'b', request: { text: 'hello' }, deliver: async () => calls.push('b') },
  ]);

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(calls.sort(), ['b', 'x']);
});

test('retries only the failed target with its retained request', async () => {
  const calls = [];
  let xAttempts = 0;
  const runtime = createRuntime();
  const entries = [
    {
      id: 'x',
      request: { text: 'original' },
      deliver: async request => {
        calls.push(['x', request.text]);
        xAttempts += 1;
        if (xAttempts === 1) throw new Error('X failed');
      },
    },
    { id: 'b', request: { text: 'original' }, deliver: async request => calls.push(['b', request.text]) },
  ];

  assert.equal((await runtime.submit(entries)).status, 'partial');
  assert.equal((await runtime.submit(entries)).status, 'succeeded');
  assert.deepEqual(calls, [['x', 'original'], ['b', 'original'], ['x', 'original']]);
});

test('does not retry an unknown target without confirmation', async () => {
  let calls = 0;
  const runtime = createRuntime();
  const entries = [{
    id: 'x',
    request: {},
    deliver: async () => {
      calls += 1;
      return { status: 'unknown' };
    },
  }];

  assert.equal((await runtime.submit(entries)).status, 'unknown');
  assert.equal((await runtime.submit(entries)).status, 'unknown');
  assert.equal(calls, 1);
});
