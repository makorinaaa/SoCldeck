const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLIENT_HINT_URLS,
  createWebviewBrowserIdentity,
  createWebviewBrowserIdentityPolicy,
} = require('../src/main/webview-browser-identity');

test('the WebView identity reports the engine version without the Electron token', () => {
  const identity = createWebviewBrowserIdentity({ chromeVersion: '150.0.7871.250' });
  assert.match(identity.userAgent, /Chrome\/150\.0\.0\.0 Safari\/537\.36$/);
  assert.doesNotMatch(identity.userAgent, /Electron/);
  assert.equal(identity.clientHints['sec-ch-ua'], '"Chromium";v="150", "Google Chrome";v="150", "Not-A.Brand";v="99"');
  assert.throws(() => createWebviewBrowserIdentity({ chromeVersion: '' }));
});

test('each WebView gets the user agent and each session registers client hints once', () => {
  const policy = createWebviewBrowserIdentityPolicy(createWebviewBrowserIdentity({ chromeVersion: '150.1' }));
  const registrations = [];
  const session = {
    webRequest: {
      onBeforeSendHeaders: (filter, listener) => registrations.push({ filter, listener }),
    },
  };
  const userAgents = [];
  const contents = () => ({ session, setUserAgent: value => userAgents.push(value) });

  assert.equal(policy.apply(contents()), true);
  assert.equal(policy.apply(contents()), false);
  assert.equal(userAgents.length, 2);
  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0].filter, { urls: CLIENT_HINT_URLS });
  assert.ok(CLIENT_HINT_URLS.every(url => !url.includes('twimg')));

  let result;
  registrations[0].listener({ requestHeaders: { Accept: '*/*' } }, value => { result = value; });
  assert.equal(result.requestHeaders.Accept, '*/*');
  assert.equal(result.requestHeaders['sec-ch-ua-platform'], '"Windows"');
});
