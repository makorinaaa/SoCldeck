const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function load() {
  const context = { window: {}, URL };
  for (const name of ['x-status-actions.js', 'x-status-runtime.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8'), context);
  }
  return context.window;
}

const immediate = (fn) => { fn(); return 0; };

function createArticle(statusId, { liked = false, reposted = false } = {}) {
  const state = { liked, reposted, clicks: [] };
  const link = { getAttribute: () => `/alice/status/${statusId}`, querySelector: selector => (selector === 'time' ? {} : null) };
  const button = testId => ({ click() { state.clicks.push(testId); if (testId === 'like') state.liked = true; if (testId === 'unlike') state.liked = false; } });
  const article = {
    state,
    querySelectorAll: () => [link],
    querySelector: selector => {
      const testId = /data-testid="([^"]+)"/.exec(selector)?.[1];
      if (testId === 'like' && !state.liked) return button('like');
      if (testId === 'unlike' && state.liked) return button('unlike');
      if (testId === 'retweet' && !state.reposted) return button('retweet');
      if (testId === 'unretweet' && state.reposted) return button('unretweet');
      return null;
    },
  };
  return article;
}

function createDocument(article) {
  return {
    location: { pathname: '/alice/status/1' },
    menuOpen: false,
    querySelectorAll: () => (article ? [article] : []),
    querySelector(selector) {
      if (selector === '[data-testid="retweetConfirm"]' && article.state.clicks.at(-1) === 'retweet') {
        return { click() { article.state.reposted = true; article.state.clicks.push('retweetConfirm'); } };
      }
      return null;
    },
  };
}

test('finds the focal status article by its timestamp link', () => {
  const { findStatusArticle } = load().SocialDeckXStatusActions;
  const article = createArticle('1');
  assert.equal(findStatusArticle(createDocument(article), '1'), article);
  assert.equal(findStatusArticle(createDocument(article), '2'), null);
});

test('likes through X controls and reports already-applied states', async () => {
  const { toggleStatusReaction, findStatusArticle } = load().SocialDeckXStatusActions;
  const article = createArticle('1');
  const documentLike = createDocument(article);
  const options = { documentLike, statusId: '1', action: 'like', find: findStatusArticle, schedule: immediate };
  assert.equal(await toggleStatusReaction({ ...options, active: true }), 'done');
  assert.deepEqual(article.state.clicks, ['like']);
  assert.equal(await toggleStatusReaction({ ...options, active: true }), 'already');
  assert.equal(await toggleStatusReaction({ ...options, active: false }), 'done');
  assert.equal(await toggleStatusReaction({ ...options, statusId: '9', active: true }), 'missing');
});

test('reposts by confirming X repost menu', async () => {
  const { toggleStatusReaction, findStatusArticle } = load().SocialDeckXStatusActions;
  const article = createArticle('1');
  const result = await toggleStatusReaction({
    documentLike: createDocument(article), statusId: '1', action: 'repost', active: true,
    find: findStatusArticle, schedule: immediate,
  });
  assert.equal(result, 'done');
  assert.deepEqual(article.state.clicks, ['retweet', 'retweetConfirm']);
});

test('only X status URLs that match the post id become navigation paths', () => {
  const { statusPath, createToggleScript } = load().SocialDeckXStatusActions;
  assert.equal(statusPath({ id: '12', url: 'https://x.com/alice/status/12' }), '/alice/status/12');
  assert.equal(statusPath({ id: '12', url: 'https://x.com/alice/status/13' }), null);
  assert.equal(statusPath({ id: '12', url: 'https://evil.example/alice/status/12' }), null);
  assert.equal(statusPath({ id: '12', url: 'javascript:alert(1)' }), null);
  assert.throws(() => createToggleScript({ statusId: '1', action: 'delete', active: true }));
});

function createStatusHarness({ waitResults = [] } = {}) {
  const window = load();
  const scripts = [];
  const loads = [];
  const listeners = {};
  const webview = {
    setAttribute() {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    getWebContentsId: () => 55,
    loadURL: url => { loads.push(url); return Promise.resolve(); },
    executeJavaScript: script => {
      scripts.push(script);
      if (script.includes('waitForStatus')) {
        return Promise.resolve(waitResults.length ? waitResults.shift() : 'ready');
      }
      return Promise.resolve('done');
    },
    remove() { this.removed = true; },
  };
  const attached = [];
  const runtime = window.SocialDeckXStatusRuntime.createXStatusRuntime({
    documentRef: { createElement: () => webview },
    getHost: () => ({ appendChild() {} }),
    tap: { attach: async id => { attached.push(id); return true; }, detach: async () => true },
  });
  const ready = () => Promise.all((listeners['dom-ready'] || []).map(fn => fn()));
  return { runtime, webview, scripts, loads, attached, ready };
}

test('status runtime loads the first status, then navigates in place', async () => {
  const harness = createStatusHarness();
  const first = harness.runtime.run('persist:x-0', { id: '1', url: 'https://x.com/alice/status/1' }, async () => 'task-1');
  await harness.ready();
  assert.equal(await first, 'task-1');
  assert.deepEqual(harness.attached, [55]);
  assert.deepEqual(harness.loads, ['https://x.com/alice/status/1']);
  assert.equal(harness.runtime.partitionOf(55), 'persist:x-0');

  const result = await harness.runtime.toggle('persist:x-0', { id: '2', url: 'https://x.com/bob/status/2' }, 'like', true);
  assert.equal(result, 'done');
  assert.equal(harness.loads.length, 1, 'second status uses in-page navigation');
  assert.ok(harness.scripts.some(script => script.includes('"/bob/status/2"')));
  assert.ok(harness.scripts.at(-1).includes('"like"'));
});

test('status runtime reports a login wall and rejects bad URLs', async () => {
  const harness = createStatusHarness({ waitResults: ['login'] });
  const pending = harness.runtime.run('persist:x-0', { id: '1', url: 'https://x.com/alice/status/1' });
  await harness.ready();
  await assert.rejects(pending, /ログイン/);
  await assert.rejects(harness.runtime.run('persist:x-0', { id: '1', url: 'https://x.com/alice/status/2' }), /URL/);
});

test('opens X reply composer from the post and retires any other reply box', async () => {
  const { openReplyComposer, findStatusArticle } = load().SocialDeckXStatusActions;
  const body = { querySelector: () => null, querySelectorAll: () => [] };
  const makeBox = parentElement => {
    const box = { parentElement, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    return box;
  };
  // Inline box with no toolbar anywhere near it.
  const inlineScope = { parentElement: body, querySelector: () => null, querySelectorAll: () => [] };
  const inline = makeBox(inlineScope);
  let dialogBox = null;
  const dialogScope = {
    parentElement: body,
    querySelector: selector => (selector === '[data-testid="toolBar"]' || selector.includes('tweetButton') ? {} : null),
    querySelectorAll: () => [dialogBox],
  };
  const article = createArticle('1');
  article.querySelector = selector => (selector === '[data-testid="reply"]'
    ? { click() { dialogBox = makeBox(dialogScope); } }
    : null);
  const documentLike = {
    body,
    querySelectorAll: selector => (selector.includes('tweetTextarea_0')
      ? [inline, ...(dialogBox ? [dialogBox] : [])]
      : [article]),
  };
  const result = await openReplyComposer({ documentLike, statusId: '1', find: findStatusArticle, schedule: immediate });
  assert.equal(result.status, 'ready');
  assert.equal(inline.attributes['data-testid'], 'sd-inactive-tweetTextarea');
  assert.equal(dialogBox.attributes['data-testid'], undefined);

  const missing = await openReplyComposer({
    documentLike: { body, querySelectorAll: () => [] }, statusId: '1', find: findStatusArticle, schedule: immediate,
  });
  assert.equal(missing.status, 'post-missing');
});

test('fails fast when the opened composer has no Reply button next to its toolbar', async () => {
  const { openReplyComposer, findStatusArticle } = load().SocialDeckXStatusActions;
  const body = {};
  let box = null;
  const scope = {
    parentElement: body,
    querySelector: selector => (selector === '[data-testid="toolBar"]' ? {} : null),
    querySelectorAll: () => [box],
  };
  const article = createArticle('1');
  article.querySelector = selector => (selector === '[data-testid="reply"]'
    ? { click() { box = { parentElement: scope, setAttribute() {} }; } }
    : null);
  const documentLike = {
    body,
    querySelectorAll: selector => (selector.includes('tweetTextarea_0') ? (box ? [box] : []) : [article]),
  };
  const result = await openReplyComposer({ documentLike, statusId: '1', find: findStatusArticle, schedule: immediate });
  assert.equal(result.status, 'composer-missing');
});

test('follows a notification on X notification page to its post', async () => {
  const harness = createStatusHarness();
  harness.webview.executeJavaScript = script => {
    harness.scripts.push(script);
    if (script === 'ACTIVATE') return Promise.resolve(true);
    if (script.includes('waitForStatusPath')) return Promise.resolve({ handle: 'me', id: '42' });
    return Promise.resolve('ready');
  };
  const pending = harness.runtime.resolveNotification('persist:x-0', 'ACTIVATE');
  await harness.ready();
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), { id: '42', url: 'https://x.com/me/status/42', handle: 'me' });
  assert.deepEqual(harness.loads, ['https://x.com/notifications']);

  harness.webview.executeJavaScript = () => Promise.resolve(false);
  assert.equal(await harness.runtime.resolveNotification('persist:x-0', 'ACTIVATE'), null);
});

test('waitForStatusPath reads the post X navigated to', async () => {
  const { waitForStatusPath } = load().SocialDeckXStatusActions;
  assert.deepEqual(JSON.parse(JSON.stringify(await waitForStatusPath({ locationLike: { pathname: '/me/status/42' }, schedule: immediate }))), { handle: 'me', id: '42' });
  assert.equal(await waitForStatusPath({ locationLike: { pathname: '/notifications' }, schedule: immediate, timeoutMs: 400 }), null);
});

test('a grouped notification list resolves to its newest (first) post', async () => {
  const { waitForStatusPath } = load().SocialDeckXStatusActions;
  const link = href => ({ getAttribute: () => href, querySelector: selector => (selector === 'time' ? {} : null) });
  const article = href => ({ querySelectorAll: () => [link(href)] });
  const documentLike = { querySelectorAll: () => [article('/me/status/9'), article('/me/status/8')] };
  const listed = await waitForStatusPath({ documentLike, locationLike: { pathname: '/i/timeline' }, schedule: immediate });
  assert.deepEqual(JSON.parse(JSON.stringify(listed)), { handle: 'me', id: '9' });
  // While still on the notification list itself, its embedded posts are not mistaken for the target.
  assert.equal(await waitForStatusPath({ documentLike, locationLike: { pathname: '/notifications' }, schedule: immediate, timeoutMs: 300 }), null);
});

test('later notifications reuse the loaded page through in-app navigation', async () => {
  const harness = createStatusHarness();
  harness.webview.executeJavaScript = script => {
    harness.scripts.push(script);
    if (script.includes('pushState')) return Promise.resolve('pushed');
    if (script === 'ACTIVATE') return Promise.resolve(true);
    if (script.includes('waitForStatusPath')) return Promise.resolve({ handle: 'me', id: '42' });
    return Promise.resolve('ready');
  };
  const first = harness.runtime.resolveNotification('persist:x-0', 'ACTIVATE');
  await harness.ready();
  await first;
  await harness.runtime.resolveNotification('persist:x-0', 'ACTIVATE');
  assert.equal(harness.loads.length, 1, 'only the first notification loads the whole page');
  assert.ok(harness.scripts.some(script => script.includes('"/notifications"')));
});

test('deletes through X post menu and stops when X offers no Delete', async () => {
  const { deleteStatus, findStatusArticle } = load().SocialDeckXStatusActions;
  const make = ({ offerDelete }) => {
    const state = { clicks: [], deleted: false, menuOpen: false, confirmOpen: false };
    const article = createArticle('1');
    article.querySelector = selector => (selector === '[data-testid="caret"]'
      ? { click() { state.clicks.push('caret'); state.menuOpen = true; } }
      : null);
    const documentLike = {
      dispatchEvent() { state.clicks.push('escape'); },
      querySelectorAll: selector => {
        if (selector === '[role="menuitem"]') {
          if (!state.menuOpen) return [];
          return [
            { innerText: 'ポストを固定', click() {} },
            ...(offerDelete ? [{ innerText: '削除', click() { state.clicks.push('delete'); state.confirmOpen = true; } }] : []),
          ];
        }
        return state.deleted ? [] : [article];
      },
      querySelector: selector => (selector === '[data-testid="confirmationSheetConfirm"]' && state.confirmOpen
        ? { click() { state.clicks.push('confirm'); state.deleted = true; } }
        : null),
    };
    return { state, documentLike };
  };
  const own = make({ offerDelete: true });
  assert.equal(await deleteStatus({ documentLike: own.documentLike, statusId: '1', find: findStatusArticle, schedule: immediate }), 'done');
  assert.deepEqual(own.state.clicks, ['caret', 'delete', 'confirm']);

  const other = make({ offerDelete: false });
  assert.equal(await deleteStatus({ documentLike: other.documentLike, statusId: '1', find: findStatusArticle, schedule: immediate }), 'delete-missing');
  assert.equal(other.state.clicks.includes('delete'), false);
});

test('delete clicks the menu again when the first click lands before X is ready', async () => {
  const { deleteStatus, findStatusArticle } = load().SocialDeckXStatusActions;
  const state = { caretClicks: 0, menuOpen: false, confirmOpen: false, deleted: false };
  const article = createArticle('1');
  article.querySelector = selector => (selector === '[data-testid="caret"]'
    ? { click() { state.caretClicks += 1; if (state.caretClicks >= 2) state.menuOpen = true; } }
    : null);
  const documentLike = {
    querySelectorAll: selector => {
      if (selector === '[role="menuitem"]') {
        return state.menuOpen ? [{ innerText: '削除', click() { state.confirmOpen = true; } }] : [];
      }
      return state.deleted ? [] : [article];
    },
    querySelector: selector => (selector === '[data-testid="confirmationSheetConfirm"]' && state.confirmOpen
      ? { click() { state.deleted = true; } }
      : null),
  };
  assert.equal(await deleteStatus({ documentLike, statusId: '1', find: findStatusArticle, schedule: immediate }), 'done');
  assert.equal(state.caretClicks, 2);
});

test('reply presses the button again when the first click opens nothing', async () => {
  const { openReplyComposer, findStatusArticle } = load().SocialDeckXStatusActions;
  const body = {};
  let clicks = 0;
  let box = null;
  const scope = {
    parentElement: body,
    querySelector: selector => (selector === '[data-testid="toolBar"]' || selector.includes('tweetButton') ? {} : null),
    querySelectorAll: () => [box],
  };
  const article = createArticle('1');
  article.querySelector = selector => (selector === '[data-testid="reply"]'
    ? { click() { clicks += 1; if (clicks === 2) box = { parentElement: scope, setAttribute() {} }; } }
    : null);
  const documentLike = {
    body,
    querySelectorAll: selector => (selector.includes('tweetTextarea_0') ? (box ? [box] : []) : [article]),
  };
  const result = await openReplyComposer({ documentLike, statusId: '1', find: findStatusArticle, schedule: immediate });
  assert.equal(result.status, 'ready');
  assert.equal(clicks, 2);
});
