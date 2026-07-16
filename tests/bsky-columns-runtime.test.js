const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRuntime(windowOverrides = {}) {
  const context = { window: { ...windowOverrides } };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'bsky-columns-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckBlueskyColumnsRuntime;
}

function createFeedHost() {
  const listeners = {};
  return {
    innerHTML: '',
    addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener(type, listener) { if (listeners[type] === listener) delete listeners[type]; },
    dispatch(type, event) { return listeners[type]?.(event); },
    insertAdjacentHTML(position, html) {
      if (position === 'beforeend') this.innerHTML += html;
      else if (position === 'afterbegin') this.innerHTML = html + this.innerHTML;
    },
    querySelector(selector) {
      if (selector === '.notif') {
        const match = this.innerHTML.match(/class="notif"[^>]*data-time="([^"]+)"/);
        return match ? { dataset: { time: match[1] } } : null;
      }
      if (selector !== '.load-more' || !this.innerHTML.includes('class="load-more"')) return null;
      return { remove: () => { this.innerHTML = this.innerHTML.replace(/<button class="load-more"[^>]*>.*?<\/button>/, ''); } };
    },
    querySelectorAll(selector) {
      if (selector === '.notif[data-notification-uri]') {
        return [...this.innerHTML.matchAll(/class="notif"[^>]*data-notification-uri="([^"]+)"/g)]
          .map(match => ({ dataset: { notificationUri: match[1] } }));
      }
      if (selector !== '.post[data-uri]') return [];
      return [...this.innerHTML.matchAll(/class="post"[^>]*data-uri="([^"]+)"/g)]
        .map(match => ({ dataset: { uri: match[1] } }));
    },
  };
}

function createActionButton(action, post) {
  const classes = new Set();
  const count = { textContent: '3' };
  const svg = { fill: 'none', setAttribute(name, value) { if (name === 'fill') this.fill = value; } };
  const button = {
    dataset: { bskyAction: action },
    classList: {
      contains: name => classes.has(name),
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) classes.add(name); else classes.delete(name);
      },
    },
    closest(selector) {
      if (selector === '[data-bsky-action]') return this;
      if (selector === '.post') return post;
      return null;
    },
    querySelector: selector => selector === 'span' ? count : selector === 'svg' ? svg : null,
  };
  return { button, classes, count, svg };
}

function createDetailDocument() {
  const nodes = [];
  return {
    nodes,
    body: { appendChild(node) { nodes.push(node); } },
    getElementById(id) { return nodes.find(node => node.id === id && !node.removed) || null; },
    createElement() {
      const detailBody = { innerHTML: '' };
      const listeners = {};
      return {
        className: '',
        id: '',
        innerHTML: '',
        style: {},
        detailBody,
        addEventListener(type, listener) { listeners[type] = listener; },
        dispatch(type, event) { return listeners[type]?.(event); },
        remove() { this.removed = true; },
        querySelector: selector => selector === '.bsky-post-detail-body' ? detailBody : null,
      };
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('mounts a Timeline through an authenticated adapter and renders its posts', async () => {
  const calls = [];
  const host = createFeedHost();
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      async getTimeline(request) {
        calls.push(request);
        return {
          cursor: 'next-page',
          feed: [{
            post: {
              uri: 'at://did:plc:alice/app.bsky.feed.post/1',
              cid: 'cid-1',
              author: { did: 'did:plc:alice', handle: 'alice.test', displayName: 'Alice' },
              record: { text: 'hello from timeline', createdAt: '2026-07-16T00:00:00.000Z' },
              replyCount: 1,
              repostCount: 2,
              likeCount: 3,
              viewer: {},
            },
          }],
        };
      },
    },
    muteRules: { blocksPost: () => false, blocksNotification: () => false },
    ui: {
      formatText: text => text,
      relTime: () => 'now',
      renderAvatar: author => `<span class="avatar">${author.displayName}</span>`,
    },
    icons: { reply: 'reply-icon', repost: 'repost-icon', heart: 'heart-icon' },
  });

  runtime.mount({ id: 'b-home', type: 'timeline', host });
  const outcome = await runtime.refresh('b-home', { mode: 'replace' });

  assert.deepEqual(plain(calls), [{ limit: 40, cursor: null }]);
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.detail, 'replaced');
  assert.match(host.innerHTML, /Alice/);
  assert.match(host.innerHTML, /hello from timeline/);
  assert.match(host.innerHTML, /data-uri="at:\/\/did:plc:alice\/app\.bsky\.feed\.post\/1"/);
  assert.match(host.innerHTML, /class="load-more"/);
});

test('keeps Timeline cursor state and appends the next page', async () => {
  const calls = [];
  const host = createFeedHost();
  const adapter = {
    async getTimeline(request) {
      calls.push(request);
      const page = request.cursor ? 2 : 1;
      return {
        cursor: page === 1 ? 'page-2' : null,
        feed: [{ post: {
          uri: `at://post/${page}`,
          cid: `cid-${page}`,
          author: { handle: `user${page}.test` },
          record: { text: `page ${page}` },
        } }],
      };
    },
  };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter,
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
  });

  runtime.mount({ id: 'b-home', type: 'timeline', host });
  await runtime.refresh('b-home', { mode: 'replace' });
  const outcome = await runtime.refresh('b-home', { mode: 'append' });

  assert.deepEqual(plain(calls), [
    { limit: 40, cursor: null },
    { limit: 40, cursor: 'page-2' },
  ]);
  assert.equal(outcome.detail, 'appended');
  assert.match(host.innerHTML, /page 1/);
  assert.match(host.innerHTML, /page 2/);
  assert.doesNotMatch(host.innerHTML, /class="load-more"/);
});

test('prepends only unseen Timeline posts without advancing pagination', async () => {
  const calls = [];
  const host = createFeedHost();
  let requestCount = 0;
  const adapter = {
    async getTimeline(request) {
      calls.push(request);
      requestCount += 1;
      if (requestCount === 1) {
        return { cursor: 'page-2', feed: [{ post: {
          uri: 'at://post/existing', cid: 'existing', author: { handle: 'old.test' }, record: { text: 'existing' },
        } }] };
      }
      return { feed: [
        { post: { uri: 'at://post/new', cid: 'new', author: { handle: 'new.test' }, record: { text: 'new post' } } },
        { post: { uri: 'at://post/existing', cid: 'existing', author: { handle: 'old.test' }, record: { text: 'existing' } } },
      ] };
    },
  };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter,
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
  });

  runtime.mount({ id: 'b-home', type: 'timeline', host });
  await runtime.refresh('b-home', { mode: 'replace' });
  const outcome = await runtime.refresh('b-home', { mode: 'prepend' });

  assert.deepEqual(plain(calls), [
    { limit: 40, cursor: null },
    { limit: 10, cursor: null },
  ]);
  assert.equal(outcome.detail, 'new-items');
  assert.equal((host.innerHTML.match(/data-uri="at:\/\/post\/new"/g) || []).length, 1);
  assert.equal((host.innerHTML.match(/data-uri="at:\/\/post\/existing"/g) || []).length, 1);
  assert.ok(host.innerHTML.indexOf('new post') < host.innerHTML.indexOf('existing'));
  assert.match(host.innerHTML, /class="load-more"/);
});

test('ignores a Timeline response after its Column is disposed', async () => {
  const host = createFeedHost();
  let resolveTimeline;
  const timeline = new Promise(resolve => { resolveTimeline = resolve; });
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: { getTimeline: () => timeline },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
  });

  runtime.mount({ id: 'b-home', type: 'timeline', host });
  const refresh = runtime.refresh('b-home', { mode: 'replace' });
  runtime.dispose('b-home');
  resolveTimeline({ feed: [{ post: {
    uri: 'at://post/late', cid: 'late', author: { handle: 'late.test' }, record: { text: 'late result' },
  } }] });

  const outcome = await refresh;
  assert.deepEqual(plain(outcome), { status: 'deferred', detail: 'column-disposed' });
  assert.doesNotMatch(host.innerHTML, /late result/);
});

test('owns optimistic Timeline likes and reports the outcome', async () => {
  const calls = [];
  const outcomes = [];
  const host = createFeedHost();
  const post = { dataset: { uri: 'at://post/1', cid: 'cid-1', likeuri: '' } };
  const { button, classes, count, svg } = createActionButton('like', post);
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      getTimeline: async () => ({ feed: [] }),
      like: async request => { calls.push(request); return { uri: 'at://like/1' }; },
    },
    muteRules: { blocksPost: () => false },
    ui: {},
    onOutcome: outcome => outcomes.push(outcome),
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await host.dispatch('click', {
    target: button,
    preventDefault() {},
    stopPropagation() {},
  });

  assert.deepEqual(plain(calls), [{ uri: 'at://post/1', cid: 'cid-1' }]);
  assert.equal(classes.has('liked'), true);
  assert.equal(count.textContent, '4');
  assert.equal(svg.fill, 'currentColor');
  assert.equal(post.dataset.likeuri, 'at://like/1');
  assert.deepEqual(plain(outcomes), [{ kind: 'like', status: 'succeeded', active: true }]);
});

test('serializes repeated Timeline reaction clicks while delivery is pending', async () => {
  const calls = [];
  let resolveLike;
  const pendingLike = new Promise(resolve => { resolveLike = resolve; });
  const host = createFeedHost();
  const post = { dataset: { uri: 'at://post/1', cid: 'cid-1', likeuri: '' } };
  const { button } = createActionButton('like', post);
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      getTimeline: async () => ({ feed: [] }),
      like: request => { calls.push(request); return pendingLike; },
    },
    muteRules: { blocksPost: () => false },
    ui: {},
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  const first = host.dispatch('click', { target: button, preventDefault() {}, stopPropagation() {} });
  const second = host.dispatch('click', { target: button, preventDefault() {}, stopPropagation() {} });
  assert.equal(button.disabled, true);
  assert.equal(calls.length, 1);
  resolveLike({ uri: 'at://like/1' });
  await Promise.all([first, second]);
  assert.equal(button.disabled, false);
});

test('reapplies a pending reaction when Timeline rendering overlaps delivery', async () => {
  let resolveLike;
  const pendingLike = new Promise(resolve => { resolveLike = resolve; });
  const host = createFeedHost();
  const post = { dataset: { uri: 'at://post/1', cid: 'cid-1', likeuri: '' } };
  const { button } = createActionButton('like', post);
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      like: () => pendingLike,
      getTimeline: async () => ({ feed: [{ post: {
        uri: 'at://post/1', cid: 'cid-1', author: { handle: 'alice.test' },
        record: { text: 'same post' }, likeCount: 3, viewer: {},
      } }] }),
    },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  const delivery = host.dispatch('click', { target: button, preventDefault() {}, stopPropagation() {} });
  await runtime.refresh('b-home', { mode: 'replace' });

  assert.match(host.innerHTML, /class="pa lk liked"/);
  assert.match(host.innerHTML, /class="pa lk liked"[^>]*>[^<]*<span>4<\/span>/);
  resolveLike({ uri: 'at://like/1' });
  await delivery;
});

test('rolls back an optimistic Timeline like when delivery fails', async () => {
  const outcomes = [];
  const host = createFeedHost();
  const post = { dataset: { uri: 'at://post/1', cid: 'cid-1', likeuri: '' } };
  const { button, classes, count, svg } = createActionButton('like', post);
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      getTimeline: async () => ({ feed: [] }),
      like: async () => { throw new Error('offline'); },
    },
    muteRules: { blocksPost: () => false },
    ui: {},
    onOutcome: outcome => outcomes.push(outcome),
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await host.dispatch('click', {
    target: button,
    preventDefault() {},
    stopPropagation() {},
  });

  assert.equal(classes.has('liked'), false);
  assert.equal(count.textContent, '3');
  assert.equal(svg.fill, 'none');
  assert.equal(post.dataset.likeuri, '');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].kind, 'like');
  assert.equal(outcomes[0].status, 'failed');
  assert.equal(outcomes[0].error.message, 'offline');
});

test('renders Timeline media and repost attribution without inline handlers', async () => {
  const host = createFeedHost();
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: { getTimeline: async () => ({ feed: [{
      reason: { by: { displayName: 'Reposter', handle: 'reposter.test' } },
      post: {
        uri: 'at://post/media',
        cid: 'media-cid',
        author: { did: 'did:plc:author', handle: 'author.test', displayName: 'Author' },
        record: { text: 'media post' },
        embed: { images: [
          { thumb: 'https://cdn.test/1-thumb.jpg', fullsize: 'https://cdn.test/1.jpg', alt: 'first' },
          { thumb: 'https://cdn.test/2-thumb.jpg', fullsize: 'https://cdn.test/2.jpg', alt: 'second' },
        ] },
      },
    }] }) },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
    icons: { repost: 'repost-icon' },
  });

  runtime.mount({ id: 'b-home', type: 'timeline', host });
  await runtime.refresh('b-home');

  assert.match(host.innerHTML, /Reposter reposted/);
  assert.match(host.innerHTML, /class="p-imgs n2"/);
  assert.match(host.innerHTML, /data-bsky-image-index="0"/);
  assert.match(host.innerHTML, /data-bsky-image-index="1"/);
  assert.match(host.innerHTML, /data-author-handle="author\.test"/);
  assert.doesNotMatch(host.innerHTML, /\son(?:click|keydown|contextmenu)=/);
});

test('owns Timeline post activation and renders the thread detail', async () => {
  const calls = [];
  const replyIntents = [];
  const host = createFeedHost();
  const documentRef = createDetailDocument();
  const post = {
    dataset: { uri: 'at://post/1', cid: 'cid-1', authorHandle: 'alice.test' },
  };
  const target = {
    closest(selector) {
      if (selector === '[data-bsky-action]') return null;
      if (selector === '.post') return post;
      if (selector === 'button,a,img,.p-imgs,input,textarea') return null;
      return null;
    },
  };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      getTimeline: async () => ({ feed: [] }),
      getThread: async request => {
        calls.push(request);
        return { thread: {
          post: { uri: request.uri, cid: 'cid-1', author: { handle: 'alice.test' }, record: { text: 'main post' } },
          replies: [{ post: { uri: 'at://post/reply', cid: 'reply', author: { handle: 'bob.test' }, record: { text: 'reply post' } } }],
        } };
      },
    },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
    documentRef,
    intents: { reply: intent => replyIntents.push(intent) },
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await host.dispatch('click', {
    target,
    preventDefault() {},
    stopPropagation() {},
  });

  assert.deepEqual(plain(calls), [{ uri: 'at://post/1', depth: 6 }]);
  assert.equal(documentRef.nodes.length, 1);
  assert.equal(documentRef.nodes[0].id, 'bsky-post-detail');
  assert.match(documentRef.nodes[0].detailBody.innerHTML, /main post/);
  assert.match(documentRef.nodes[0].detailBody.innerHTML, /reply post/);

  const { button: replyButton } = createActionButton('reply', post);
  await documentRef.nodes[0].dispatch('click', {
    target: replyButton,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.deepEqual(plain(replyIntents), [{
    uri: 'at://post/1', cid: 'cid-1', handle: 'alice.test',
  }]);
});

test('routes Timeline reply and image intents from delegated DOM events', async () => {
  const replies = [];
  const images = [];
  const host = createFeedHost();
  const post = { dataset: { uri: 'at://post/1', cid: 'cid-1', authorHandle: 'alice.test' } };
  const { button: replyButton } = createActionButton('reply', post);
  const imageGrid = { dataset: { urls: JSON.stringify(['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg']) } };
  const image = {
    dataset: { bskyImageIndex: '1' },
    closest(selector) {
      if (selector === '[data-bsky-image-index]') return this;
      if (selector === '.p-imgs') return imageGrid;
      if (selector === '[data-bsky-action]') return null;
      return null;
    },
  };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: { getTimeline: async () => ({ feed: [] }) },
    muteRules: { blocksPost: () => false },
    ui: {},
    intents: {
      reply: intent => replies.push(intent),
      openImages: intent => images.push(intent),
    },
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await host.dispatch('click', { target: replyButton, preventDefault() {}, stopPropagation() {} });
  await host.dispatch('click', { target: image, preventDefault() {}, stopPropagation() {} });

  assert.deepEqual(plain(replies), [{ uri: 'at://post/1', cid: 'cid-1', handle: 'alice.test' }]);
  assert.deepEqual(plain(images), [{
    urls: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'],
    startIndex: 1,
  }]);
});

test('owns the Timeline repost menu and optimistic repost delivery', async () => {
  const calls = [];
  const outcomes = [];
  const host = createFeedHost();
  const documentRef = createDetailDocument();
  const post = { dataset: { uri: 'at://post/1', cid: 'cid-1', reposturi: '', authorHandle: 'alice.test' } };
  const { button, classes, count } = createActionButton('repost', post);
  button.getBoundingClientRect = () => ({ left: 20, bottom: 40 });
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      getTimeline: async () => ({ feed: [] }),
      repost: async request => { calls.push(request); return { uri: 'at://repost/1' }; },
    },
    muteRules: { blocksPost: () => false },
    ui: {},
    documentRef,
    onOutcome: outcome => outcomes.push(outcome),
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await host.dispatch('click', { target: button, preventDefault() {}, stopPropagation() {} });
  const menu = documentRef.nodes[0];
  assert.equal(menu.id, 'rt-ctx-menu');
  assert.doesNotMatch(menu.innerHTML, /\sonclick=/);
  const confirm = {
    dataset: { bskyMenuAction: 'confirm-repost' },
    closest: selector => selector === '[data-bsky-menu-action]' ? confirm : null,
  };
  await menu.dispatch('click', { target: confirm, preventDefault() {}, stopPropagation() {} });

  assert.deepEqual(plain(calls), [{ uri: 'at://post/1', cid: 'cid-1' }]);
  assert.equal(classes.has('rted'), true);
  assert.equal(count.textContent, '4');
  assert.equal(post.dataset.reposturi, 'at://repost/1');
  assert.deepEqual(plain(outcomes), [{ kind: 'repost', status: 'succeeded', active: true }]);
});

test('renders a safe Timeline error and retries through the Runtime handler', async () => {
  const host = createFeedHost();
  let shouldFail = true;
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      async getTimeline() {
        if (shouldFail) throw new Error('<offline>');
        return { feed: [{ post: {
          uri: 'at://post/recovered', cid: 'recovered', author: { handle: 'ok.test' }, record: { text: 'recovered' },
        } }] };
      },
    },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await assert.rejects(runtime.refresh('b-home'), /<offline>/);
  assert.match(host.innerHTML, /&lt;offline&gt;/);
  assert.match(host.innerHTML, /data-bsky-action="retry"/);
  shouldFail = false;
  const retry = {
    dataset: { bskyAction: 'retry' },
    closest: selector => selector === '[data-bsky-action]' ? retry : null,
  };
  await host.dispatch('click', { target: retry, preventDefault() {}, stopPropagation() {} });

  assert.match(host.innerHTML, /recovered/);
  assert.doesNotMatch(host.innerHTML, /feed-err/);
});

test('keeps existing Timeline content when a prepend refresh fails', async () => {
  const host = createFeedHost();
  let requestCount = 0;
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      async getTimeline() {
        requestCount += 1;
        if (requestCount > 1) throw new Error('offline');
        return { feed: [{ post: {
          uri: 'at://post/existing', cid: 'existing', author: { handle: 'old.test' }, record: { text: 'existing' },
        } }] };
      },
    },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });
  await runtime.refresh('b-home', { mode: 'replace' });

  await assert.rejects(runtime.refresh('b-home', { mode: 'prepend' }), /offline/);

  assert.match(host.innerHTML, /existing/);
  assert.doesNotMatch(host.innerHTML, /feed-err/);
});

test('syncs existing Timeline metrics and reports the number of new posts', async () => {
  const makeButton = () => {
    const classes = new Set();
    const count = { textContent: '0' };
    const svg = { setAttribute() {} };
    return {
      classes,
      count,
      classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
      querySelector: selector => selector === 'span' ? count : selector === 'svg' ? svg : null,
    };
  };
  const reply = makeButton();
  const repost = makeButton();
  const like = makeButton();
  const existing = {
    dataset: { uri: 'at://post/existing', likeuri: '', reposturi: '' },
    querySelector: selector => ({
      '.pa.rep span': reply.count,
      '.pa.rt span': repost.count,
      '.pa.lk span': like.count,
      '.pa.rt': repost,
      '.pa.lk': like,
    })[selector] || null,
  };
  const host = createFeedHost();
  host.innerHTML = '<div class="post" data-uri="at://post/existing"></div>';
  const baseQuerySelectorAll = host.querySelectorAll.bind(host);
  host.querySelectorAll = selector => selector === '.post[data-uri]' ? [existing] : baseQuerySelectorAll(selector);
  const badge = { textContent: '', style: { display: 'none' } };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: { getTimeline: async () => ({ feed: [
      { post: {
        uri: 'at://post/existing', cid: 'existing', author: { handle: 'old.test' }, record: { text: 'existing' },
        replyCount: 2, repostCount: 4, likeCount: 6, viewer: { like: 'at://like/1', repost: 'at://repost/1' },
      } },
      { post: { uri: 'at://post/new', cid: 'new', author: { handle: 'new.test' }, record: { text: 'new' } } },
    ] }) },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
    schedule: () => 1,
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host, badge });

  const outcome = await runtime.refresh('b-home', { mode: 'prepend' });

  assert.equal(outcome.detail, 'new-items');
  assert.equal(reply.count.textContent, '2');
  assert.equal(repost.count.textContent, '4');
  assert.equal(like.count.textContent, '6');
  assert.equal(like.classes.has('liked'), true);
  assert.equal(repost.classes.has('rted'), true);
  assert.equal(existing.dataset.likeuri, 'at://like/1');
  assert.equal(existing.dataset.reposturi, 'at://repost/1');
  assert.equal(badge.textContent, '+1');
  assert.equal(badge.style.display, '');
});

test('preserves the visible Timeline position while prepending a post', async () => {
  const existing = { dataset: { uri: 'at://post/existing' }, offsetHeight: 80, classList: { add() {}, remove() {} } };
  const added = { dataset: { uri: 'at://post/new' }, offsetHeight: 50, classList: { add() {}, remove() {} } };
  const host = {
    innerHTML: '<div class="post" data-uri="at://post/existing"></div>',
    scrollTop: 200,
    children: [existing],
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll(selector) { return selector === '.post[data-uri]' ? [existing] : this.children; },
    insertAdjacentHTML(position, html) {
      if (position === 'afterbegin') {
        this.innerHTML = html + this.innerHTML;
        this.children.unshift(added);
      }
    },
  };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: { getTimeline: async () => ({ feed: [
      { post: { uri: 'at://post/new', cid: 'new', author: { handle: 'new.test' }, record: { text: 'new' } } },
    ] }) },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
    requestFrame: callback => callback(),
    schedule: () => 1,
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await runtime.refresh('b-home', { mode: 'prepend' });

  assert.equal(host.scrollTop, 250);
});

test('hides the Timeline new-post badge after the user scrolls', () => {
  const host = createFeedHost();
  const badge = { style: { display: '' } };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {},
    muteRules: {},
    ui: {},
  });

  runtime.mount({ id: 'b-home', type: 'timeline', host, badge });
  host.dispatch('scroll', { target: host });

  assert.equal(badge.style.display, 'none');
});

test('loads a custom Feed through the same Columns Runtime interface', async () => {
  const calls = [];
  const host = createFeedHost();
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      async getFeed(request) {
        calls.push(request);
        return { cursor: 'next', feed: [{ post: {
          uri: 'at://post/feed', cid: 'feed', author: { handle: 'feed.test' }, record: { text: 'custom feed post' },
        } }] };
      },
    },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
  });

  runtime.mount({ id: 'b-feed', type: 'feed', feedUri: 'at://feed/custom', host });
  const outcome = await runtime.refresh('b-feed', { mode: 'replace' });

  assert.deepEqual(plain(calls), [{ feedUri: 'at://feed/custom', limit: 40, cursor: null }]);
  assert.equal(outcome.detail, 'replaced');
  assert.match(host.innerHTML, /custom feed post/);
  assert.match(host.innerHTML, /class="load-more"/);
});

test('owns Search controls and renders matching Bluesky posts', async () => {
  const calls = [];
  const host = createFeedHost();
  function createControl() {
    const listeners = {};
    return {
      value: '',
      addEventListener(type, listener) { listeners[type] = listener; },
      removeEventListener(type, listener) { if (listeners[type] === listener) delete listeners[type]; },
      dispatch(type, event = {}) { return listeners[type]?.(event); },
    };
  }
  const searchInput = createControl();
  const searchButton = createControl();
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      async searchPosts(request) {
        calls.push(request);
        return { posts: [{
          uri: 'at://post/search', cid: 'search', author: { handle: 'result.test' }, record: { text: 'matching post' },
        }] };
      },
    },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
  });
  runtime.mount({ id: 'b-search', type: 'search', host, searchInput, searchButton });
  searchInput.value = '  blue sky  ';

  await searchInput.dispatch('keydown', { key: 'Enter', preventDefault() {} });

  assert.deepEqual(plain(calls), [{ query: 'blue sky', limit: 40 }]);
  assert.match(host.innerHTML, /matching post/);
  assert.doesNotMatch(host.innerHTML, /feed-loading/);
});

test('loads Notifications and marks them seen after rendering', async () => {
  const calls = [];
  const cleared = [];
  const host = createFeedHost();
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      async listNotifications(request) {
        calls.push(['list', request]);
        return { notifications: [{
          uri: 'at://notification/1',
          reason: 'follow',
          indexedAt: '2026-07-16T02:00:00.000Z',
          author: { did: 'did:plc:alice', handle: 'alice.test', displayName: 'Alice' },
        }] };
      },
      async markNotificationsSeen(request) { calls.push(['seen', request]); },
    },
    muteRules: { blocksNotification: () => false },
    ui: { relTime: () => 'now', renderAvatar: author => `<span>${author.displayName}</span>` },
    icons: { follow: 'follow-icon' },
    intents: { clearNotificationUnread: () => cleared.push(true) },
    now: () => { calls.push(['now']); return '2026-07-16T03:00:00.000Z'; },
  });

  runtime.mount({ id: 'b-notif', type: 'notif', host });
  const outcome = await runtime.refresh('b-notif', { mode: 'replace' });

  assert.deepEqual(plain(calls), [
    ['now'],
    ['list', { limit: 40 }],
    ['seen', { seenAt: '2026-07-16T03:00:00.000Z' }],
  ]);
  assert.deepEqual(cleared, [true]);
  assert.equal(outcome.detail, 'replaced');
  assert.match(host.innerHTML, /class="notif"/);
  assert.match(host.innerHTML, /Alice/);
  assert.match(host.innerHTML, /Follow/);
  assert.doesNotMatch(host.innerHTML, /\sonclick=/);
});

test('prepends only newer Notifications without marking them seen', async () => {
  const calls = [];
  const host = createFeedHost();
  let requestCount = 0;
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      async listNotifications(request) {
        calls.push(['list', request]);
        requestCount += 1;
        const existing = {
          uri: 'at://notification/old', reason: 'like', indexedAt: '2026-07-16T01:00:00.000Z',
          author: { did: 'did:plc:old', handle: 'old.test', displayName: 'Old' },
        };
        return { notifications: requestCount === 1 ? [existing] : [{
          uri: 'at://notification/new', reason: 'reply', indexedAt: '2026-07-16T02:00:00.000Z',
          author: { did: 'did:plc:new', handle: 'new.test', displayName: 'New' },
        }, existing] };
      },
      async markNotificationsSeen(request) { calls.push(['seen', request]); },
    },
    muteRules: { blocksNotification: () => false },
    ui: { relTime: () => '', renderAvatar: () => '' },
    now: () => '2026-07-16T03:00:00.000Z',
  });

  runtime.mount({ id: 'b-notif', type: 'notif', host });
  await runtime.refresh('b-notif', { mode: 'replace' });
  const outcome = await runtime.refresh('b-notif', { mode: 'prepend' });

  assert.deepEqual(plain(calls), [
    ['list', { limit: 40 }],
    ['seen', { seenAt: '2026-07-16T03:00:00.000Z' }],
    ['list', { limit: 10 }],
  ]);
  assert.equal(outcome.detail, 'new-items');
  assert.equal((host.innerHTML.match(/data-time="2026-07-16T02:00:00.000Z"/g) || []).length, 1);
  assert.equal((host.innerHTML.match(/data-time="2026-07-16T01:00:00.000Z"/g) || []).length, 1);
});

test('deduplicates Notifications by identity when timestamps are equal', async () => {
  const host = createFeedHost();
  let requestCount = 0;
  const existing = {
    uri: 'at://notification/old', reason: 'like', indexedAt: '2026-07-16T01:00:00.000Z',
    author: { did: 'did:plc:old', handle: 'old.test' },
  };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      async listNotifications() {
        requestCount += 1;
        return { notifications: requestCount === 1 ? [existing] : [{
          uri: 'at://notification/new', reason: 'like', indexedAt: existing.indexedAt,
          author: { did: 'did:plc:new', handle: 'new.test' },
        }, existing] };
      },
      async markNotificationsSeen() {},
    },
    muteRules: { blocksNotification: () => false },
    ui: { relTime: () => '', renderAvatar: () => '' },
  });
  runtime.mount({ id: 'b-notif', type: 'notif', host });
  await runtime.refresh('b-notif', { mode: 'replace' });
  await runtime.refresh('b-notif', { mode: 'prepend' });

  assert.equal((host.innerHTML.match(/data-notification-uri="at:\/\/notification\/new"/g) || []).length, 1);
  assert.equal((host.innerHTML.match(/data-notification-uri="at:\/\/notification\/old"/g) || []).length, 1);
});

test('does not clear newer unread state from a stale seen request', async () => {
  const cleared = [];
  const host = createFeedHost();
  let resolveSeen;
  let requestCount = 0;
  const pendingSeen = new Promise(resolve => { resolveSeen = resolve; });
  const oldNotification = {
    uri: 'at://notification/old', reason: 'follow', indexedAt: '2026-07-16T01:00:00.000Z',
    author: { did: 'did:plc:old', handle: 'old.test' },
  };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      async listNotifications() {
        requestCount += 1;
        return { notifications: requestCount === 1 ? [oldNotification] : [{
          uri: 'at://notification/new', reason: 'follow', indexedAt: '2026-07-16T02:00:00.000Z',
          author: { did: 'did:plc:new', handle: 'new.test' },
        }, oldNotification] };
      },
      markNotificationsSeen: () => pendingSeen,
    },
    muteRules: { blocksNotification: () => false },
    ui: { relTime: () => '', renderAvatar: () => '' },
    intents: { clearNotificationUnread: () => cleared.push(true) },
  });
  runtime.mount({ id: 'b-notif', type: 'notif', host });

  const replace = runtime.refresh('b-notif', { mode: 'replace' });
  await new Promise(resolve => setImmediate(resolve));
  await runtime.refresh('b-notif', { mode: 'prepend' });
  resolveSeen();
  await replace;

  assert.deepEqual(cleared, []);
});

test('routes Notification activation as a host intent', async () => {
  const activations = [];
  const host = createFeedHost();
  const notification = {
    dataset: {
      notificationReason: 'like',
      authorDid: 'did:plc:alice',
      authorHandle: 'alice.test',
      targetUri: 'at://post/1',
    },
  };
  const target = {
    closest(selector) {
      if (selector === '[data-bsky-action]') return null;
      if (selector === '.notif') return notification;
      if (selector === '.post') return null;
      if (selector === 'button,a,img,.p-imgs,input,textarea') return null;
      return null;
    },
  };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {},
    muteRules: { blocksNotification: () => false },
    intents: { activateNotification: intent => activations.push(intent) },
  });
  runtime.mount({ id: 'b-notif', type: 'notif', host });

  await host.dispatch('click', { target, preventDefault() {}, stopPropagation() {} });

  assert.deepEqual(plain(activations), [{
    reason: 'like',
    authorDid: 'did:plc:alice',
    authorHandle: 'alice.test',
    targetUri: 'at://post/1',
  }]);
});

test('routes delegated profile, keyboard, and context-menu interactions', async () => {
  const profiles = [];
  const menus = [];
  const threadCalls = [];
  const host = createFeedHost();
  const documentRef = createDetailDocument();
  const post = { dataset: { uri: 'at://post/1', cid: 'cid-1', authorHandle: 'alice.test' } };
  const profile = {
    dataset: { did: 'did:plc:alice', handle: 'alice.test' },
    closest(selector) {
      if (selector === '[data-bsky-profile]') return this;
      if (selector === '[data-bsky-action]') return null;
      if (selector === '.post') return post;
      return null;
    },
  };
  const postTarget = {
    closest(selector) {
      if (selector === '[data-bsky-profile]') return null;
      if (selector === '[data-bsky-action]') return null;
      if (selector === '.post') return post;
      if (selector === '.notif') return null;
      if (selector === 'button,a,img,.p-imgs,input,textarea') return null;
      return null;
    },
  };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      getThread: async request => {
        threadCalls.push(request);
        return { thread: { post: {
          uri: request.uri, cid: 'cid-1', author: { handle: 'alice.test' }, record: { text: 'detail' },
        } } };
      },
    },
    muteRules: { blocksPost: () => false },
    ui: { formatText: text => text, relTime: () => '', renderAvatar: () => '' },
    documentRef,
    intents: {
      openProfile: intent => profiles.push(intent),
      openPostMenu: intent => menus.push(intent),
    },
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await host.dispatch('click', { target: profile, preventDefault() {}, stopPropagation() {} });
  await host.dispatch('keydown', { key: 'Enter', target: postTarget, preventDefault() {}, stopPropagation() {} });
  await host.dispatch('contextmenu', { target: postTarget, clientX: 10, clientY: 20, preventDefault() {} });

  assert.deepEqual(plain(profiles), [{ did: 'did:plc:alice', handle: 'alice.test' }]);
  assert.deepEqual(plain(threadCalls), [{ uri: 'at://post/1', depth: 6 }]);
  assert.deepEqual(plain(menus), [{ handle: 'alice.test', x: 10, y: 20 }]);
});

test('does not open post detail while the user has selected text', async () => {
  const calls = [];
  const host = createFeedHost();
  const post = { dataset: { uri: 'at://post/1', cid: 'cid-1', authorHandle: 'alice.test' } };
  const target = {
    closest(selector) {
      if (selector === '[data-bsky-profile]' || selector === '[data-bsky-action]' || selector === '.notif') return null;
      if (selector === '.post') return post;
      if (selector === 'button,a,img,.p-imgs,input,textarea') return null;
      return null;
    },
  };
  const runtime = loadRuntime({ getSelection: () => ({ toString: () => 'selected text' }) })
    .createBlueskyColumnsRuntime({
      adapter: { getThread: async request => { calls.push(request); return {}; } },
      muteRules: { blocksPost: () => false },
    });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await host.dispatch('click', { target, preventDefault() {}, stopPropagation() {} });

  assert.deepEqual(calls, []);
});

test('falls back to avatar initials when a delegated image fails', async () => {
  const host = createFeedHost();
  const image = { style: {}, matches: selector => selector === '.av img' };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {},
    muteRules: { blocksPost: () => false },
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await host.dispatch('error', { target: image });

  assert.equal(image.style.display, 'none');
});

test('owns delegated profile previews and follow delivery', async () => {
  const calls = [];
  const outcomes = [];
  const host = createFeedHost();
  const documentRef = createDetailDocument();
  const profileTarget = {
    dataset: { did: 'did:plc:alice', handle: 'alice.test' },
    closest: selector => selector === '[data-bsky-profile]' ? profileTarget : null,
    getBoundingClientRect: () => ({ left: 20, top: 30, bottom: 50 }),
  };
  const runtime = loadRuntime().createBlueskyColumnsRuntime({
    adapter: {
      async getProfile(request) {
        calls.push(['profile', request]);
        return {
          did: 'did:plc:alice', handle: 'alice.test', displayName: 'Alice',
          description: 'Profile text', viewer: {},
        };
      },
      async follow(request) { calls.push(['follow', request]); return { uri: 'at://follow/1' }; },
    },
    muteRules: { blocksPost: () => false },
    documentRef,
    hoverDelay: 0,
    onOutcome: outcome => outcomes.push(outcome),
  });
  runtime.mount({ id: 'b-home', type: 'timeline', host });

  await host.dispatch('pointerover', { target: profileTarget });
  const card = documentRef.getElementById('bsky-hover-card');
  assert.ok(card);
  assert.match(card.innerHTML, /Alice/);
  assert.match(card.innerHTML, /Profile text/);

  const followButton = {
    dataset: { bskyFollow: '', did: 'did:plc:alice', handle: 'alice.test', followuri: '' },
    disabled: false,
    textContent: 'フォロー',
    closest: selector => selector === '[data-bsky-follow]' ? followButton : null,
  };
  await card.dispatch('click', { target: followButton, preventDefault() {}, stopPropagation() {} });

  assert.deepEqual(plain(calls), [
    ['profile', { actor: 'did:plc:alice' }],
    ['follow', { targetDid: 'did:plc:alice' }],
  ]);
  assert.equal(followButton.dataset.followuri, 'at://follow/1');
  assert.equal(followButton.textContent, 'フォロー中');
  assert.deepEqual(plain(outcomes), [{ kind: 'follow', status: 'succeeded', active: true, handle: 'alice.test' }]);
});
