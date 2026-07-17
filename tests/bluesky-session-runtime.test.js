const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRuntime() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'bluesky-session-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckBlueskySessionRuntime;
}

const PUBLIC_ACCOUNT = {
  handle: 'alice.test',
  did: 'did:plc:alice',
  displayName: 'Alice',
  avatar: 'https://cdn.example/alice.png',
};
const CREDENTIALS = {
  handle: 'alice.test',
  did: 'did:plc:alice',
  accessJwt: 'access-token',
  refreshJwt: 'refresh-token',
};

test('migrates legacy credentials while returning only public Workspace State', async () => {
  const api = loadRuntime();
  const stored = [];
  const runtime = api.createBlueskySessionRuntime({
    vault: {
      store: async session => stored.push(session),
      load: async () => null,
      clear: async () => true,
    },
  });

  const result = await runtime.initialize({ ...PUBLIC_ACCOUNT, ...CREDENTIALS });

  assert.equal(result.status, 'migrated');
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), [CREDENTIALS]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.account)), PUBLIC_ACCOUNT);
  assert.deepEqual(JSON.parse(JSON.stringify(result.workspaceAccount)), PUBLIC_ACCOUNT);
  assert.equal(JSON.stringify(result).includes('Jwt'), false);
});

test('restores only public identity for the matching Network Account', async () => {
  const api = loadRuntime();
  const runtime = api.createBlueskySessionRuntime({
    vault: {
      store: async () => true,
      load: async () => ({ handle: CREDENTIALS.handle, did: CREDENTIALS.did }),
      clear: async () => true,
    },
  });

  const result = await runtime.initialize(PUBLIC_ACCOUNT);

  assert.equal(result.status, 'restored');
  assert.deepEqual(JSON.parse(JSON.stringify(result.account)), PUBLIC_ACCOUNT);
  assert.deepEqual(JSON.parse(JSON.stringify(result.workspaceAccount)), PUBLIC_ACCOUNT);
  assert.equal(JSON.stringify(result).includes('Jwt'), false);
});

test('fails closed when a Vault session belongs to another account', async () => {
  const api = loadRuntime();
  let cleared = 0;
  const runtime = api.createBlueskySessionRuntime({
    vault: {
      store: async () => true,
      load: async () => ({ handle: CREDENTIALS.handle, did: 'did:plc:other' }),
      clear: async () => { cleared += 1; return true; },
    },
  });

  const result = await runtime.initialize(PUBLIC_ACCOUNT);

  assert.equal(result.status, 'mismatch');
  assert.equal(result.account, null);
  assert.equal(result.workspaceAccount, null);
  assert.equal(cleared, 1);
});

test('clears the host-owned session on logout', async () => {
  const api = loadRuntime();
  const events = [];
  const runtime = api.createBlueskySessionRuntime({
    vault: {
      store: async session => events.push(['store', session]),
      load: async () => null,
      clear: async () => { events.push(['clear']); return true; },
    },
  });

  await runtime.clear();

  assert.deepEqual(JSON.parse(JSON.stringify(events)), [['clear']]);
});
