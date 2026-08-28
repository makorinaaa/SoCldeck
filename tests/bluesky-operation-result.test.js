const assert = require('node:assert/strict');
const test = require('node:test');

const { executeBlueskyOperation } = require('../src/main/bluesky-operation-result');

test('returns a successful Bluesky operation in a serializable result envelope', async () => {
  const gateway = {
    execute: async (operation, payload) => ({ operation, payload, feed: [] }),
  };

  const result = await executeBlueskyOperation(gateway, 'getTimeline', { limit: 40 });

  assert.deepEqual(result, {
    ok: true,
    data: { operation: 'getTimeline', payload: { limit: 40 }, feed: [] },
  });
});

test('returns Bluesky post and upstream failures without rejecting the IPC handler', async () => {
  const gateway = {
    execute: async () => {
      const error = new Error('Post not found: at://did:plc:deleted/app.bsky.feed.post/1');
      error.name = 'AtprotoError';
      error.status = 400;
      error.code = 'NotFound';
      throw error;
    },
  };

  const result = await executeBlueskyOperation(gateway, 'getThread', { uri: 'at://post/1' });

  assert.deepEqual(result, {
    ok: false,
    error: {
      name: 'AtprotoError',
      message: 'Post not found: at://did:plc:deleted/app.bsky.feed.post/1',
      status: 400,
      code: 'NotFound',
    },
  });
});

test('normalizes transient upstream failures without leaking a stack trace', async () => {
  const gateway = {
    execute: async () => {
      const error = new Error('UpstreamFailure');
      error.name = 'AtprotoError';
      error.status = 502;
      error.code = 'UpstreamFailure';
      throw error;
    },
  };

  const result = await executeBlueskyOperation(gateway, 'getTimeline', {});

  assert.deepEqual(result, {
    ok: false,
    error: {
      name: 'AtprotoError',
      message: 'UpstreamFailure',
      status: 502,
      code: 'UpstreamFailure',
    },
  });
});
