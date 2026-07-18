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

test('requests both ancestors and nested replies for a Bluesky conversation', async () => {
  const calls = [];
  const client = createAtprotoClient({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return response({ body: { thread: {} } });
    },
  });

  await client.getThread('access-token', 'at://did:plc:alice/app.bsky.feed.post/1', 12, 12);

  assert.equal(
    calls[0][0],
    'https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=at%3A%2F%2Fdid%3Aplc%3Aalice%2Fapp.bsky.feed.post%2F1&depth=12&parentHeight=12',
  );
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

test('uploads a video with scoped service auth and waits for its blob', async () => {
  const calls = [];
  const responses = [
    { token: 'video-token' },
    { jobStatus: { jobId: 'job-1', state: 'JOB_STATE_ENCODING', progress: 10 } },
    { jobStatus: { jobId: 'job-1', state: 'JOB_STATE_ENCODING', progress: 80 } },
    { jobStatus: { jobId: 'job-1', state: 'JOB_STATE_COMPLETED', blob: { ref: 'video-ref' } } },
  ];
  const client = createAtprotoClient({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return response({ body: responses.shift() });
    },
    nowSeconds: () => 1_000,
    sleep: async () => {},
  });
  const bytes = Buffer.from([4, 5, 6]);

  const blob = await client.uploadVideo('access-token', 'did:plc:alice', 'clip.mp4', bytes);

  assert.deepEqual(blob, { ref: 'video-ref' });
  assert.match(calls[0][0], /com\.atproto\.server\.getServiceAuth\?/);
  assert.match(calls[0][0], /aud=did%3Aweb%3Absky\.social/);
  assert.match(calls[0][0], /lxm=com\.atproto\.repo\.uploadBlob/);
  assert.match(calls[0][0], /exp=2800/);
  assert.equal(calls[1][0], 'https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=did%3Aplc%3Aalice&name=clip.mp4');
  assert.equal(calls[1][1].headers.Authorization, 'Bearer video-token');
  assert.equal(calls[1][1].headers['Content-Type'], 'video/mp4');
  assert.equal(calls[1][1].body, bytes);
  assert.equal(calls[2][0], 'https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=job-1');
});
