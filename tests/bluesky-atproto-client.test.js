const assert = require('node:assert/strict');
const test = require('node:test');

const { createAtprotoClient } = require('../src/main/bluesky-atproto-client');

function response({ status = 200, body = {} } = {}) {
  const text = body === null ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return text ? JSON.parse(text) : {}; },
    async text() { return text; },
  };
}

test('sends authenticated timeline reads only to the fixed AT Protocol service', async () => {
  const calls = [];
  const client = createAtprotoClient({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return response({ body: { feed: [], cursor: 'next' } });
    },
  });

  const result = await client.timeline('access-token', 20, 'cursor-1');

  assert.deepEqual(result, { feed: [], cursor: 'next' });
  assert.equal(
    calls[0][0],
    'https://bsky.social/xrpc/app.bsky.feed.getTimeline?limit=20&cursor=cursor-1',
  );
  assert.equal(calls[0][1].headers.Authorization, 'Bearer access-token');
});

test('normalizes AT Protocol errors for Gateway refresh decisions', async () => {
  const client = createAtprotoClient({
    fetchImpl: async () => response({
      status: 401,
      body: { error: 'ExpiredToken', message: 'Token has expired' },
    }),
  });

  await assert.rejects(
    client.notifications('expired-token', 40),
    error => error.status === 401 && error.code === 'ExpiredToken' && /expired/i.test(error.message),
  );
});

test('creates post records for the Gateway-selected repository', async () => {
  const calls = [];
  const client = createAtprotoClient({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return response({ body: { uri: 'at://did:plc:alice/app.bsky.feed.post/1' } });
    },
  });
  const record = { $type: 'app.bsky.feed.post', text: 'hello', createdAt: '2026-07-17T00:00:00.000Z' };

  await client.createRecord('access-token', 'did:plc:alice', record);

  assert.equal(calls[0][0], 'https://bsky.social/xrpc/com.atproto.repo.createRecord');
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    repo: 'did:plc:alice',
    collection: 'app.bsky.feed.post',
    record,
  });
});

test('uploads image bytes without JSON conversion', async () => {
  const calls = [];
  const client = createAtprotoClient({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return response({ body: { blob: { ref: 'blob-ref' } } });
    },
  });
  const bytes = Buffer.from([1, 2, 3]);

  const result = await client.uploadBlob('access-token', 'image/png', bytes);

  assert.deepEqual(result, { blob: { ref: 'blob-ref' } });
  assert.equal(calls[0][1].headers['Content-Type'], 'image/png');
  assert.equal(calls[0][1].body, bytes);
});
