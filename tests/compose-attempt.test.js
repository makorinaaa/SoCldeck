const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadComposeAttempt() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'compose-attempt.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckComposeAttempt;
}

test('retains the Compose Request when delivery fails', async () => {
  const request = {
    target: { networkId: 'x', accountId: 'alice' },
    text: 'keep this post',
    attachments: [],
    replyTo: null,
  };
  const attempt = loadComposeAttempt().createComposeAttemptRuntime();

  const result = await attempt.submit(request, async () => {
    throw new Error('delivery failed');
  });

  assert.equal(result.status, 'failed');
  assert.strictEqual(result.retainedRequest, request);
  assert.equal(result.error.message, 'delivery failed');
  assert.equal(attempt.getSnapshot().status, 'failed');
});

test('discards the retained Compose Request after a successful retry', async () => {
  const request = {
    target: { networkId: 'b', accountId: 'did:plc:alice' },
    text: 'retry this post',
    attachments: [],
    replyTo: null,
  };
  const attempt = loadComposeAttempt().createComposeAttemptRuntime();

  await attempt.submit(request, async () => {
    throw new Error('temporary failure');
  });
  const result = await attempt.submit(request, async () => 'posted');

  assert.equal(result.status, 'succeeded');
  assert.equal(result.retainedRequest, null);
  assert.equal(result.error, null);
  assert.equal(result.value, 'posted');
});

test('reuses the active submission while delivery is in progress', async () => {
  const request = {
    target: { networkId: 'x', accountId: 'alice' },
    text: 'send once',
    attachments: [],
    replyTo: null,
  };
  const attempt = loadComposeAttempt().createComposeAttemptRuntime();
  let finishDelivery;
  let deliveryCount = 0;
  const deliver = () => {
    deliveryCount += 1;
    return new Promise(resolve => { finishDelivery = resolve; });
  };

  const first = attempt.submit(request, deliver);
  const second = attempt.submit(request, deliver);

  assert.equal(deliveryCount, 1);
  assert.equal(attempt.getSnapshot().status, 'sending');

  finishDelivery('posted');
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.status, 'succeeded');
  assert.strictEqual(secondResult, firstResult);
});

test('discards a retained Compose Request when the user cancels', async () => {
  const request = {
    target: { networkId: 'x', accountId: 'alice' },
    text: 'discard this post',
    attachments: [],
    replyTo: null,
  };
  const attempt = loadComposeAttempt().createComposeAttemptRuntime();
  await attempt.submit(request, async () => {
    throw new Error('delivery failed');
  });

  const result = attempt.reset();

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'idle',
    retainedRequest: null,
    error: null,
  });
});

test('allows retry after delivery throws synchronously', async () => {
  const request = {
    target: { networkId: 'x', accountId: 'alice' },
    text: 'retry synchronous failure',
    attachments: [],
    replyTo: null,
  };
  const attempt = loadComposeAttempt().createComposeAttemptRuntime();

  const failed = await attempt.submit(request, () => {
    throw new Error('synchronous failure');
  });
  const succeeded = await attempt.submit(request, () => 'posted');

  assert.equal(failed.status, 'failed');
  assert.equal(succeeded.status, 'succeeded');
});

test('retains the Compose Request when delivery cannot be confirmed', async () => {
  const request = {
    target: { networkId: 'x', accountId: 'alice' },
    text: 'check before retrying',
    attachments: [],
    replyTo: null,
  };
  const attempt = loadComposeAttempt().createComposeAttemptRuntime();

  const result = await attempt.submit(request, async () => ({
    status: 'unknown',
    reason: 'confirmation-timeout',
  }));

  assert.equal(result.status, 'unknown');
  assert.strictEqual(result.retainedRequest, request);
  assert.equal(result.value.reason, 'confirmation-timeout');
});
