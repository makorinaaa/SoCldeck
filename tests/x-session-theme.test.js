const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ensureDefaultXDarkTheme,
  isXSessionAuthenticated,
} = require('../src/main/x-session-theme');

test('sets the black X theme when a session has no theme preference', async () => {
  const writes = [];
  const targetSession = {
    cookies: {
      get: async () => [],
      set: async cookie => writes.push(cookie),
    },
  };

  const changed = await ensureDefaultXDarkTheme(targetSession, () => 1_000_000);

  assert.equal(changed, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, 'night_mode');
  assert.equal(writes[0].value, '2');
  assert.equal(writes[0].expirationDate, 1_000_000 + 60 * 60 * 24 * 365 * 10);
});

test('preserves an existing X theme preference', async () => {
  let writes = 0;
  const targetSession = {
    cookies: {
      get: async () => [{ name: 'night_mode', value: '0' }],
      set: async () => { writes += 1; },
    },
  };

  const changed = await ensureDefaultXDarkTheme(targetSession);

  assert.equal(changed, false);
  assert.equal(writes, 0);
});

test('detects whether an X session has an authentication token', async () => {
  const authenticatedSession = {
    cookies: { get: async () => [{ name: 'auth_token', value: 'token' }] },
  };
  const anonymousSession = {
    cookies: { get: async () => [] },
  };

  assert.equal(await isXSessionAuthenticated(authenticatedSession), true);
  assert.equal(await isXSessionAuthenticated(anonymousSession), false);
});

test('reads only the signed-in user id from the twid cookie', async () => {
  const { getXSessionUserId } = require('../src/main/x-session-theme');
  const sessionWith = value => ({ cookies: { get: async () => (value === null ? [] : [{ value }]) } });
  assert.equal(await getXSessionUserId(sessionWith('u%3D1234567890')), '1234567890');
  assert.equal(await getXSessionUserId(sessionWith('"u=42"')), '42');
  assert.equal(await getXSessionUserId(sessionWith('garbage')), null);
  assert.equal(await getXSessionUserId(sessionWith(null)), null);
});
