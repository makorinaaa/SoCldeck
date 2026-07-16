const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRuntime() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'compose-modal-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckComposeModalRuntime;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMediaDraft(snapshot = { images: [], video: null }) {
  return {
    clear() {},
    getSnapshot: () => snapshot,
  };
}

function createMutableImageDraft() {
  const images = [];
  return {
    addFiles(files) {
      images.push(...Array.from(files).map(file => ({ file, altText: '' })));
      return { status: 'images-added', addedCount: files.length, limitReached: false };
    },
    clear() { images.length = 0; },
    getSnapshot: () => ({ images: images.map(image => ({ ...image })), video: null }),
    removeImage(index) { images.splice(index, 1); return true; },
    updateAlt(index, value) { images[index].altText = value; return true; },
  };
}

function createMutableVideoDraft() {
  let video = null;
  return {
    addFiles(files) {
      const file = Array.from(files)[0];
      video = {
        file,
        durationSeconds: 0,
        trim: { startSeconds: 0, endSeconds: 0 },
        trimDurationSeconds: 0,
      };
      return { status: 'video-added', file };
    },
    clear() { video = null; },
    getSnapshot: () => ({ images: [], video: video ? { ...video, trim: { ...video.trim } } : null }),
    removeVideo() { video = null; return true; },
    setTrimPercent(edge, value) {
      const seconds = Number(value);
      if (edge === 'start') video.trim.startSeconds = seconds;
      else video.trim.endSeconds = seconds;
      video.trimDurationSeconds = video.trim.endSeconds - video.trim.startSeconds;
      return { percent: seconds, trim: { ...video.trim }, trimDurationSeconds: video.trimDurationSeconds };
    },
    setVideoDuration(duration) {
      video.durationSeconds = duration;
      video.trim.endSeconds = duration;
      video.trimDurationSeconds = duration;
      return true;
    },
  };
}

function createElement() {
  const classes = new Set();
  const listeners = {};
  return {
    className: '',
    dataset: {},
    disabled: false,
    innerHTML: '',
    maxLength: 0,
    readOnly: false,
    style: {},
    textContent: '',
    value: '',
    checked: false,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle(name, force) {
        if (force) classes.add(name); else classes.delete(name);
      },
      contains: name => classes.has(name),
    },
    addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener(type, listener) { if (listeners[type] === listener) delete listeners[type]; },
    dispatch(type, event) { event.currentTarget = this; return listeners[type]?.(event); },
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
  };
}

test('DOM view delegates Compose input, submit, and close events', () => {
  const xModal = createElement();
  const bModal = createElement();
  const textarea = createElement();
  textarea.id = 'x-cta';
  const submit = createElement();
  submit.id = 'x-sndb';
  const accountButton = createElement();
  accountButton.dataset = { composeAction: 'select-x-account', composeAccountIndex: '1' };
  const elements = { xPostMod: xModal, compMod: bModal, 'x-cta': textarea, 'x-sndb': submit };
  const documentRef = { getElementById: id => elements[id] || null };
  const events = [];
  const view = loadRuntime().createComposeModalDomView({ documentRef });
  view.connect({
    close: networkId => events.push(['close', networkId]),
    submit: networkId => events.push(['submit', networkId]),
    selectXAccount: accountIndex => events.push(['account', accountIndex]),
    textChanged: (networkId, value) => events.push(['text', networkId, value]),
  });

  textarea.value = 'hello';
  xModal.dispatch('input', { target: textarea });
  xModal.dispatch('click', { target: submit });
  xModal.dispatch('click', { target: accountButton });
  xModal.dispatch('click', { target: xModal });

  assert.deepEqual(events, [
    ['text', 'x', 'hello'],
    ['submit', 'x'],
    ['account', 1],
    ['close', 'x'],
  ]);
});

test('DOM view renders an X Compose snapshot without inline handlers', () => {
  const ids = [
    'xPostMod', 'compMod', 'x-acc-select', 'x-cross-post-controls', 'x-cross-post-b',
    'x-cross-post-note', 'x-post-av', 'x-cta', 'x-cct', 'x-sndb', 'x-compose-preview',
    'x-img-area', 'x-img-preview', 'x-img-drop', 'x-img-file', 'x-video-wrap', 'x-video-preview',
    'x-trim-in', 'x-trim-out', 'x-trim-start-label', 'x-trim-end-label',
    'x-trim-dur-label', 'x-trim-highlight', 'x-ffmpeg-status', 'cross-post-controls',
    'cross-post-x', 'cross-post-x-account', 'comp-av', 'cta', 'cct', 'sndb',
    'b-compose-preview', 'b-img-area', 'b-img-preview', 'b-img-drop', 'b-img-file', 'b-reply-preview',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, createElement()]));
  const documentRef = { getElementById: id => elements[id] || null };
  const view = loadRuntime().createComposeModalDomView({
    documentRef,
    urlApi: { createObjectURL: file => `blob:${file.name}`, revokeObjectURL() {} },
    ui: { escape: value => String(value), formatSeconds: value => `${value}s` },
  });

  const snapshot = {
    networkId: 'x', open: true, xAccounts: [
      { username: '@first', initials: 'F', bg: '#111111' },
      { username: '@second', initials: 'S', bg: '#222222' },
    ],
    blueskyAccount: { did: 'did:plc:me' }, selectedXAccountIndex: 1,
    selectedAccount: { username: '@second', initials: 'S', bg: '#222222' },
    text: 'hello', crossPost: true, crossPostAvailable: true,
    media: { images: [], video: null }, reply: null, busy: false, actionLabel: 'ポスト',
    characterCount: 5, characterLimit: 280, canSubmit: true,
    previewOpen: true, targets: ['X', 'Bluesky'],
  };
  view.render(snapshot);

  assert.match(elements['x-acc-select'].innerHTML, /data-compose-account-index="1"/);
  assert.match(elements['x-acc-select'].innerHTML, /data-compose-action="select-x-account"/);
  assert.doesNotMatch(elements['x-acc-select'].innerHTML, /\sonclick=/);
  assert.equal(elements['x-cta'].value, 'hello');
  assert.equal(elements['x-sndb'].disabled, false);
  assert.equal(elements['x-cct'].textContent, '5 / 280');
  assert.match(elements['x-compose-preview'].innerHTML, /Bluesky/);
  assert.equal(elements['x-compose-preview'].classList.contains('on'), true);

  snapshot.media = {
    images: [{ file: { name: 'diagram.png' }, altText: 'Architecture diagram' }],
    video: null,
  };
  view.render(snapshot);
  assert.match(elements['x-img-preview'].innerHTML, /data-compose-alt-network="x"/);
  assert.match(elements['x-img-preview'].innerHTML, /id="x-alt-0"/);
  assert.match(elements['x-img-preview'].innerHTML, /blob:diagram\.png/);
  assert.doesNotMatch(elements['x-img-preview'].innerHTML, /\son(?:click|input)=/);

  const videoFile = { name: 'clip.mp4' };
  snapshot.media = {
    images: [],
    video: {
      file: videoFile,
      durationSeconds: 200,
      trim: { startSeconds: 50, endSeconds: 150 },
      trimDurationSeconds: 100,
    },
  };
  view.render(snapshot);
  assert.equal(elements['x-ffmpeg-status'].textContent, '');
  assert.equal(elements['x-trim-dur-label'].style.color, 'inherit');

  snapshot.media.video.trim.endSeconds = 210;
  snapshot.media.video.trimDurationSeconds = 160;
  view.render(snapshot);
  assert.notEqual(elements['x-ffmpeg-status'].textContent, '');
  assert.equal(elements['x-trim-dur-label'].style.color, 'var(--red)');

  snapshot.locked = true;
  view.render(snapshot);
  assert.equal(elements['x-img-area'].style.pointerEvents, 'none');
  assert.equal(elements['x-acc-select'].style.pointerEvents, 'none');
});

test('DOM view preserves the active ALT input when only its value changes', () => {
  const ids = [
    'xPostMod', 'compMod', 'x-img-preview', 'x-img-drop', 'x-video-wrap',
    'x-video-preview', 'x-compose-preview', 'x-cta', 'x-cct', 'x-sndb',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, createElement()]));
  const preview = elements['x-img-preview'];
  const altInput = createElement();
  altInput.value = 'typing';
  preview.querySelectorAll = () => [altInput];
  let htmlWrites = 0;
  let previewHtml = '';
  Object.defineProperty(preview, 'innerHTML', {
    get: () => previewHtml,
    set: value => { previewHtml = value; htmlWrites += 1; },
  });
  const documentRef = {
    activeElement: altInput,
    getElementById: id => elements[id] || null,
  };
  const view = loadRuntime().createComposeModalDomView({
    documentRef,
    urlApi: { createObjectURL: () => 'blob:image', revokeObjectURL() {} },
  });
  const file = { name: 'diagram.png' };
  const snapshot = {
    networkId: 'x', open: true, xAccounts: [], blueskyAccount: null,
    selectedXAccountIndex: 0, selectedAccount: null, text: '', crossPost: false,
    crossPostAvailable: false, media: { images: [{ file, altText: '' }], video: null },
    reply: null, busy: false, locked: false, actionLabel: 'Post',
    characterCount: 0, characterLimit: 280, canSubmit: true,
    previewOpen: false, targets: ['X'],
  };

  view.render(snapshot);
  const writesAfterAttachment = htmlWrites;
  snapshot.media = { images: [{ file, altText: 'typing' }], video: null };
  view.render(snapshot);

  assert.equal(htmlWrites, writesAfterAttachment);
  assert.equal(altInput.value, 'typing');
});

test('opens the X Compose Experience with account and preference state', () => {
  const events = [];
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({
      x: [
        { username: '@first', initials: 'F' },
        { username: '@second', initials: 'S' },
      ],
      b: { did: 'did:plc:me', handle: 'me.test' },
    }),
    getPreferences: () => ({ crossPostFromX: true, crossPostFromBluesky: false }),
    mediaDrafts: { x: createMediaDraft(), b: createMediaDraft() },
    coordinator: {
      resetCrossPost: () => events.push('reset-cross-post'),
      getStatus: () => ({ isSending: false }),
    },
    view: {
      setOpen: (networkId, open) => events.push(['open', networkId, open]),
      render: snapshot => events.push(['render', plain(snapshot)]),
    },
  });

  const snapshot = runtime.open('x');

  assert.equal(snapshot.networkId, 'x');
  assert.equal(snapshot.selectedXAccountIndex, 0);
  assert.equal(snapshot.crossPost, true);
  assert.equal(snapshot.crossPostAvailable, true);
  assert.deepEqual(plain(snapshot.xAccounts.map(account => account.username)), ['@first', '@second']);
  assert.deepEqual(events.slice(0, 2), [
    'reset-cross-post',
    ['open', 'x', true],
  ]);
  assert.equal(events.at(-1)[0], 'render');
});

test('opens a Bluesky reply without offering cross-post delivery', () => {
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({
      x: [{ username: '@first' }],
      b: { did: 'did:plc:me', handle: 'me.test' },
    }),
    getPreferences: () => ({ crossPostFromBluesky: true }),
    mediaDrafts: { x: createMediaDraft(), b: createMediaDraft() },
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
  });
  const reply = {
    handle: 'alice.test',
    parent: { uri: 'at://parent', cid: 'parent-cid' },
    root: { uri: 'at://root', cid: 'root-cid' },
  };

  const snapshot = runtime.open('b', { reply });

  assert.equal(snapshot.crossPostAvailable, false);
  assert.equal(snapshot.crossPost, false);
  assert.deepEqual(plain(snapshot.reply), reply);
});

test('refuses to close while sending and clears Compose Runtime State afterward', () => {
  const events = [];
  let sending = true;
  const bMedia = createMediaDraft();
  bMedia.clear = () => events.push('clear-media');
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({ x: [], b: { did: 'did:plc:me' } }),
    mediaDrafts: { x: createMediaDraft(), b: bMedia },
    coordinator: {
      resetCrossPost() {},
      getStatus: () => ({ isSending: sending }),
      reset: networkId => events.push(['reset', networkId]),
    },
    view: {
      setOpen: (networkId, open) => events.push(['open', networkId, open]),
      render() {},
    },
    intents: { closed: networkId => events.push(['closed', networkId]) },
  });
  runtime.open('b', {
    reply: { parent: { uri: 'at://parent', cid: 'cid' } },
  });

  assert.equal(runtime.close('b').status, 'blocked');
  assert.equal(events.includes('clear-media'), false);

  sending = false;
  const outcome = runtime.close('b');

  assert.equal(outcome.status, 'closed');
  assert.equal(outcome.snapshot.open, false);
  assert.equal(outcome.snapshot.reply, null);
  assert.deepEqual(events.slice(-4), [
    ['reset', 'b'],
    'clear-media',
    ['open', 'b', false],
    ['closed', 'b'],
  ]);
});

test('publishes busy presentation state through one snapshot', () => {
  let rendered;
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({ x: [{ username: '@first' }], b: null }),
    mediaDrafts: { x: createMediaDraft(), b: createMediaDraft() },
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
    view: { render: snapshot => { rendered = plain(snapshot); } },
  });
  runtime.open('x');

  const snapshot = runtime.setBusy('x', true, 'Xへ送信中...');

  assert.equal(snapshot.busy, true);
  assert.equal(snapshot.actionLabel, 'Xへ送信中...');
  assert.equal(rendered.busy, true);
  assert.equal(rendered.actionLabel, 'Xへ送信中...');

  const retry = runtime.setBusy('x', false, '失敗分を再試行', { locked: true });
  assert.equal(retry.busy, false);
  assert.equal(retry.locked, true);
  assert.equal(retry.actionLabel, '失敗分を再試行');
  assert.equal(retry.canSubmit, false);
});

test('owns text, account selection, and cross-post preference changes from the view', () => {
  let handlers;
  const preferences = { crossPostFromX: true, crossPostFromBluesky: false };
  const preferenceChanges = [];
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({
      x: [{ username: '@first' }, { username: '@second' }],
      b: { did: 'did:plc:me' },
    }),
    getPreferences: () => preferences,
    mediaDrafts: { x: createMediaDraft(), b: createMediaDraft() },
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
    view: { connect: nextHandlers => { handlers = nextHandlers; }, render() {} },
    intents: {
      updatePreference: (name, value) => {
        preferences[name] = value;
        preferenceChanges.push([name, value]);
      },
    },
  });
  runtime.open('x');

  handlers.textChanged('x', 'hello SocialDeck');
  handlers.selectXAccount(1);
  handlers.crossPostChanged('x', false);
  const snapshot = runtime.getSnapshot('x');

  assert.equal(snapshot.text, 'hello SocialDeck');
  assert.equal(snapshot.selectedXAccountIndex, 1);
  assert.equal(snapshot.selectedAccount.username, '@second');
  assert.equal(snapshot.crossPost, false);
  assert.deepEqual(preferenceChanges, [['crossPostFromX', false]]);
});

test('derives preview targets and character limits for Bluesky cross-posting', () => {
  let handlers;
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({
      x: [{ username: '@first' }, { username: '@second' }],
      b: { did: 'did:plc:me', handle: 'me.test' },
    }),
    getPreferences: () => ({ crossPostFromBluesky: false }),
    mediaDrafts: { x: createMediaDraft(), b: createMediaDraft() },
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
    view: { connect: nextHandlers => { handlers = nextHandlers; }, render() {} },
  });
  runtime.open('b');

  handlers.crossPostChanged('b', true);
  handlers.selectCrossPostXAccount(1);
  handlers.togglePreview('b');
  handlers.textChanged('b', 'a'.repeat(281));
  const snapshot = runtime.getSnapshot('b');

  assert.equal(snapshot.characterLimit, 280);
  assert.equal(snapshot.characterCount, 281);
  assert.equal(snapshot.canSubmit, false);
  assert.equal(snapshot.previewOpen, true);
  assert.deepEqual(plain(snapshot.targets), ['Bluesky', 'X']);
  assert.equal(snapshot.crossPostXAccountIndex, 1);
  assert.equal(snapshot.crossPostXAccount.username, '@second');
});

test('routes image attachment, alt text, and removal through the Media Draft', () => {
  let handlers;
  const xMedia = createMutableImageDraft();
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({ x: [{ username: '@first' }], b: null }),
    mediaDrafts: { x: xMedia, b: createMediaDraft() },
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
    view: { connect: nextHandlers => { handlers = nextHandlers; }, render() {} },
  });
  runtime.open('x');
  const file = { name: 'diagram.png', type: 'image/png' };

  handlers.filesAdded('x', [file]);
  handlers.altChanged('x', 0, 'SocialDeck architecture');
  let snapshot = runtime.getSnapshot('x');

  assert.equal(snapshot.media.images.length, 1);
  assert.equal(snapshot.media.images[0].file.name, 'diagram.png');
  assert.equal(snapshot.media.images[0].altText, 'SocialDeck architecture');
  assert.equal(snapshot.canSubmit, true);

  handlers.removeImage('x', 0);
  snapshot = runtime.getSnapshot('x');
  assert.equal(snapshot.media.images.length, 0);
  assert.equal(snapshot.canSubmit, false);
});

test('owns X video metadata and trim interactions while disabling cross-posting', () => {
  let handlers;
  const xMedia = createMutableVideoDraft();
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({ x: [{ username: '@first' }], b: { did: 'did:plc:me' } }),
    getPreferences: () => ({ crossPostFromX: true }),
    mediaDrafts: { x: xMedia, b: createMediaDraft() },
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
    view: { connect: nextHandlers => { handlers = nextHandlers; }, render() {} },
  });
  runtime.open('x');

  handlers.filesAdded('x', [{ name: 'clip.mp4', type: 'video/mp4' }]);
  handlers.videoMetadataLoaded(120);
  handlers.trimChanged('start', 5);
  handlers.trimChanged('end', 100);
  let snapshot = runtime.getSnapshot('x');

  assert.equal(snapshot.crossPostAvailable, false);
  assert.equal(snapshot.crossPost, false);
  assert.equal(snapshot.media.video.durationSeconds, 120);
  assert.deepEqual(plain(snapshot.media.video.trim), { startSeconds: 5, endSeconds: 100 });
  assert.equal(snapshot.canSubmit, true);

  handlers.removeVideo();
  snapshot = runtime.getSnapshot('x');
  assert.equal(snapshot.media.video, null);
  assert.equal(snapshot.crossPostAvailable, true);
  assert.equal(snapshot.crossPost, true);
});

test('dispose releases the view and makes the Runtime terminal', () => {
  const events = [];
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({ x: [{ username: '@first' }], b: null }),
    mediaDrafts: { x: createMediaDraft(), b: createMediaDraft() },
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
    view: {
      connect: handlers => events.push(['connect', Boolean(handlers)]),
      dispose: () => events.push(['dispose']),
      render: () => events.push(['render']),
      setOpen: () => events.push(['open']),
    },
  });
  runtime.open('x');

  const outcome = runtime.dispose();
  const reopen = runtime.open('x');

  assert.equal(outcome.status, 'disposed');
  assert.equal(reopen.status, 'ignored');
  assert.equal(reopen.detail, 'disposed');
  assert.deepEqual(events.slice(-2), [['dispose'], ['connect', false]]);
});
