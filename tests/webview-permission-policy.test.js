const test = require('node:test');
const assert = require('node:assert/strict');

const { denyWebviewPermissions } = require('../src/main/webview-permission-policy');

function createSession() {
  const handlers = {};
  return {
    handlers,
    setPermissionCheckHandler(handler) { handlers.check = handler; },
    setPermissionRequestHandler(handler) { handlers.request = handler; },
  };
}

test('denies every WebView permission during checks and requests', () => {
  const session = createSession();
  assert.equal(denyWebviewPermissions(session), true);

  for (const permission of ['clipboard-read', 'media', 'notifications', 'display-capture', 'unknown']) {
    assert.equal(session.handlers.check(null, permission, 'https://x.com', {}), false);
    let decision = null;
    session.handlers.request(null, permission, value => { decision = value; }, {});
    assert.equal(decision, false);
  }
});

test('configures a shared partition session only once', () => {
  const session = createSession();
  assert.equal(denyWebviewPermissions(session), true);
  const firstCheck = session.handlers.check;
  const firstRequest = session.handlers.request;

  assert.equal(denyWebviewPermissions(session), false);
  assert.equal(session.handlers.check, firstCheck);
  assert.equal(session.handlers.request, firstRequest);
});

test('fails closed when Electron permission hooks are unavailable', () => {
  assert.equal(denyWebviewPermissions(null), false);
  assert.equal(denyWebviewPermissions({}), false);
});
