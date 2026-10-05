const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const fixture = require('./fixtures/x-home-timeline.json');
const { normalizeTimelineResponse } = require('../src/main/x-timeline-normalizer');

const plain = value => JSON.parse(JSON.stringify(value));

function load() {
  const context = { window: {}, URL };
  for (const name of ['html-escape.js', 'x-post-view.js', 'x-native-posts.js', 'x-native-page-scripts.js', 'x-native-column-view.js', 'x-native-detail.js', 'x-native-reactions.js', 'x-native-readers.js', 'x-native-timeline-runtime.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8'), context);
  }
  return context.window;
}

function createListenerTarget(extra = {}) {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
    dispatch(type, event = {}) { return Promise.all((listeners[type] || []).map(fn => fn(event))); },
    ...extra,
  };
}

function createHarness({ attachResult = true, now = () => 1_000_000, refreshResult = null, setTimeoutFn = () => 0, isAuthenticated = async () => true } = {}) {
  const window = load();
  const webviews = [];
  const readerHost = { children: [], appendChild(child) { this.children.push(child); } };
  const documentRef = {
    hidden: false,
    createElement: () => {
      const webview = createListenerTarget({
        attributes: {},
        loads: [],
        scripts: [],
        removed: false,
        setAttribute(name, value) { this.attributes[name] = value; },
        getWebContentsId: () => 41,
        loadURL(url) { this.loads.push(url); return Promise.resolve(); },
        executeJavaScript(script) {
          this.scripts.push(script);
          return Promise.resolve(script.includes('REFRESH:home') ? refreshResult : true);
        },
        remove() { this.removed = true; },
      });
      webviews.push(webview);
      return webview;
    },
  };
  let captured = null;
  const tapCalls = [];
  const opened = [];
  const loginCompleted = [];
  const view = window.SocialDeckXPostView.createXPostView({ relTime: () => '1h' });
  const runtime = window.SocialDeckXNativeTimelineRuntime.createXNativeTimelineRuntime({
    documentRef,
    getReaderHost: () => readerHost,
    getPreloadPath: () => 'file:///preload.js',
    tap: {
      attach: async id => { tapCalls.push(['attach', id]); return attachResult; },
      detach: async id => { tapCalls.push(['detach', id]); return true; },
      onCaptured: fn => { captured = fn; },
    },
    renderPost: view.renderPost,
    blocksPost: item => item.post.author.handle === 'carol' || item.reason?.by?.handle === 'carol',
    intents: { openPost: payload => opened.push(payload), loginCompleted: partition => loginCompleted.push(partition) },
    setTimeoutFn,
    clearTimeoutFn: () => {},
    isAuthenticated,
    now,
    ...(refreshResult ? { createRefreshScript: destination => `REFRESH:${destination}` } : {}),
  });
  const createHost = () => createListenerTarget({ innerHTML: '', scrollTop: 0, querySelectorAll: () => [] });
  return { runtime, webviews, tapCalls, opened, loginCompleted, createHost, emit: payload => captured(payload), documentRef };
}

test('one hidden reader per account feeds every native Home Column', async () => {
  const harness = createHarness();
  const first = harness.createHost();
  const second = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host: first });
  harness.runtime.mount({ id: 'b', partition: 'persist:x-0', host: second });
  assert.equal(harness.webviews.length, 1);
  const [reader] = harness.webviews;
  assert.equal(reader.attributes.partition, 'persist:x-0');
  assert.equal(reader.attributes.preload, 'file:///preload.js');
  assert.match(first.innerHTML, /読み込み中/);

  await reader.dispatch('dom-ready');
  assert.deepEqual(harness.tapCalls, [['attach', 41]]);
  assert.deepEqual(reader.loads, ['https://x.com/home']);

  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });
  for (const host of [first, second]) {
    assert.match(host.innerHTML, /data-x-id="1800000000000000003"/);
    assert.match(host.innerHTML, /Tom &amp; Jerry/);
    assert.match(host.innerHTML, /さらに読み込む/);
  }

  harness.runtime.dispose('a');
  assert.equal(reader.removed, false);
  harness.runtime.dispose('b');
  assert.equal(reader.removed, true);
  assert.deepEqual(harness.tapCalls.at(-1), ['detach', 41]);
});

test('mute rules apply to the author and to the reposting account', async () => {
  const harness = createHarness();
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  await harness.webviews[0].dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });
  assert.doesNotMatch(host.innerHTML, /1700000000000000001/);
  assert.match(host.innerHTML, /1800000000000000001/);
});

test('automatic refresh is throttled while a manual refresh reloads the reader', async () => {
  let clock = 1_000_000;
  const harness = createHarness({ now: () => clock });
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });

  clock += 60_000;
  assert.deepEqual(plain(await harness.runtime.refresh('a')), { status: 'deferred', detail: 'throttled' });
  assert.equal(reader.loads.length, 1);

  const pending = harness.runtime.refresh('a', { force: true });
  await Promise.resolve();
  assert.equal(reader.loads.length, 2);
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });
  assert.deepEqual(plain(await pending), { status: 'succeeded', detail: 'captured' });

  clock += 5 * 60_000;
  harness.documentRef.hidden = true;
  assert.deepEqual(plain(await harness.runtime.refresh('a')), { status: 'deferred', detail: 'hidden' });
});

test('shows a login prompt when the reader is redirected to X login', async () => {
  const harness = createHarness();
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  await harness.webviews[0].dispatch('did-navigate', { url: 'https://x.com/i/flow/login' });
  assert.match(host.innerHTML, /ログインしてください/);
});

test('mergePosts keeps shown posts in place and refreshes their counts', () => {
  const { mergePosts } = load().SocialDeckXNativePosts;
  const merged = mergePosts(
    [{ id: '1', sortIndex: '20', counts: { like: 1 } }, { id: '2', sortIndex: '10' }],
    [{ id: '1', sortIndex: '99', counts: { like: 5 } }, { id: '3', sortIndex: '100' }],
  );
  assert.deepEqual(plain(merged.map(post => post.id)), ['3', '1', '2']);
  assert.equal(merged[1].counts.like, 5);
  assert.equal(merged[1].sortIndex, '20');
});

test('post view escapes text and rejects unsafe media and link URLs', () => {
  const view = load().SocialDeckXPostView.createXPostView({ relTime: () => 'now' });
  const html = view.renderPost({
    id: '1',
    url: 'https://x.com/a/status/1',
    author: { handle: 'a"b', name: '<img onerror=x>', avatar: 'javascript:alert(1)' },
    segments: [
      { type: 'text', text: '<script>x</script>\nline' },
      { type: 'link', url: 'javascript:alert(1)', text: 'bad' },
      { type: 'mention', handle: 'bob', text: '@bob' },
    ],
    media: [{ type: 'photo', thumb: 'http://insecure/x.jpg', url: 'https://pbs.twimg.com/media/a.jpg?name=large' }],
    counts: { like: 12345, view: 0 },
    viewer: { liked: true },
  });
  assert.doesNotMatch(html, /<script>|<img onerror/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;<br>line/);
  assert.match(html, /href="https:\/\/x\.com\/bob"/);
  assert.match(html, /src="https:\/\/pbs\.twimg\.com\/media\/a\.jpg\?name=large"/);
  assert.match(html, /1\.2万/);
  assert.match(html, /pa lk liked/);
});

test('refreshes every minute by clicking Home in the reader instead of reloading', async () => {
  let clock = 1_000_000;
  const harness = createHarness({ now: () => clock, refreshResult: 'home-clicked' });
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });

  clock += 60_000;
  const pending = harness.runtime.refresh('a');
  await new Promise(resolve => setImmediate(resolve));
  // The reader is scrolled back to the top first so X does not skip the refresh.
  assert.deepEqual(plain(reader.scripts.slice(-1)), ['(window.scrollTo(0, 0), REFRESH:home)']);
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });
  assert.deepEqual(plain(await pending), { status: 'succeeded', detail: 'captured' });
  assert.equal(reader.loads.length, 1);
});

test('falls back to a throttled reload when X cannot refresh in place', async () => {
  let clock = 1_000_000;
  const harness = createHarness({ now: () => clock, refreshResult: 'not-following' });
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });

  clock += 60_000;
  assert.deepEqual(plain(await harness.runtime.refresh('a')), { status: 'deferred', detail: 'throttled' });
  assert.equal(reader.loads.length, 1);

  clock += 3 * 60_000;
  const pending = harness.runtime.refresh('a');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reader.loads.length, 2);
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });
  assert.deepEqual(plain(await pending), { status: 'succeeded', detail: 'captured' });
});

test('refreshPartition refreshes the account after posting', async () => {
  const harness = createHarness({ refreshResult: 'home-clicked' });
  harness.runtime.mount({ id: 'a', partition: 'persist:x-1', host: harness.createHost() });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });

  assert.deepEqual(plain(await harness.runtime.refreshPartition('persist:x-9')), { status: 'deferred', detail: 'unavailable' });
  const pending = harness.runtime.refreshPartition('persist:x-1', { force: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reader.scripts.at(-1), '(window.scrollTo(0, 0), REFRESH:home)');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });
  assert.equal((await pending).status, 'succeeded');
});

test('a captured CreateTweet post is placed above the newest shown post', async () => {
  const harness = createHarness();
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  await harness.webviews[0].dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture) });
  harness.emit({
    webContentsId: 41,
    operation: 'CreateTweet',
    timeline: null,
    posts: [{ id: '999', url: 'https://x.com/me/status/999', author: { handle: 'me', name: 'Me' }, segments: [{ type: 'text', text: 'my new post' }], media: [] }],
  });
  assert.ok(host.innerHTML.indexOf('data-x-id="999"') < host.innerHTML.indexOf('data-x-id="1800000000000000003"'));
  // The timeline label from the earlier response is kept.
  assert.match(host.innerHTML, /my new post/);
});

test('selectHomeTab clicks the requested X home tab only when needed', async () => {
  const { selectHomeTab } = load().SocialDeckXNativePageScripts;
  const clicks = [];
  const tab = (text, selected) => ({ textContent: text, getAttribute: () => String(selected), click: () => clicks.push(text) });
  const documentLike = tabs => ({ querySelectorAll: () => tabs });
  assert.equal(await selectHomeTab(documentLike([tab('おすすめ', true), tab('フォロー中 •', false)]), 'following'), 'clicked');
  assert.equal(await selectHomeTab(documentLike([tab('For you', false), tab('Following', true)]), 'following'), 'already');
  assert.equal(await selectHomeTab(documentLike([]), 'for-you', fn => fn(), 3), 'missing');
  // The header may still be hidden: the tabs are found once they appear.
  let calls = 0;
  const appearing = { querySelectorAll: () => (++calls < 3 ? [] : [tab('おすすめ', false)]) };
  assert.equal(await selectHomeTab(appearing, 'for-you', fn => fn(), 5), 'clicked');
  assert.deepEqual(clicks, ['フォロー中 •', 'おすすめ']);
});

test('a logged-out account can sign in from the Column and the reader reloads', async () => {
  const harness = createHarness();
  const host = harness.createHost();
  host.appendChild = node => { host.child = node; };
  host.classList = { add() {}, remove() {} };
  harness.runtime.mount({ id: 'a', partition: 'persist:x-3', host });
  const [reader] = harness.webviews;
  await reader.dispatch('did-navigate', { url: 'https://x.com/i/flow/login' });
  assert.match(host.innerHTML, /data-x-native-open-login/);

  const openButton = { closest: selector => (selector === '[data-x-native-open-login]' ? {} : null) };
  await host.dispatch('click', { target: openButton, preventDefault() {}, stopPropagation() {} });
  const loginView = harness.webviews[1];
  assert.equal(loginView.attributes.partition, 'persist:x-3');
  assert.equal(loginView.src, 'https://x.com/i/flow/login');
  assert.equal(host.child, loginView);

  await loginView.dispatch('did-navigate', { url: 'https://x.com/home' });
  assert.equal(loginView.removed, true);
  assert.equal(reader.loads.at(-1), 'https://x.com/home');
  assert.match(host.innerHTML, /読み込み中/);
  assert.deepEqual(harness.loginCompleted, ['persist:x-3']);
});

test('a signed-out account shows the login button without loading X', async () => {
  const harness = createHarness({ isAuthenticated: async () => false });
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-5', host });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  assert.deepEqual(reader.loads, []);
  assert.match(host.innerHTML, /data-x-native-open-login/);
});

test('X landing page counts as signed out and a stuck load stops spinning', async () => {
  const timers = [];
  const harness = createHarness({ setTimeoutFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  const watchdog = timers.find(timer => timer.ms === 30000);
  assert.ok(watchdog, 'loading home arms a watchdog');
  watchdog.fn();
  assert.match(host.innerHTML, /更新ボタンで再試行/);

  const other = createHarness();
  const otherHost = other.createHost();
  other.runtime.mount({ id: 'b', partition: 'persist:x-1', host: otherHost });
  await other.webviews[0].dispatch('did-navigate', { url: 'https://x.com/' });
  assert.match(otherHost.innerHTML, /data-x-native-open-login/);
});

test('switching tabs clicks the tab, reloads, and takes only that tab\'s first page', async () => {
  const harness = createHarness();
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  const forYou = { ...normalizeTimelineResponse(fixture, 'HomeTimeline'), firstPage: true };
  harness.emit({ webContentsId: 41, ...forYou });
  assert.match(host.innerHTML, /data-x-timeline="for-you" class="on"/);

  const base = reader.executeJavaScript.bind(reader);
  reader.executeJavaScript = script => (script.includes('selectHomeTab') ? (reader.scripts.push('select'), Promise.resolve('clicked')) : base(script));
  const switching = harness.runtime.switchTimeline('persist:x-0', 'following');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reader.loads.at(-1), 'https://x.com/home', 'the page reloads right after the click');
  assert.match(host.innerHTML, /読み込み中/);
  assert.match(host.innerHTML, /data-x-timeline/, 'tabs stay visible while loading');

  const following = normalizeTimelineResponse(fixture, 'HomeLatestTimeline');
  // A poll with no complete first page (for example "no new posts") does not finish the switch.
  harness.emit({ webContentsId: 41, ...following, posts: [], firstPage: false });
  // If X reopened the old tab, the tab is selected again instead of showing it.
  const selectsBefore = reader.scripts.filter(script => script === 'select').length;
  harness.emit({ webContentsId: 41, ...forYou });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reader.scripts.filter(script => script === 'select').length, selectsBefore + 1);
  harness.emit({ webContentsId: 41, ...following, posts: following.posts.slice(0, 1), firstPage: true });
  assert.equal(await switching, true);
  assert.match(host.innerHTML, /data-x-timeline="following" class="on"/);
  assert.equal((host.innerHTML.match(/data-x-id=/g) || []).length, 1, 'the list holds only Following posts');
});

test('a failed switch keeps the tabs available', async () => {
  const harness = createHarness();
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture, 'HomeTimeline'), firstPage: true });
  reader.executeJavaScript = script => Promise.resolve(script.includes('selectHomeTab') ? 'missing' : true);
  assert.equal(await harness.runtime.switchTimeline('persist:x-0', 'following'), false);
  assert.match(host.innerHTML, /data-x-timeline="for-you" class="on"/);
});

test('a restored subtitle does not repeat the tab label', async () => {
  const harness = createHarness();
  const host = harness.createHost();
  const subtitle = { textContent: 'X · @sub · フォロー中 · フォロー中' };
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host, subtitle });
  await harness.webviews[0].dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture, 'HomeTimeline'), firstPage: true });
  assert.equal(subtitle.textContent, 'X · @sub · おすすめ');
});

test('selectFollowingRecent picks Recent from the Following tab menu', async () => {
  const { selectFollowingRecent } = load().SocialDeckXNativePageScripts;
  const immediate = fn => fn();
  const make = ({ selected = 'フォロー中', recentChecked = false, menu = true } = {}) => {
    const clicks = [];
    let open = false;
    const tabs = [
      { textContent: 'おすすめ', getAttribute: () => String(selected === 'おすすめ'), click() {} },
      { textContent: 'フォロー中', getAttribute: () => String(selected === 'フォロー中'), click() { clicks.push('tab'); open = menu; } },
    ];
    const items = [
      { textContent: '人気順', getAttribute: () => null, querySelector: () => null, click() { clicks.push('popular'); } },
      { textContent: '最新順', getAttribute: name => (name === 'aria-checked' ? String(recentChecked) : null), querySelector: () => null, click() { clicks.push('recent'); } },
    ];
    const documentLike = {
      querySelectorAll: selector => (selector === '[role="tab"]' ? tabs : (open ? items : [])),
      dispatchEvent() { clicks.push('escape'); },
    };
    return { documentLike, clicks };
  };
  const popular = make();
  assert.equal(await selectFollowingRecent(popular.documentLike, immediate), 'selected');
  assert.deepEqual(popular.clicks, ['tab', 'recent']);
  assert.equal(await selectFollowingRecent(make({ recentChecked: true }).documentLike, immediate), 'already');
  assert.equal(await selectFollowingRecent(make({ menu: false }).documentLike, immediate), 'no-menu');
  assert.equal(await selectFollowingRecent(make({ selected: 'おすすめ' }).documentLike, immediate), 'not-following');
});

test('Following switches to Recent once and the list is replaced by the Recent page', async () => {
  const harness = createHarness();
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  const base = reader.executeJavaScript.bind(reader);
  let sortRuns = 0;
  reader.executeJavaScript = script => {
    if (script.includes('selectFollowingRecent')) {
      sortRuns += 1;
      return Promise.resolve('selected');
    }
    return base(script);
  };
  const following = normalizeTimelineResponse(fixture, 'HomeLatestTimeline');
  // The Popular page arrives first.
  harness.emit({ webContentsId: 41, ...following, firstPage: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sortRuns, 1);
  // X answers the sort change with a Recent first page: Popular-only posts are gone.
  harness.emit({ webContentsId: 41, ...following, posts: following.posts.slice(2), firstPage: true });
  assert.equal((host.innerHTML.match(/data-x-id=/g) || []).length, 1);
  // Later pages do not trigger the check again.
  harness.emit({ webContentsId: 41, ...following, firstPage: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sortRuns, 1);
});

test('the selected tab on X decides which list a response belongs to', async () => {
  const { readSelectedTab } = load().SocialDeckXNativePageScripts;
  const tab = (text, selected) => ({ textContent: text, getAttribute: () => String(selected) });
  assert.equal(readSelectedTab({ querySelectorAll: () => [tab('おすすめ', false), tab('フォロー中', true)] }), 'following');
  assert.equal(readSelectedTab({ querySelectorAll: () => [tab('For you', true), tab('Following', false)] }), 'for-you');
  assert.equal(readSelectedTab({ querySelectorAll: () => [] }), null);

  // A Following sort may arrive through an operation that is not HomeLatestTimeline.
  const harness = createHarness();
  const host = harness.createHost();
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  const base = reader.executeJavaScript.bind(reader);
  reader.executeJavaScript = script => (script.includes('readSelectedTab') ? Promise.resolve('following') : base(script));
  const unknown = { ...normalizeTimelineResponse(fixture, 'HomeTimeline'), operation: 'HomeFollowingTimeline', timeline: null, firstPage: true };
  harness.emit({ webContentsId: 41, ...unknown });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(host.innerHTML, /data-x-timeline="following" class="on"/);

  // Switching back to Following accepts a first page whatever its operation, once X shows that tab.
  reader.executeJavaScript = script => {
    if (script.includes('readSelectedTab')) return Promise.resolve('for-you');
    if (script.includes('selectHomeTab')) return Promise.resolve('clicked');
    return base(script);
  };
  const toForYou = harness.runtime.switchTimeline('persist:x-0', 'for-you');
  await new Promise(resolve => setImmediate(resolve));
  harness.emit({ webContentsId: 41, ...unknown });
  assert.equal(await toForYou, true);
  assert.match(host.innerHTML, /data-x-timeline="for-you" class="on"/);
});

test('while X polls on its own, the automatic refresh does not click Home', async () => {
  let clock = 1_000_000;
  const harness = createHarness({ now: () => clock, refreshResult: 'home-clicked' });
  harness.runtime.mount({ id: 'a', partition: 'persist:x-0', host: harness.createHost() });
  const [reader] = harness.webviews;
  await reader.dispatch('dom-ready');
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture), firstPage: true });
  const clicks = () => reader.scripts.filter(script => script.includes('REFRESH:home')).length;

  // A response 30 seconds after SocialDeck last made the page fetch came from X itself.
  clock += 30_000;
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture), requestCursor: 'TOP' });
  clock += 30_000;
  assert.deepEqual(plain(await harness.runtime.refresh('a')), { status: 'succeeded', detail: 'x-polling' });
  assert.equal(clicks(), 0);

  // A manual refresh still asks X right away.
  const manual = harness.runtime.refresh('a', { force: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clicks(), 1);
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture), requestCursor: 'TOP' });
  await manual;

  // Once X has not polled for a while, the automatic refresh clicks Home again.
  clock += 151_000;
  const automatic = harness.runtime.refresh('a');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clicks(), 2);
  harness.emit({ webContentsId: 41, ...normalizeTimelineResponse(fixture), requestCursor: 'TOP' });
  await automatic;
});

test('reads the unread count from X notification tab badge', () => {
  const { readNotificationBadge } = load().SocialDeckXNativePageScripts;
  const link = (label, text = '') => ({ getAttribute: () => label, textContent: text });
  const doc = found => ({ querySelector: selector => (selector.includes('AppTabBar_Notifications_Link') ? found : null) });
  assert.equal(readNotificationBadge(doc(link('通知 (3件の未読通知)'))), 3);
  assert.equal(readNotificationBadge(doc(link(null, '通知12'))), 12);
  assert.equal(readNotificationBadge(doc(link('Notifications', 'Notifications'))), 0);
  assert.equal(readNotificationBadge({ querySelector: () => null }), null);
});
