const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function load() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'x-notification-capture.js'), 'utf8'), context);
  return context.window.SocialDeckXNotificationCapture;
}

function createStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

function setup({ storage = createStorage() } = {}) {
  let clock = 1000;
  let captured = null;
  const timers = [];
  const firsts = [];
  const capture = load().createXNotificationCapture({
    tap: { attach: async () => true, onCaptured: fn => { captured = fn; } },
    now: () => clock,
    storage,
    setTimeoutFn: fn => { timers.push(fn); return timers.length; },
    clearTimeoutFn: () => {},
    onFirstCapture: partition => firsts.push(partition),
  });
  return {
    capture, storage, timers, firsts,
    tick: ms => { clock += ms; },
    emit: payload => captured({ operation: 'Notifications', requestCursor: '', ...payload }),
  };
}

const item = { id: 'n1', reason: 'like', text: 'liked', postText: 'post', targetId: '9', targetUrl: 'https://x.com/me/status/9', actorHandle: 'shun' };

test('returns notifications captured after the request started', async () => {
  const { capture, emit, tick } = setup();
  await capture.attach(7, 'persist:x-0');
  const waiting = capture.wait('persist:x-0', 1000);
  tick(10);
  emit({ webContentsId: 7, notifications: [item] });
  const [raw] = await waiting;
  assert.equal(raw.captured, true);
  assert.equal(raw.reason, 'like');
  assert.equal(raw.targetId, '9');
  assert.equal(capture.mode('persist:x-0'), 'captured');
});

test('a response older than the request does not count', async () => {
  const { capture, emit, timers } = setup();
  await capture.attach(7, 'persist:x-0');
  emit({ webContentsId: 7, notifications: [item] });
  const waiting = capture.wait('persist:x-0', 5000);
  timers.at(-1)();
  assert.equal(await waiting, null);
});

test('an account switches to the page after X twice sends nothing recognizable', async () => {
  const { capture, timers } = setup();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(capture.mode('persist:x-1'), 'unknown');
    const waiting = capture.wait('persist:x-1', 0);
    timers.at(-1)();
    assert.equal(await waiting, null);
  }
  assert.equal(capture.mode('persist:x-1'), 'page');
});

test('the first capture is remembered across restarts and re-baselines once', async () => {
  const storage = createStorage();
  const first = setup({ storage });
  await first.capture.attach(7, 'persist:x-0');
  first.emit({ webContentsId: 7, notifications: [item] });
  first.emit({ webContentsId: 7, notifications: [item] });
  assert.deepEqual(first.firsts, ['persist:x-0']);
  const restarted = setup({ storage });
  assert.equal(restarted.capture.mode('persist:x-0'), 'captured');
  assert.deepEqual(restarted.firsts, []);
  restarted.capture.forget('persist:x-0');
  assert.equal(restarted.capture.mode('persist:x-0'), 'unknown');
});

test('captures from other WebViews, and continued pages before a first page, are ignored', async () => {
  const { capture, emit } = setup();
  await capture.attach(7, 'persist:x-0');
  emit({ webContentsId: 8, notifications: [item] });
  emit({ webContentsId: 7, notifications: [item], requestCursor: 'OLDER' });
  assert.equal(capture.last('persist:x-0'), null);
});

test('a continued page merges newer notifications into the newest list', async () => {
  const { capture, emit, tick } = setup();
  await capture.attach(7, 'persist:x-0');
  const older = { ...item, id: 'n1', indexedAt: '2026-10-06T10:00:00.000Z' };
  emit({ webContentsId: 7, notifications: [older] });
  tick(10);
  const waiting = capture.wait('persist:x-0', 1005);
  const newer = { ...item, id: 'n2', indexedAt: '2026-10-06T11:00:00.000Z' };
  const updated = { ...older, text: 'liked by 2' };
  emit({ webContentsId: 7, notifications: [newer, updated], requestCursor: 'TOP' });
  const raw = await waiting;
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(raw.map(entry => entry.text)), ['liked', 'liked by 2']);
  assert.deepEqual(plain(capture.last('persist:x-0').map(entry => entry.indexedAt)), [newer.indexedAt, older.indexedAt]);
});
