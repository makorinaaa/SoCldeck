const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GRAPHQL_URLS, createXPageDiagnostics, operation } = require('../src/main/x-page-diagnostics');

test('captures repeated detail attempts and errors without recording URLs or credentials', () => {
  const hooks = {};
  const filters = {};
  const view = new EventEmitter();
  view.id = 42;
  view.getURL = () => 'https://x.com/private_user/status/123';
  view.session = { webRequest: Object.fromEntries(['onSendHeaders', 'onCompleted', 'onErrorOccurred'].map(key => [key, (filter, callback) => {
    filters[key] = filter;
    hooks[key] = callback;
  }])) };
  let clock = 1000;
  let report;
  const diagnostics = createXPageDiagnostics({ now: () => clock, save: data => { report = data; }, setTimer: () => 1, clearTimer() {} });
  diagnostics.attachContents(view);
  for (const filter of Object.values(filters)) assert.deepEqual(filter, { urls: GRAPHQL_URLS });
  const details = { id: 1, webContentsId: 42, url: 'https://x.com/i/api/graphql/query/TweetDetail?variables=SECRET', requestHeaders: { authorization: 'SECRET' } };
  hooks.onSendHeaders(details);
  clock += 15000;
  view.emit('ipc-message', {}, 'x-page-diagnostic', { phase: 'stalled', elapsedMs: 15000, text: 'SECRET' });
  hooks.onErrorOccurred({ ...details, error: 'net::ERR_ABORTED' });
  diagnostics.blocked(details);
  hooks.onSendHeaders({ ...details, id: 2 });
  hooks.onCompleted({ ...details, id: 2, statusCode: 200 });
  diagnostics.flush();
  assert.equal(report.events.find(event => event.type === 'network-error').elapsedMs, 15000);
  assert.ok(report.events.some(event => event.type === 'adblock'));
  assert.ok(report.events.some(event => event.status === 200));
  assert.doesNotMatch(JSON.stringify(report), /SECRET|private_user|https/);
  assert.equal(operation('https://example.com/graphql/id/TweetDetail'), null);
});

test('diagnostic history is bounded', () => {
  let report;
  const diagnostics = createXPageDiagnostics({ save: data => { report = data; }, setTimer: () => 1, clearTimer() {} });
  for (let count = 0; count < 250; count++) diagnostics.blocked({ url: 'https://x.com/i/api/graphql/id/TweetDetail', webContentsId: 1 });
  diagnostics.flush();
  assert.equal(report.events.length, 200);
});

test('only GraphQL requests on X hosts pass the session hook filter', () => {
  // Mirrors Chromium match patterns: "*" in the path matches any characters.
  const matches = url => GRAPHQL_URLS.some(pattern => {
    const [, scheme, host, pathPattern] = pattern.match(/^([^:]+):\/\/([^/]+)(\/.*)$/);
    const parsed = new URL(url);
    const pathRe = new RegExp(`^${pathPattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
    return (scheme === '*' || `${scheme}:` === parsed.protocol) && host === parsed.hostname && pathRe.test(parsed.pathname + parsed.search);
  });
  assert.equal(matches('https://x.com/i/api/graphql/abc/TweetDetail?variables=1'), true);
  assert.equal(matches('https://api.x.com/graphql/abc/TweetResultByRestId'), true);
  assert.equal(matches('https://pbs.twimg.com/media/abc.jpg'), false);
  assert.equal(matches('https://x.com/home'), false);
  for (const url of ['https://x.com/i/api/graphql/abc/TweetDetail', 'https://api.twitter.com/graphql/abc/TweetResultsByRestIds']) {
    assert.ok(operation(url));
    assert.equal(matches(url), true);
  }
});

test('saves asynchronously while running and synchronously on quit', async () => {
  const calls = [];
  let fire;
  const diagnostics = createXPageDiagnostics({
    save: async () => { calls.push('async'); throw new Error('disk full'); },
    saveSync: () => calls.push('sync'),
    setTimer: callback => { fire = callback; return 1; },
    clearTimer() {},
  });
  diagnostics.blocked({ url: 'https://x.com/i/api/graphql/id/TweetDetail', webContentsId: 1 });
  fire();
  await new Promise(resolve => setImmediate(resolve));
  diagnostics.flush();
  assert.deepEqual(calls, ['async', 'sync']);
});
