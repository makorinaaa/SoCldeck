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
