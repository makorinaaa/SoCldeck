const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRefreshRuntime() {
  const context = { URL, window: {} };
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

function createNavigationLink(destination, clicks) {
  return { click: () => clicks.push(destination) };
}

function createTimelineDocument({
  tabs,
  scrollTop = 0,
  banner = null,
  home = null,
  notifications = null,
  links = [],
  pathname = '',
  replyComposer = null,
}) {
  return {
    location: { pathname },
    scrollingElement: { scrollTop },
    documentElement: { scrollTop },
    querySelector: selector => {
      if (selector === '[data-testid="AppTabBar_Home_Link"]') return home;
      if (selector === '[data-testid="AppTabBar_Notifications_Link"]') return notifications;
      if (selector === '[role="dialog"] [data-testid^="tweetTextarea_"]') return replyComposer;
      if (selector.includes('newTweetsButton')) return banner;
      return null;
    },
    querySelectorAll: selector => {
      if (selector === '[role="tab"]') return tabs;
      if (selector === '[role="button"]') return [];
      if (selector === 'a[href]') return links;
      return [];
    },
  };
}

test('refreshes an active Following timeline with one Home navigation click', async () => {
  const clicks = [];
  const tabs = [
    createTab('おすすめ', false, clicks),
    createTab('フォロー中', true, clicks),
  ];
  const documentLike = createTimelineDocument({
    tabs,
    scrollTop: 40,
    home: createNavigationLink('home', clicks),
  });

  const result = await loadRefreshRuntime().refreshXNavigation({
    documentLike,
    schedule: callback => callback(),
    destination: 'home',
  });

  assert.equal(result, 'home-clicked');
  assert.deepEqual(clicks, ['home']);
  assert.equal(documentLike.scrollingElement.scrollTop, 0);
});

test('leaves a timeline unchanged while the user is scrolled down', async () => {
  const clicks = [];
  const tabs = [
    createTab('おすすめ', false, clicks),
    createTab('フォロー中', true, clicks),
  ];

  const result = await loadRefreshRuntime().refreshXNavigation({
    documentLike: createTimelineDocument({
      tabs,
      scrollTop: 200,
      home: createNavigationLink('home', clicks),
    }),
    schedule: callback => callback(),
    destination: 'home',
  });

  assert.equal(result, 'deferred');
  assert.deepEqual(clicks, []);
});

test('keeps an open reply composer visible during an automatic refresh', async () => {
  const state = { content: 'reply-composer' };
  const result = await loadRefreshRuntime().refreshXNavigation({
    documentLike: createTimelineDocument({
      tabs: [],
      pathname: '/home',
      replyComposer: {},
      home: { click: () => { state.content = 'blank'; } },
    }),
    schedule: callback => callback(),
    destination: 'home',
  });

  assert.equal(result, 'interaction-open');
  assert.equal(state.content, 'reply-composer');
});

test('keeps a post detail page visible during an automatic refresh', async () => {
  const clicks = [];
  const result = await loadRefreshRuntime().refreshXNavigation({
    documentLike: createTimelineDocument({
      tabs: [],
      pathname: '/alice/status/123',
      home: createNavigationLink('home', clicks),
    }),
    schedule: callback => callback(),
    destination: 'home',
  });

  assert.equal(result, 'interaction-open');
  assert.deepEqual(clicks, []);
});

test('leaves the For you timeline selected', async () => {
  const clicks = [];
  const tabs = [
    createTab('For you', true, clicks),
    createTab('Following', false, clicks),
  ];

  const result = await loadRefreshRuntime().refreshXNavigation({
    documentLike: createTimelineDocument({
      tabs,
      home: createNavigationLink('home', clicks),
    }),
    schedule: callback => callback(),
    destination: 'home',
  });

  assert.equal(result, 'not-following');
  assert.deepEqual(clicks, []);
});

test('keeps using the new-posts banner when Home navigation is unavailable', async () => {
  const clicks = [];
  const banner = { click: () => clicks.push('banner') };
  const documentLike = createTimelineDocument({ tabs: [], banner, scrollTop: 30 });

  const result = await loadRefreshRuntime().refreshXNavigation({
    documentLike,
    schedule: callback => callback(),
    destination: 'home',
  });

  assert.equal(result, 'banner-clicked');
  assert.deepEqual(clicks, ['banner']);
  assert.equal(documentLike.scrollingElement.scrollTop, 0);
});

test('prefers one Home click over tabs and a stale new-posts banner', async () => {
  const clicks = [];
  const tabs = [
    createTab('おすすめ', false, clicks),
    createTab('フォロー中', true, clicks),
  ];
  const banner = { click: () => clicks.push('banner') };

  const result = await loadRefreshRuntime().refreshXNavigation({
    documentLike: createTimelineDocument({
      tabs,
      banner,
      home: createNavigationLink('home', clicks),
    }),
    schedule: callback => callback(),
    destination: 'home',
  });

  assert.equal(result, 'home-clicked');
  assert.deepEqual(clicks, ['home']);
});

test('runs the Home refresh through the generated WebView script', async () => {
  const clicks = [];
  const tabs = [
    createTab('For you', false, clicks),
    createTab('Following', true, clicks),
  ];
  const runtime = loadRefreshRuntime();
  const documentLike = createTimelineDocument({
    tabs,
    home: createNavigationLink('home', clicks),
  });

  const result = await vm.runInNewContext(runtime.createRefreshScript('home'), {
    document: documentLike,
    setTimeout: callback => callback(),
  });

  assert.equal(result, 'home-clicked');
  assert.deepEqual(clicks, ['home']);
});

test('refreshes notifications with one Notifications navigation click', async () => {
  const clicks = [];
  const runtime = loadRefreshRuntime();
  const documentLike = createTimelineDocument({
    tabs: [],
    notifications: createNavigationLink('notifications', clicks),
  });

  const result = await runtime.refreshXNavigation({
    documentLike,
    schedule: callback => callback(),
    destination: 'notifications',
  });

  assert.equal(result, 'notifications-clicked');
  assert.deepEqual(clicks, ['notifications']);
});

test('falls back to the Home href when X changes its navigation test id', async () => {
  const clicks = [];
  const homeLink = {
    getAttribute: name => name === 'href' ? '/home' : null,
    click: () => clicks.push('home-href'),
  };

  const result = await loadRefreshRuntime().refreshXNavigation({
    documentLike: createTimelineDocument({ tabs: [], links: [homeLink] }),
    schedule: callback => callback(),
    destination: 'home',
  });

  assert.equal(result, 'home-clicked');
  assert.deepEqual(clicks, ['home-href']);
});
