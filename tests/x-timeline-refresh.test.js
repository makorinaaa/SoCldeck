const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRefreshRuntime() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'x-timeline-refresh.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckXTimelineRefresh;
}

function createTab(label, selected, clicks) {
  return {
    textContent: label,
    getAttribute: name => name === 'aria-selected' ? String(selected) : null,
    click: () => clicks.push(label),
  };
}

function createTimelineDocument({ tabs, scrollTop = 0, banner = null }) {
  return {
    scrollingElement: { scrollTop },
    documentElement: { scrollTop },
    querySelector: selector => selector.includes('newTweetsButton') ? banner : null,
    querySelectorAll: selector => {
      if (selector === '[role="tab"]') return tabs;
      if (selector === '[role="button"]') return [];
      return [];
    },
  };
}

test('refreshes an active Following timeline by switching tabs and returning', async () => {
  const clicks = [];
  const tabs = [
    createTab('おすすめ', false, clicks),
    createTab('フォロー中', true, clicks),
  ];
  const documentLike = createTimelineDocument({ tabs });
  const scheduleImmediately = callback => callback();

  const result = await loadRefreshRuntime().refreshFollowingTimeline({
    documentLike,
    schedule: scheduleImmediately,
    scrollTo: () => {},
  });

  assert.equal(result, 'tab-toggled');
  assert.deepEqual(clicks, ['おすすめ', 'フォロー中']);
});

test('leaves a timeline unchanged while the user is scrolled down', async () => {
  const clicks = [];
  const tabs = [
    createTab('おすすめ', false, clicks),
    createTab('フォロー中', true, clicks),
  ];

  const result = await loadRefreshRuntime().refreshFollowingTimeline({
    documentLike: createTimelineDocument({ tabs, scrollTop: 200 }),
    schedule: callback => callback(),
    scrollTo: () => {},
  });

  assert.equal(result, 'deferred');
  assert.deepEqual(clicks, []);
});

test('leaves the For you timeline selected', async () => {
  const clicks = [];
  const tabs = [
    createTab('For you', true, clicks),
    createTab('Following', false, clicks),
  ];

  const result = await loadRefreshRuntime().refreshFollowingTimeline({
    documentLike: createTimelineDocument({ tabs }),
    schedule: callback => callback(),
    scrollTo: () => {},
  });

  assert.equal(result, 'not-following');
  assert.deepEqual(clicks, []);
});

test('keeps using the new-posts banner when X provides one', async () => {
  const clicks = [];
  const banner = { click: () => clicks.push('banner') };

  const result = await loadRefreshRuntime().refreshFollowingTimeline({
    documentLike: createTimelineDocument({ tabs: [], banner }),
    schedule: callback => callback(),
    scrollTo: () => {},
  });

  assert.equal(result, 'clicked');
  assert.deepEqual(clicks, ['banner']);
});

test('prefers the Following tab refresh over a stale new-posts banner', async () => {
  const clicks = [];
  const tabs = [
    createTab('おすすめ', false, clicks),
    createTab('フォロー中', true, clicks),
  ];
  const banner = { click: () => clicks.push('banner') };

  const result = await loadRefreshRuntime().refreshFollowingTimeline({
    documentLike: createTimelineDocument({ tabs, banner }),
    schedule: callback => callback(),
    scrollTo: () => {},
  });

  assert.equal(result, 'tab-toggled');
  assert.deepEqual(clicks, ['おすすめ', 'フォロー中']);
});

test('runs the Following refresh through the generated WebView script', async () => {
  const clicks = [];
  const tabs = [
    createTab('For you', false, clicks),
    createTab('Following', true, clicks),
  ];
  const runtime = loadRefreshRuntime();

  const result = await vm.runInNewContext(runtime.createRefreshScript(), {
    document: createTimelineDocument({ tabs }),
    setTimeout: callback => callback(),
    window: { scrollTo: () => {} },
  });

  assert.equal(result, 'tab-toggled');
  assert.deepEqual(clicks, ['For you', 'Following']);
});
