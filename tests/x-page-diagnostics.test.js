const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createXPageDiagnostics, operation } = require('../src/main/x-page-diagnostics');

test('captures repeated detail attempts and errors without recording URLs or credentials', () => {
  const hooks = {};
  const view = new EventEmitter();
  view.id = 42;
  view.getURL = () => 'https://x.com/private_user/status/123';
  view.session = { webRequest: Object.fromEntries(['onSendHeaders', 'onCompleted', 'onErrorOccurred'].map(key => [key, callback => { hooks[key] = callback; }])) };
  let clock = 1000;
  let report;
  const diagnostics = createXPageDiagnostics({ now: () => clock, save: data => { report = data; }, setTimer: () => 1, clearTimer() {} });
  diagnostics.attachContents(view);
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
