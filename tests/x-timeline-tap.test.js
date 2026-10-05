const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fixture = require('./fixtures/x-home-timeline.json');
const { createXTimelineTap } = require('../src/main/x-timeline-tap');

function createContents({ bodies = {} } = {}) {
  const contents = new EventEmitter();
  const debuggerApi = new EventEmitter();
  debuggerApi.attached = false;
  debuggerApi.commands = [];
  debuggerApi.attach = () => { debuggerApi.attached = true; };
  debuggerApi.detach = () => { debuggerApi.attached = false; };
  debuggerApi.isAttached = () => debuggerApi.attached;
  debuggerApi.sendCommand = async (method, params) => {
    debuggerApi.commands.push(method);
    if (method === 'Network.getResponseBody') return bodies[params.requestId];
    return {};
  };
  contents.debugger = debuggerApi;
  contents.destroyed = false;
  contents.isDestroyed = () => contents.destroyed;
  return contents;
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('reads Home timeline response bodies and ignores other requests', async () => {
  const contents = createContents({
    bodies: {
      home: { body: JSON.stringify(fixture), base64Encoded: false },
      encoded: { body: Buffer.from(JSON.stringify(fixture)).toString('base64'), base64Encoded: true },
    },
  });
  const tap = createXTimelineTap({ resolveContents: id => (id === 7 ? contents : null) });
  const captured = [];
  assert.equal(await tap.attach(7, timeline => captured.push(timeline)), true);
  assert.deepEqual(contents.debugger.commands, ['Network.enable', 'Network.setBlockedURLs']);

  const emit = (method, params) => contents.debugger.emit('message', {}, method, params);
  emit('Network.responseReceived', { requestId: 'other', response: { url: 'https://x.com/i/api/graphql/q/UserTweets', status: 200 } });
  emit('Network.loadingFinished', { requestId: 'other' });
  emit('Network.responseReceived', { requestId: 'home', response: { url: 'https://x.com/i/api/graphql/q/HomeTimeline', status: 200 } });
  emit('Network.loadingFinished', { requestId: 'home' });
  emit('Network.responseReceived', { requestId: 'encoded', response: { url: 'https://x.com/i/api/graphql/q/HomeLatestTimeline', status: 200 } });
  emit('Network.loadingFinished', { requestId: 'encoded' });
  await flush();

  assert.equal(contents.debugger.commands.filter(name => name === 'Network.getResponseBody').length, 2);
  assert.deepEqual(captured.map(item => item.timeline), ['for-you', 'following']);
  assert.equal(captured[0].posts.length, 3);
});

test('refuses contents that are missing or already debugged and cleans up on destroy', async () => {
  const busy = createContents();
  busy.debugger.attached = true;
  const contents = createContents();
  const tap = createXTimelineTap({ resolveContents: id => ({ 1: busy, 2: contents }[id] || null) });
  assert.equal(await tap.attach(1, () => {}), false);
  assert.equal(await tap.attach(3, () => {}), false);
  assert.equal(await tap.attach(2, () => {}), true);
  contents.emit('destroyed');
  assert.equal(tap.isAttached(2), false);
  assert.equal(contents.debugger.listenerCount('message'), 0);
});

test('detach releases the debugger', async () => {
  const contents = createContents();
  const tap = createXTimelineTap({ resolveContents: () => contents });
  await tap.attach(5, () => {});
  assert.equal(tap.detach(5), true);
  assert.equal(contents.debugger.attached, false);
  assert.equal(tap.detach(5), false);
});

test('marks continued timeline pages by the cursor in the request', async () => {
  const { requestCursor } = require('../src/main/x-timeline-tap');
  const vars = value => encodeURIComponent(JSON.stringify(value));
  assert.equal(requestCursor({ url: `https://x.com/i/api/graphql/q/HomeLatestTimeline?variables=${vars({ count: 20 })}` }), '');
  assert.equal(requestCursor({ url: `https://x.com/i/api/graphql/q/HomeLatestTimeline?variables=${vars({ cursor: 'BOTTOM' })}` }), 'BOTTOM');
  assert.equal(requestCursor({ url: 'https://x.com/i/api/graphql/q/HomeTimeline', postData: JSON.stringify({ variables: { cursor: 'TOP' } }) }), 'TOP');
  assert.equal(requestCursor({ url: 'https://x.com/i/api/graphql/q/HomeTimeline', postData: 'not json' }), '');

  const contents = createContents({ bodies: { first: { body: JSON.stringify(fixture), base64Encoded: false }, next: { body: JSON.stringify(fixture), base64Encoded: false } } });
  const tap = createXTimelineTap({ resolveContents: () => contents });
  const captured = [];
  await tap.attach(3, timeline => captured.push(timeline.requestCursor));
  const emit = (method, params) => contents.debugger.emit('message', {}, method, params);
  const url = 'https://x.com/i/api/graphql/q/HomeTimeline';
  emit('Network.requestWillBeSent', { requestId: 'first', request: { url, postData: JSON.stringify({ variables: { count: 20 } }) } });
  emit('Network.requestWillBeSent', { requestId: 'next', request: { url, postData: JSON.stringify({ variables: { cursor: 'BOTTOM' } }) } });
  for (const requestId of ['first', 'next']) {
    emit('Network.responseReceived', { requestId, response: { url, status: 200 } });
    emit('Network.loadingFinished', { requestId });
  }
  await flush();
  assert.deepEqual(captured, ['', 'BOTTOM']);
});

test('only a page load without seen posts counts as a complete first page', async () => {
  const contents = createContents({ bodies: { load: { body: JSON.stringify(fixture), base64Encoded: false }, poll: { body: JSON.stringify(fixture), base64Encoded: false }, unknown: { body: JSON.stringify(fixture), base64Encoded: false } } });
  const tap = createXTimelineTap({ resolveContents: () => contents });
  const captured = [];
  await tap.attach(4, timeline => captured.push(timeline.firstPage));
  const emit = (method, params) => contents.debugger.emit('message', {}, method, params);
  const url = 'https://x.com/i/api/graphql/q/HomeLatestTimeline';
  emit('Network.requestWillBeSent', { requestId: 'load', request: { url, postData: JSON.stringify({ variables: { count: 20 } }) } });
  emit('Network.requestWillBeSent', { requestId: 'poll', request: { url, postData: JSON.stringify({ variables: { seenTweetIds: ['1'] } }) } });
  for (const requestId of ['load', 'poll', 'unknown']) {
    emit('Network.responseReceived', { requestId, response: { url, status: 200 } });
    emit('Network.loadingFinished', { requestId });
  }
  await flush();
  assert.deepEqual(captured, [true, false, false]);
});

test('hidden pages block X media but never X scripts or API calls', async () => {
  const { HIDDEN_PAGE_BLOCKED_URLS } = require('../src/main/x-timeline-tap');
  // CDP URL patterns: '*' matches any characters.
  const toRegExp = pattern => new RegExp(`^${pattern.split('*').map(part => part.replace(/[.?+^$()|[\]{}\\/]/g, '\\$&')).join('.*')}$`);
  const blocked = url => HIDDEN_PAGE_BLOCKED_URLS.some(pattern => toRegExp(pattern).test(url));
  assert.equal(blocked('https://pbs.twimg.com/media/A.jpg?name=small'), true);
  assert.equal(blocked('https://video.twimg.com/ext_tw_video/1/pu/vid/a.mp4'), true);
  assert.equal(blocked('https://abs.twimg.com/responsive-web/client-web/main.js'), false);
  assert.equal(blocked('https://x.com/i/api/graphql/q/HomeTimeline'), false);
  assert.equal(blocked('https://upload.x.com/i/media/upload.json'), false);

  // Capturing still works when media blocking is unavailable.
  const contents = createContents();
  const original = contents.debugger.sendCommand;
  contents.debugger.sendCommand = async (method, params) => {
    if (method === 'Network.setBlockedURLs') throw new Error('unsupported');
    return original(method, params);
  };
  const tap = createXTimelineTap({ resolveContents: () => contents, logger: { warn() {} } });
  assert.equal(await tap.attach(8, () => {}), true);
  assert.equal(tap.isAttached(8), true);
});
