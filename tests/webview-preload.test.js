const assert = require('node:assert/strict');
const test = require('node:test');

const preload = require('../src/webview-preload');

function createPhoto({ src, alt = '', selectors = [], closestSelectors = [] }) {
  const image = {
    src,
    getAttribute(name) {
      return name === 'alt' ? alt : null;
    },
  };
  const selectorSet = new Set(selectors);
  const closestSet = new Set(closestSelectors);
  const photo = {
    parentElement: null,
    tweet: null,
    querySelector(selector) {
      if (selector === 'img') return image;
      return selectorSet.has(selector) ? { selector } : null;
    },
    closest(selector) {
      if (selector === '[data-testid="tweet"]') return this.tweet;
      return closestSet.has(selector) ? { selector } : null;
    },
  };
  return photo;
}

function createTweet(photos) {
  const tweet = {
    querySelectorAll(selector) {
      return selector === '[data-testid="tweetPhoto"]' ? photos : [];
    },
  };
  photos.forEach(photo => {
    photo.tweet = tweet;
  });
  return tweet;
}

test('allows only X and Twitter hosts, including their www aliases', () => {
  assert.equal(preload.isXHost({ hostname: 'x.com' }), true);
  assert.equal(preload.isXHost({ hostname: 'WWW.TWITTER.COM.' }), true);
  assert.equal(preload.isXHost('www.x.com'), true);
  assert.equal(preload.isXHost({ hostname: 'mobile.x.com' }), false);
  assert.equal(preload.isXHost({ hostname: 'x.com.example.com' }), false);
  assert.equal(preload.isXHost({ hostname: 'bsky.app' }), false);
});

test('normalizes only X media image URLs to their large variant', () => {
  assert.equal(
    preload.normalizeXImageUrl('https://pbs.twimg.com/media/Example?format=jpg&name=small'),
    'https://pbs.twimg.com/media/Example?format=jpg&name=large',
  );
  assert.equal(
    preload.normalizeXImageUrl('https://pbs.twimg.com/tweet_video_thumb/Example.jpg'),
    null,
  );
  assert.equal(preload.normalizeXImageUrl('https://example.com/media/Example.jpg'), null);
  assert.equal(preload.normalizeXImageUrl('not a URL'), null);
});

test('collects tweet images while excluding video and GIF photos', () => {
  const first = createPhoto({
    src: 'https://pbs.twimg.com/media/First?format=jpg&name=small',
  });
  const gif = createPhoto({
    src: 'https://pbs.twimg.com/media/Animated?format=jpg&name=small',
    alt: 'Animated GIF',
  });
  const video = createPhoto({
    src: 'https://pbs.twimg.com/media/Video?format=jpg&name=small',
    selectors: ['video'],
  });
  const second = createPhoto({
    src: 'https://pbs.twimg.com/media/Second?format=png&name=medium',
  });
  const external = createPhoto({ src: 'https://example.com/image.jpg' });
  const tweet = createTweet([first, gif, video, second, external]);

  assert.deepEqual(preload.collectXImageUrls(tweet), [
    'https://pbs.twimg.com/media/First?format=jpg&name=large',
    'https://pbs.twimg.com/media/Second?format=png&name=large',
  ]);
  assert.deepEqual(preload.createImageOpenPayload(second, null), {
    urls: [
      'https://pbs.twimg.com/media/First?format=jpg&name=large',
      'https://pbs.twimg.com/media/Second?format=png&name=large',
    ],
    idx: 1,
  });
  assert.equal(preload.createImageOpenPayload(gif, tweet), null);
});

test('image click handler sends directly to the WebView host', () => {
  const photo = createPhoto({
    src: 'https://pbs.twimg.com/media/Direct?format=jpg&name=small',
  });
  const tweet = createTweet([photo]);
  const calls = [];
  const handler = preload.createImageClickHandler(
    { body: tweet },
    { sendToHost: (...args) => calls.push(args) },
  );
  const stopped = [];
  const target = {
    closest(selector) {
      return selector === '[data-testid="tweetPhoto"]' ? photo : null;
    },
  };

  handler({
    target,
    preventDefault: () => stopped.push('preventDefault'),
    stopPropagation: () => stopped.push('stopPropagation'),
    stopImmediatePropagation: () => stopped.push('stopImmediatePropagation'),
  });

  assert.deepEqual(calls, [[
    'x-img-open',
    JSON.stringify({
      urls: ['https://pbs.twimg.com/media/Direct?format=jpg&name=large'],
      idx: 0,
    }),
  ]]);
  assert.deepEqual(stopped, [
    'preventDefault',
    'stopPropagation',
    'stopImmediatePropagation',
  ]);
});

test('hides the Home composer except while an X dialog composer is open', () => {
  let dialogOpen = false;
  const documentLike = {
    querySelector(selector) {
      if (selector !== '[data-testid="tweetButton"]') return null;
      return dialogOpen ? {} : null;
    },
  };

  assert.equal(preload.shouldHideHomeComposer(documentLike), true);
  dialogOpen = true;
  assert.equal(preload.shouldHideHomeComposer(documentLike), false);
});

test('bootstrap is a no-op when DOM or IPC dependencies are unavailable', () => {
  assert.equal(preload.bootstrap(), false);
  assert.equal(preload.bootstrap({
    windowLike: {},
    documentLike: {},
    locationLike: { hostname: 'x.com' },
  }), false);
  assert.equal(preload.bootstrap({
    windowLike: {},
    documentLike: {},
    locationLike: { hostname: 'x.com' },
    ipcRendererLike: { sendToHost() {} },
  }), false);
});
