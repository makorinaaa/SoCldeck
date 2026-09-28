const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAtprotoClient } = require('../src/main/bluesky-atproto-client');
const { createBlueskyGateway } = require('../src/main/bluesky-gateway');

const identity = { did: 'did:plc:alice', handle: 'alice.test', accessJwt: 'fixture-access', refreshJwt: 'fixture-refresh' };
async function harness(t, respond, timeout = 2000) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const call = { url: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie, body };
    calls.push(call);
    respond(call, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createAtprotoClient({ requestTimeoutMs: timeout, fetchImpl: (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://bsky.social');
    // Transport substitution exists only in the test: production service allowlist is unchanged.
    return fetch(base + target.pathname + target.search, options);
  } });
  let stored = { ...identity };
  const vault = { load: () => stored, save: value => (stored = value), clear: () => (stored = null) };
  return { calls, base, client, vault, gateway: createBlueskyGateway({ client, vault }) };
}
function json(res, body, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

test('unauthenticated calls and foreign record URIs never reach the server', async t => {
  const h = await harness(t, (_req, res) => json(res, {}));
  for (const [op, field, collection] of [['unlike', 'likeUri', 'app.bsky.feed.like'], ['unfollow', 'followUri', 'app.bsky.graph.follow'], ['unrepost', 'repostUri', 'app.bsky.feed.repost']]) {
    await assert.rejects(h.gateway.execute(op, { [field]: `at://did:plc:bob/${collection}/same-key` }), /ownership/);
  }
  h.gateway.clear();
  await assert.rejects(h.gateway.execute('getTimeline'), /unavailable/);
  assert.equal(h.calls.length, 0);
});

test('writes bind to the vault identity despite an injected repoDid', async t => {
  const h = await harness(t, (_req, res) => json(res, { uri: 'fixture' }));
  await h.gateway.execute('createPostRecord', { repoDid: 'did:plc:bob', record: { $type: 'app.bsky.feed.post', text: 'local only' } });
  assert.equal(JSON.parse(h.calls[0].body).repo, identity.did);
  assert.equal(h.calls[0].authorization, 'Bearer fixture-access');
  assert.equal(h.calls[0].cookie, undefined);
});

test('307 redirect cannot forward credentials even to another local endpoint', async t => {
  const h = await harness(t, (_req, res) => { res.writeHead(307, { Location: '/capture' }); res.end(); });
  await assert.rejects(h.client.login('fixture.test', 'fixture-password'));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/xrpc/com.atproto.server.createSession');
});

test('repeated 401 stops after one refresh and one retry', async t => {
  const h = await harness(t, (req, res) => req.url.endsWith('refreshSession')
    ? json(res, { ...identity, accessJwt: 'fixture-renewed' })
    : json(res, { error: 'ExpiredToken' }, 401));
  await assert.rejects(h.gateway.execute('getTimeline'), error => error.status === 401);
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2].authorization, 'Bearer fixture-renewed');
});

test('logout while remote refresh is pending cannot restore the session', async t => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const h = await harness(t, (req, res) => {
    if (req.url.endsWith('refreshSession')) { release = () => json(res, identity); started(); }
    else json(res, { error: 'ExpiredToken' }, 401);
  });
  const rejected = assert.rejects(h.gateway.execute('getTimeline'), /account changed/);
  await ready;
  h.gateway.clear(); release(); await rejected;
  assert.equal(h.vault.load(), null);
  assert.equal(h.calls.length, 2);
});

test('a hanging local response hits the request deadline', async t => {
  const h = await harness(t, () => {}, 100);
  await assert.rejects(h.client.timeline('fixture', 10), error => error.code === 'RequestTimeout');
});

test('malformed success response is rejected rather than reported as successful', async t => {
  const h = await harness(t, (_req, res) => { res.writeHead(200); res.end('<html>upstream error</html>'); });
  await assert.rejects(h.client.createRecord('fixture', identity.did, { $type: 'app.bsky.feed.post', text: 'local' }), /response/i);
});
