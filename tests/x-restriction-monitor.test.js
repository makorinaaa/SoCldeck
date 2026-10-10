const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createXRestrictionMonitor, restrictionOfUrl } = require('../src/main/x-restriction-monitor');

function harness() {
  const sent = [];
  let clock = 0;
  const host = { isDestroyed: () => false, send: (channel, payload) => sent.push([channel, payload]) };
  const view = new EventEmitter();
  view.id = 7;
  view.session = 'session-x-0';
  view.hostWebContents = host;
  view.isDestroyed = () => false;
  const monitor = createXRestrictionMonitor({
    partitionOf: contents => (contents.session === 'session-x-0' ? 'persist:x-0' : null),
    fromId: id => (id === 7 ? view : null),
    now: () => clock,
  });
  return { monitor, view, sent, tick: ms => { clock += ms; } };
}

test('recognizes X account lock and verification pages', () => {
  assert.equal(restrictionOfUrl('https://x.com/account/access'), 'locked');
  assert.equal(restrictionOfUrl('https://x.com/account/access?lang=ja'), 'locked');
  assert.equal(restrictionOfUrl('https://twitter.com/account/access'), 'locked');
  assert.equal(restrictionOfUrl('https://x.com/home'), null);
  assert.equal(restrictionOfUrl('https://x.com/account/accessibility'), null);
  assert.equal(restrictionOfUrl('https://example.com/account/access'), null);
  assert.equal(restrictionOfUrl('not a url'), null);
});

test('reports a lock page once per account to the window that owns the page', () => {
  const { monitor, view, sent, tick } = harness();
  monitor.watch(view);

  view.emit('did-navigate', {}, 'https://x.com/home');
  view.emit('did-navigate', {}, 'https://x.com/account/access');
  view.emit('did-navigate-in-page', {}, 'https://x.com/account/access', true);
  tick(61_000);
  view.emit('did-navigate-in-page', {}, 'https://x.com/account/access', true);

  assert.deepEqual(sent, [
    ['x-account-restricted', { partition: 'persist:x-0', reason: 'locked' }],
    ['x-account-restricted', { partition: 'persist:x-0', reason: 'locked' }],
  ]);
});

test('reports X rate limiting from GraphQL responses and ignores other pages', () => {
  const { monitor, view, sent } = harness();

  monitor.observeResponse({ webContentsId: 7, statusCode: 200, url: 'https://x.com/i/api/graphql/a/HomeTimeline' });
  // X's page fetches many helper operations; a limit on one of those leaves SocialDeck's work alone
  monitor.observeResponse({ webContentsId: 7, statusCode: 429, url: 'https://x.com/i/api/graphql/a/DataSaverMode' });
  monitor.observeResponse({ webContentsId: 7, statusCode: 429, url: 'https://x.com/i/api/graphql/a/HomeTimeline?variables=SECRET' });
  monitor.observeResponse({ webContentsId: 99, statusCode: 429, url: 'https://x.com/i/api/graphql/a/HomeTimeline' });
  const other = Object.assign(new EventEmitter(), { session: 'session-other', hostWebContents: view.hostWebContents, isDestroyed: () => false });
  monitor.watch(other);
  other.emit('did-navigate', {}, 'https://x.com/account/access');

  assert.deepEqual(sent, [['x-account-restricted', { partition: 'persist:x-0', reason: 'rate-limit', operation: 'HomeTimeline' }]]);
});

test('rate limits on what SocialDeck reads or presses stop the account', () => {
  const { isSocialDeckOperation } = require('../src/main/x-restriction-monitor');

  for (const name of ['HomeTimeline', 'HomeLatestTimeline', 'ListLatestTweetsTimeline', 'TweetDetail',
    'TweetResultByRestId', 'FavoriteTweet', 'UnfavoriteTweet', 'CreateRetweet', 'DeleteRetweet', 'CreateTweet', 'DeleteTweet']) {
    assert.equal(isSocialDeckOperation(`https://x.com/i/api/graphql/id/${name}`), true, name);
  }
  for (const name of ['DataSaverMode', 'Viewer', 'ExploreSidebar', 'UserByScreenName']) {
    assert.equal(isSocialDeckOperation(`https://x.com/i/api/graphql/id/${name}`), false, name);
  }
});
