const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule(file, name) {
  const context = { window: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', file), 'utf8');
  vm.runInNewContext(source, context);
  return context.window[name];
}
const loadRuntime = () => loadModule('compose-modal-runtime.js', 'SocialDeckComposeModalRuntime');
const loadView = () => loadModule('compose-modal-view.js', 'SocialDeckComposeModalView');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('autosaves text and reply across close and restart, and explicitly discards', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  let handlers;
  const make = () => loadRuntime().createComposeModalRuntime({ storage,
    getAccounts: () => ({ x: [], b: { did: 'did:plc:me' } }),
    view: { connect: value => { handlers = value; } },
  });
  const first = make();
  const reply = { uri: 'at://parent', cid: 'cid', handle: 'alice.test' };
  first.open('b', { reply });
  handlers.textChanged('b', '再起動しても残る文章');
  first.close('b');
  assert.equal(first.open('b').text, '再起動しても残る文章');
  const second = make();
  const restored = second.open('b');
  assert.equal(restored.text, '再起動しても残る文章');
  assert.deepEqual(plain(restored.reply), reply);
  second.close('b', { discard: true });
  assert.equal(make().open('b').text, '');
});

test('switches X drafts without overwriting either account text or attachments', () => {
  let handlers;
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({ x: [{ partition: 'first' }, { partition: 'second' }] }),
    mediaDrafts: { x: createMutableImageDraft() },
    view: { connect: value => { handlers = value; } },
  });
  runtime.open('x');
  handlers.textChanged('x', 'first draft');
  handlers.filesAdded('x', [{ name: 'first.png' }]);
  handlers.selectXAccount(1);
  assert.equal(runtime.getSnapshot('x').text, '');
  handlers.textChanged('x', 'second draft');
  handlers.selectXAccount(0);
  assert.equal(runtime.getSnapshot('x').text, 'first draft');
  assert.equal(runtime.getSnapshot('x').media.images[0].file.name, 'first.png');
  handlers.selectXAccount(1);
  assert.equal(runtime.getSnapshot('x').text, 'second draft');
  assert.equal(runtime.getSnapshot('x').media.images.length, 0);
});

test('persists retrying targets as unknown while retaining confirmed successes', () => {
  const values = new Map();
  let handlers;
  const targets = [{ id: 'x', status: 'succeeded' }, { id: 'b', status: 'failed' }];
  const runtime = loadRuntime().createComposeModalRuntime({
    storage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    getAccounts: () => ({ x: [{ partition: 'first' }], b: { did: 'did:plc:me' } }),
    getPreferences: () => ({ crossPostFromX: true }),
    coordinator: { getStatus: () => ({ crossPost: { targets } }) },
    view: { connect: value => { handlers = value; } },
  });
  runtime.open('x');
  handlers.textChanged('x', 'hello');
  runtime.setBusy('x', true);
  runtime.setBusy('x', false, 'retry', { locked: true });
  runtime.setBusy('x', true);
  const saved = JSON.parse(values.get('socialdeck_draft_v1_x_first'));
  assert.deepEqual(saved.results.map(target => target.status), ['succeeded', 'unknown']);
  assert.deepEqual(saved.deliveryAccounts, { x: 'first', b: 'did:plc:me' });
});

test('storage failures leave composing usable and report failed draft persistence', () => {
  let handlers;
  const runtime = loadRuntime().createComposeModalRuntime({
    storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } },
    getAccounts: () => ({ x: [{ username: '@first' }] }),
    view: { connect: value => { handlers = value; } },
  });
  runtime.open('x');
  handlers.textChanged('x', 'unsaved');
  assert.equal(runtime.getSnapshot('x').draftError, true);
  assert.equal(runtime.getSnapshot('x').text, 'unsaved');
});

test('restored cross-post keeps its original account after reorder and blocks another Bluesky identity', () => {
  let bAccount = { did: 'original-b' };
  const stored = JSON.stringify({ text: 'retry', crossPost: true, crossPostXAccountIndex: 0,
    deliveryAccounts: { x: 'original-x', b: 'original-b' },
    results: [{ id: 'x', status: 'succeeded' }, { id: 'b', status: 'failed' }] });
  const runtime = loadRuntime().createComposeModalRuntime({
    storage: { getItem: () => stored, setItem() {} },
    getAccounts: () => ({ x: [{ partition: 'another-x' }, { partition: 'original-x' }], b: bAccount }),
    coordinator: { restoreCrossPost() {} },
  });
  const snapshot = runtime.open('b');
  assert.equal(snapshot.crossPostXAccountIndex, 1);
  assert.equal(snapshot.canSubmit, true);
  assert.equal(runtime.open('b', { reply: { uri: 'at://another', cid: 'cid' } }).status, 'blocked');
  assert.equal(runtime.getSnapshot('b').reply, null);
  bAccount = { did: 'different-b' };
  assert.equal(runtime.getSnapshot('b').accountMismatch, true);
  assert.equal(runtime.getSnapshot('b').canSubmit, false);
});

test('missing attachments stay blocked across account switches until reattached', () => {
  let handlers;
  const runtime = loadRuntime().createComposeModalRuntime({
    storage: { getItem: key => key.endsWith('first') ? JSON.stringify({ text: 'with image', hasMedia: true }) : null, setItem() {} },
    getAccounts: () => ({ x: [{ partition: 'first' }, { partition: 'second' }] }),
    mediaDrafts: { x: createMutableImageDraft() },
    view: { connect: value => { handlers = value; } },
  });
  assert.equal(runtime.open('x').canSubmit, false);
  handlers.selectXAccount(1);
  handlers.selectXAccount(0);
  assert.equal(runtime.getSnapshot('x').canSubmit, false);
  handlers.filesAdded('x', [{ name: 'reattached.png' }]);
  assert.equal(runtime.getSnapshot('x').canSubmit, true);
});

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
    setTrimSeconds(edge, value) {
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
  const view = loadView().createComposeModalDomView({ documentRef });
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

test('DOM view provides precise LosslessCut-style trim controls', async () => {
  const xModal = createElement();
  const bModal = createElement();
  const video = createElement();
  video.id = 'x-video-preview';
  video.currentTime = 12.5;
  video.duration = 120;
  video.paused = true;
  let playCount = 0;
  video.play = async () => { playCount += 1; video.paused = false; };
  video.pause = () => { video.paused = true; };
  const timeline = createElement();
  timeline.id = 'x-trim-timeline';
  timeline.dataset.composeTrimTimeline = 'x';
  timeline.getBoundingClientRect = () => ({ left: 10, width: 200 });
  const startInput = createElement();
  startInput.id = 'x-trim-start-input';
  startInput.dataset.composeTrimTime = 'start';
  startInput.value = '1:02.5';
  const playhead = createElement();
  const currentLabel = createElement();
  const thumbnails = createElement();
  const loop = createElement();
  loop.checked = false;
  const ids = {
    xPostMod: xModal,
    compMod: bModal,
    'x-video-preview': video,
    'x-trim-timeline': timeline,
    'x-trim-start-input': startInput,
    'x-trim-playhead': playhead,
    'x-trim-current-label': currentLabel,
    'x-trim-thumbnails': thumbnails,
    'x-trim-loop': loop,
  };
  const documentRef = { activeElement: null, getElementById: id => ids[id] || null };
  const events = [];
  const view = loadView().createComposeModalDomView({
    documentRef,
    urlApi: { createObjectURL: () => 'blob:clip', revokeObjectURL() {} },
    generateThumbnails: async ({ sourceUrl, durationSeconds }) => {
      assert.equal(sourceUrl, 'blob:clip');
      assert.equal(durationSeconds, 120);
      return ['data:image/jpeg;base64,frame-one', 'data:image/jpeg;base64,frame-two'];
    },
  });
  view.connect({
    trimSecondsChanged: (networkId, edge, seconds) => {
      events.push([networkId, edge, seconds]);
      return { media: { video: { trim: { startSeconds: 10, endSeconds: 80 } } } };
    },
  });
  view.render({
    networkId: 'x', xAccounts: [], blueskyAccount: null, selectedAccount: null,
    selectedXAccountIndex: 0, text: '', crossPost: false, crossPostAvailable: false,
    media: {
      images: [],
      video: {
        file: { name: 'clip.mp4', type: 'video/mp4' },
        durationSeconds: 120,
        trim: { startSeconds: 10, endSeconds: 80 },
        trimDurationSeconds: 70,
      },
    },
    reply: null, busy: false, locked: false, actionLabel: 'ポスト', characterCount: 0,
    characterLimit: 280, canSubmit: true, previewOpen: false, targets: ['X'],
  });
  startInput.value = '1:02.5';

  const setIn = createElement();
  setIn.dataset = { composeAction: 'set-trim-edge', trimEdge: 'start' };
  xModal.dispatch('click', { target: setIn });

  const nudgeOut = createElement();
  nudgeOut.dataset = { composeAction: 'nudge-trim-edge', trimEdge: 'end', trimDelta: '-1' };
  xModal.dispatch('click', { target: nudgeOut });

  xModal.dispatch('change', { target: startInput });
  xModal.dispatch('click', { target: timeline, clientX: 110 });

  const preview = createElement();
  preview.dataset = { composeAction: 'preview-trim' };
  xModal.dispatch('click', { target: preview });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(events, [
    ['x', 'start', 12.5],
    ['x', 'end', 79],
    ['x', 'start', 62.5],
  ]);
  assert.equal(video.currentTime, 10);
  assert.equal(playCount, 1);
  assert.match(thumbnails.innerHTML, /frame-one/);
  assert.match(thumbnails.innerHTML, /frame-two/);

  video.currentTime = 30;
  video.dispatch('timeupdate', { target: video });
  assert.equal(playhead.style.left, '25%');
  assert.equal(currentLabel.textContent, '0:30.0');
});

test('DOM view loops the selected trim range and jumps to its edges', () => {
  const xModal = createElement();
  const bModal = createElement();
  const video = createElement();
  video.id = 'x-video-preview';
  video.currentTime = 0;
  video.duration = 120;
  video.paused = true;
  let playCount = 0;
  video.play = async () => { playCount += 1; video.paused = false; };
  video.pause = () => { video.paused = true; };
  const startInput = createElement();
  startInput.id = 'x-trim-start-input';
  startInput.dataset.composeTrimTime = 'start';
  const playhead = createElement();
  const currentLabel = createElement();
  const loop = createElement();
  loop.checked = false;
  const ids = {
    xPostMod: xModal,
    compMod: bModal,
    'x-video-preview': video,
    'x-trim-start-input': startInput,
    'x-trim-playhead': playhead,
    'x-trim-current-label': currentLabel,
    'x-trim-loop': loop,
  };
  const documentRef = { activeElement: null, getElementById: id => ids[id] || null };
  const events = [];
  const view = loadView().createComposeModalDomView({
    documentRef,
    urlApi: { createObjectURL: () => 'blob:clip', revokeObjectURL() {} },
    generateThumbnails: async () => [],
  });
  view.connect({
    trimSecondsChanged: (networkId, edge, seconds) => events.push([networkId, edge, seconds]),
  });
  view.render({
    networkId: 'x', xAccounts: [], blueskyAccount: null, selectedAccount: null,
    selectedXAccountIndex: 0, text: '', crossPost: false, crossPostAvailable: false,
    media: {
      images: [],
      video: {
        file: { name: 'clip.mp4', type: 'video/mp4' },
        durationSeconds: 120,
        trim: { startSeconds: 10, endSeconds: 80 },
        trimDurationSeconds: 70,
      },
    },
    reply: null, busy: false, locked: false, actionLabel: 'ポスト', characterCount: 0,
    characterLimit: 280, canSubmit: true, previewOpen: false, targets: ['X'],
  });

  const jumpIn = createElement();
  jumpIn.dataset = { composeAction: 'jump-trim-edge', trimEdge: 'start' };
  xModal.dispatch('click', { target: jumpIn });
  assert.equal(video.currentTime, 10);
  const jumpOut = createElement();
  jumpOut.dataset = { composeAction: 'jump-trim-edge', trimEdge: 'end' };
  xModal.dispatch('click', { target: jumpOut });
  assert.equal(video.currentTime, 80);
  assert.equal(currentLabel.textContent, '1:20.0');

  const preview = createElement();
  preview.dataset = { composeAction: 'preview-trim' };
  xModal.dispatch('click', { target: preview });
  assert.equal(video.currentTime, 10);
  assert.equal(playCount, 1);

  loop.checked = true;
  video.currentTime = 79.99;
  video.dispatch('timeupdate', { target: video });
  assert.equal(video.currentTime, 10);
  assert.equal(playCount, 2);

  loop.checked = false;
  video.currentTime = 79.99;
  video.dispatch('timeupdate', { target: video });
  assert.equal(video.currentTime, 80);
  assert.equal(video.paused, true);

  video.currentTime = 90;
  video.dispatch('timeupdate', { target: video });
  assert.equal(video.currentTime, 90);
  assert.equal(playCount, 2);

  startInput.value = 'abc';
  xModal.dispatch('change', { target: startInput });
  assert.equal(startInput.value, '0:10.0');
  assert.deepEqual(events, []);
});

test('DOM view skips rebuilding unchanged account chips and a closed preview', () => {
  const elements = Object.fromEntries(
    ['xPostMod', 'compMod', 'x-acc-select', 'x-compose-preview'].map(id => [id, createElement()]),
  );
  const documentRef = { activeElement: null, getElementById: id => elements[id] || null };
  const view = loadView().createComposeModalDomView({ documentRef });
  const snapshot = {
    networkId: 'x',
    xAccounts: [
      { username: 'main', initials: 'MA', bg: '#111' },
      { username: 'sub', initials: 'SU', bg: '#222' },
    ],
    blueskyAccount: null, selectedAccount: { username: 'main', initials: 'MA' },
    selectedXAccountIndex: 0, text: '', crossPost: false, crossPostAvailable: false,
    media: { images: [], video: null }, reply: null, busy: false, locked: false,
    actionLabel: 'ポスト', characterCount: 0, characterLimit: 280, canSubmit: false,
    previewOpen: false, targets: ['X'],
  };

  view.render(snapshot);
  assert.equal(elements['x-compose-preview'].innerHTML, '', 'closed preview must not be built');
  assert.match(elements['x-acc-select'].innerHTML, /select-x-account/);

  // 本文入力だけのrenderではチップもプレビューも再構築しない
  elements['x-acc-select'].innerHTML = 'SENTINEL';
  view.render({ ...snapshot, text: 'typing…', characterCount: 7 });
  assert.equal(elements['x-acc-select'].innerHTML, 'SENTINEL');
  assert.equal(elements['x-compose-preview'].innerHTML, '');

  // アカウント選択が変わればチップを作り直す
  view.render({ ...snapshot, selectedXAccountIndex: 1 });
  assert.match(elements['x-acc-select'].innerHTML, /data-compose-account-index="1"/);

  // プレビューを開いたときに初めて構築する
  view.render({ ...snapshot, previewOpen: true });
  assert.equal(elements['x-compose-preview'].classList.contains('on'), true);
  assert.match(elements['x-compose-preview'].innerHTML, /compose-preview-head/);
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
  const view = loadView().createComposeModalDomView({
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

test('DOM view replaces previews when a different video has the same file name', () => {
  const ids = ['xPostMod', 'compMod', 'x-video-wrap', 'x-video-preview', 'x-img-preview', 'x-img-drop'];
  const elements = Object.fromEntries(ids.map(id => [id, createElement()]));
  const urls = [];
  const view = loadView().createComposeModalDomView({
    documentRef: { getElementById: id => elements[id] || null },
    urlApi: {
      createObjectURL: file => {
        const url = `blob:${file.identity}`;
        urls.push(url);
        return url;
      },
      revokeObjectURL() {},
    },
  });
  const snapshot = file => ({
    networkId: 'x', xAccounts: [], blueskyAccount: null, selectedAccount: null,
    selectedXAccountIndex: 0, text: '', crossPost: false, crossPostAvailable: false,
    media: {
      images: [],
      video: {
        file,
        durationSeconds: 30,
        trim: { startSeconds: 0, endSeconds: 30 },
        trimDurationSeconds: 30,
      },
    },
    reply: null, busy: false, locked: false, actionLabel: 'ポスト', characterCount: 0,
    characterLimit: 280, canSubmit: true, previewOpen: false, targets: ['X'],
  });

  view.render(snapshot({ name: 'clip.mp4', identity: 'first' }));
  view.render(snapshot({ name: 'clip.mp4', identity: 'second' }));

  assert.deepEqual(urls, ['blob:first', 'blob:second']);
  assert.equal(elements['x-video-preview'].src, 'blob:second');
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
  const view = loadView().createComposeModalDomView({
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

test('refuses to close while sending and clears Compose Runtime State on explicit discard', () => {
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
  const outcome = runtime.close('b', { discard: true });

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

  assert.equal(snapshot.text, '');
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

test('owns X video metadata and keeps MP4 cross-posting available', () => {
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
  handlers.videoMetadataLoaded('x', 120);
  handlers.trimChanged('x', 'start', 5);
  handlers.trimChanged('x', 'end', 100);
  let snapshot = runtime.getSnapshot('x');

  assert.equal(snapshot.crossPostAvailable, true);
  assert.equal(snapshot.crossPost, true);
  assert.equal(snapshot.media.video.durationSeconds, 120);
  assert.deepEqual(plain(snapshot.media.video.trim), { startSeconds: 5, endSeconds: 100 });
  assert.equal(snapshot.canSubmit, true);

  handlers.removeVideo('x');
  snapshot = runtime.getSnapshot('x');
  assert.equal(snapshot.media.video, null);
  assert.equal(snapshot.crossPostAvailable, true);
  assert.equal(snapshot.crossPost, true);
});

test('owns Bluesky video metadata and keeps X cross-posting available', () => {
  let handlers;
  const bMedia = createMutableVideoDraft();
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({ x: [{ username: '@first' }], b: { did: 'did:plc:me' } }),
    getPreferences: () => ({ crossPostFromBluesky: true }),
    mediaDrafts: { x: createMediaDraft(), b: bMedia },
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
    view: { connect: nextHandlers => { handlers = nextHandlers; }, render() {} },
  });
  runtime.open('b');

  handlers.filesAdded('b', [{ name: 'clip.mp4', type: 'video/mp4' }]);
  handlers.videoMetadataLoaded('b', 200);
  handlers.trimChanged('b', 'start', 10);
  handlers.trimChanged('b', 'end', 170);
  const snapshot = runtime.getSnapshot('b');

  assert.equal(snapshot.crossPostAvailable, true);
  assert.equal(snapshot.crossPost, true);
  assert.equal(snapshot.media.video.durationSeconds, 200);
  assert.deepEqual(plain(snapshot.media.video.trim), { startSeconds: 10, endSeconds: 170 });
  assert.equal(snapshot.canSubmit, true);
});

test('routes precise trim positions through the Media Draft', () => {
  let handlers;
  const xMedia = createMutableVideoDraft();
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({ x: [{ username: '@first' }], b: null }),
    mediaDrafts: { x: xMedia, b: createMediaDraft() },
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
    view: { connect: nextHandlers => { handlers = nextHandlers; }, render() {} },
  });
  runtime.open('x');
  handlers.filesAdded('x', [{ name: 'clip.mp4', type: 'video/mp4' }]);
  handlers.videoMetadataLoaded('x', 120);

  handlers.trimSecondsChanged('x', 'start', 12.25);
  handlers.trimSecondsChanged('x', 'end', 89.75);

  assert.deepEqual(plain(runtime.getSnapshot('x').media.video.trim), {
    startSeconds: 12.25,
    endSeconds: 89.75,
  });
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

test('X replies and quotes from a native Column use that Column account', () => {
  let handlers;
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const runtime = loadRuntime().createComposeModalRuntime({
    storage,
    getAccounts: () => ({ x: [{ partition: 'first' }, { partition: 'second' }], b: { did: 'did:plc:me' } }),
    view: { connect: value => { handlers = value; } },
  });
  const reply = { id: '5', url: 'https://x.com/alice/status/5', handle: 'alice' };
  const replying = runtime.open('x', { reply, accountIndex: 1 });
  assert.equal(replying.selectedXAccountIndex, 1);
  assert.deepEqual(plain(replying.reply), reply);
  assert.equal(replying.crossPostAvailable, false, 'replies are not cross-posted');
  handlers.textChanged('x', 'thanks');
  runtime.close('x');
  assert.deepEqual(plain(runtime.open('x').reply), reply, 'the reply target survives closing');

  runtime.close('x', { discard: true });
  const quoting = runtime.open('x', { accountIndex: 0, appendText: 'https://x.com/bob/status/7' });
  assert.equal(quoting.selectedXAccountIndex, 0);
  assert.equal(quoting.reply, null);
  assert.equal(quoting.text, ' https://x.com/bob/status/7');
  assert.equal(runtime.open('x', { appendText: 'https://x.com/bob/status/7' }).text, ' https://x.com/bob/status/7');
});

test('X account chips show the learned @handle and keep the entered name as a tooltip', () => {
  const elements = Object.fromEntries(
    ['xPostMod', 'compMod', 'x-acc-select', 'x-compose-preview'].map(id => [id, createElement()]),
  );
  const view = loadView().createComposeModalDomView({ documentRef: { activeElement: null, getElementById: id => elements[id] || null } });
  const snapshot = {
    networkId: 'x',
    xAccounts: [
      { username: '@unko', handle: 'real_unko', initials: 'UN', bg: '#111' },
      { username: '@sub', initials: 'SU', bg: '#222' },
    ],
    blueskyAccount: null, selectedAccount: { username: '@unko', initials: 'UN' },
    selectedXAccountIndex: 0, text: '', crossPost: false, crossPostAvailable: false,
    media: { images: [], video: null }, reply: null, busy: false, locked: false,
    actionLabel: 'ポスト', characterCount: 0, characterLimit: 280, canSubmit: false,
    previewOpen: false, targets: ['X'],
  };
  view.render(snapshot);
  const html = elements['x-acc-select'].innerHTML;
  assert.match(html, /title="@unko"[\s\S]*@real_unko/);
  assert.match(html, /@sub/, 'an account whose handle is not known yet keeps its entered name');
  // Learning a handle later rebuilds the chips.
  view.render({ ...snapshot, xAccounts: [snapshot.xAccounts[0], { ...snapshot.xAccounts[1], handle: 'real_sub' }] });
  assert.match(elements['x-acc-select'].innerHTML, /@real_sub/);
});

test('does not show a deleted X account draft to a new account that reuses its partition', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  let accounts = [{ username: '@alice', partition: 'persist:x-0' }];
  let handlers;
  const make = () => loadRuntime().createComposeModalRuntime({ storage,
    getAccounts: () => ({ x: accounts, b: null }),
    mediaDrafts: { x: createMutableImageDraft() },
    view: { connect: value => { handlers = value; } },
  });
  const runtime = make();
  runtime.open('x');
  handlers.textChanged('x', 'Alice の下書き');
  handlers.filesAdded('x', [{ name: 'alice.png' }]);
  runtime.close('x');

  const removed = accounts[0];
  accounts = [];
  runtime.forgetXAccount(removed);
  accounts = [{ username: '@bob', partition: 'persist:x-0' }];

  const snapshot = runtime.open('x');
  assert.equal(snapshot.text, '');
  assert.equal(snapshot.media.images.length, 0);
  assert.equal(make().open('x').text, '');
});

test('forgets every stored draft when all accounts log out', () => {
  const values = new Map([
    ['socialdeck_draft_v1_x_persist:x-0', JSON.stringify({ text: 'X の下書き' })],
    ['socialdeck_draft_v1_b_did:plc:me', JSON.stringify({ text: 'Bluesky の下書き' })],
    ['socialdeck_v4', '{}'],
  ]);
  const storage = {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const runtime = loadRuntime().createComposeModalRuntime({ storage,
    getAccounts: () => ({ x: [{ username: '@alice', partition: 'persist:x-0' }], b: { did: 'did:plc:me' } }),
    view: { connect() {} },
  });
  assert.equal(runtime.open('x').text, 'X の下書き');
  runtime.close('x');

  runtime.forgetAllDrafts();

  assert.deepEqual([...values.keys()], ['socialdeck_v4']);
  assert.equal(runtime.open('x').text, '');
});

test('keeps an unknown single X post locked for confirmation across restart', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let singleStatus = 'idle';
  const restored = [];
  let handlers;
  const make = () => loadRuntime().createComposeModalRuntime({ storage,
    getAccounts: () => ({ x: [{ username: '@alice', partition: 'persist:x-0' }], b: null }),
    coordinator: {
      getStatus: () => ({ single: { status: singleStatus }, crossPost: { targets: [] } }),
      restoreSingle: networkId => restored.push(networkId),
      resetCrossPost() {},
    },
    view: { connect: value => { handlers = value; } },
  });
  const first = make();
  first.open('x');
  handlers.textChanged('x', '結果不明の投稿');
  first.setBusy('x', true, '送信中…');
  singleStatus = 'unknown';
  first.setBusy('x', false, '確認後に再試行', { locked: true });

  singleStatus = 'idle';
  const snapshot = make().open('x');

  assert.equal(snapshot.text, '結果不明の投稿');
  assert.equal(snapshot.locked, true);
  assert.equal(snapshot.actionLabel, '確認後に再試行');
  assert.deepEqual(restored, ['x']);
});

test('reuses the delivery key while a post is locked for retry, also after restart', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let singleStatus = 'idle';
  let handlers;
  const make = () => loadRuntime().createComposeModalRuntime({ storage,
    getAccounts: () => ({ x: [], b: { did: 'did:plc:me' } }),
    coordinator: {
      getStatus: () => ({ single: { status: singleStatus }, crossPost: { targets: [] } }),
      restoreSingle() {},
      resetCrossPost() {},
      reset() {},
    },
    view: { connect: value => { handlers = value; } },
  });
  const first = make();
  first.open('b');
  handlers.textChanged('b', 'hello');
  first.setBusy('b', true, '送信中…', { deliveryKey: 'first-key' });
  singleStatus = 'unknown';
  first.setBusy('b', false, '再試行', { locked: true });
  first.setBusy('b', true, '送信中…', { deliveryKey: 'second-key' });
  assert.equal(first.getSnapshot('b').deliveryKey, 'first-key');
  first.setBusy('b', false, '再試行', { locked: true });

  const second = make();
  assert.equal(second.open('b').deliveryKey, 'first-key');
  second.close('b', { discard: true });
  second.open('b');
  second.setBusy('b', true, '送信中…', { deliveryKey: 'third-key' });
  assert.equal(second.getSnapshot('b').deliveryKey, 'third-key');
});

test('judges post length with each network rule, and both rules when cross-posting', async () => {
  const { measurePost } = await import('../src/renderer/post-length.mjs');
  let handlers;
  let preferences = {};
  const runtime = loadRuntime().createComposeModalRuntime({
    measurePost,
    getAccounts: () => ({ x: [{ partition: 'persist:x-0' }], b: { did: 'did:plc:me' } }),
    getPreferences: () => preferences,
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
    view: { connect: value => { handlers = value; } },
  });

  runtime.open('x');
  handlers.textChanged('x', 'あ'.repeat(141));
  assert.equal(runtime.getSnapshot('x').characterCount, 282);
  assert.equal(runtime.getSnapshot('x').canSubmit, false);
  runtime.close('x');

  runtime.open('b');
  handlers.textChanged('b', '😀'.repeat(151));
  assert.equal(runtime.getSnapshot('b').characterCount, 151);
  assert.equal(runtime.getSnapshot('b').canSubmit, true);
  handlers.crossPostChanged('b', true);
  assert.equal(runtime.getSnapshot('b').characterCount, 302);
  assert.equal(runtime.getSnapshot('b').characterLimit, 280);
  assert.equal(runtime.getSnapshot('b').canSubmit, false);
});

function createDropHarness() {
  const xModal = createElement();
  const bModal = createElement();
  const xDrop = createElement();
  const bDrop = createElement();
  const textarea = createElement();
  textarea.id = 'cta';
  const inside = new Set([textarea, bDrop]);
  bModal.contains = node => node === bModal || inside.has(node);
  xModal.contains = node => node === xModal || node === xDrop;
  const elements = { xPostMod: xModal, compMod: bModal, 'x-img-drop': xDrop, 'b-img-drop': bDrop, cta: textarea };
  const view = loadView().createComposeModalDomView({ documentRef: { getElementById: id => elements[id] || null } });
  const added = [];
  view.connect({ filesAdded: (networkId, files) => added.push([networkId, [...files].map(file => file.name)]) });
  return { xModal, bModal, xDrop, bDrop, textarea, added };
}

function fileEvent(target, { files = [], types = files.length ? ['Files'] : ['text/plain'], text = '' } = {}) {
  const event = {
    target,
    prevented: false,
    preventDefault() { this.prevented = true; },
    dataTransfer: { types, files, dropEffect: 'none' },
    clipboardData: { files, getData: type => (type === 'text/plain' ? text : '') },
  };
  return event;
}

test('accepts files dropped anywhere in the Compose modal, not only on the attachment area', () => {
  const { bModal, xModal, textarea, bDrop, added } = createDropHarness();

  const over = fileEvent(textarea, { files: [{ name: 'shot.png', type: 'image/png' }] });
  bModal.dispatch('dragover', over);
  assert.equal(over.prevented, true);
  assert.equal(bDrop.classList.contains('drag-on'), true);

  const drop = fileEvent(textarea, { files: [{ name: 'shot.png', type: 'image/png' }] });
  bModal.dispatch('drop', drop);
  xModal.dispatch('drop', fileEvent(xModal, { files: [{ name: 'x.png', type: 'image/png' }] }));

  assert.equal(drop.prevented, true);
  assert.equal(bDrop.classList.contains('drag-on'), false);
  assert.deepEqual(added, [['b', ['shot.png']], ['x', ['x.png']]]);
});

test('leaves text drags alone and clears the highlight only when the drag leaves the modal', () => {
  const { bModal, textarea, bDrop, added } = createDropHarness();

  const textDrag = fileEvent(textarea);
  bModal.dispatch('dragover', textDrag);
  bModal.dispatch('drop', fileEvent(textarea));
  assert.equal(textDrag.prevented, false);
  assert.deepEqual(added, []);

  bModal.dispatch('dragover', fileEvent(textarea, { files: [{ name: 'a.png' }] }));
  bModal.dispatch('dragleave', { ...fileEvent(textarea, { files: [{ name: 'a.png' }] }), relatedTarget: bDrop });
  assert.equal(bDrop.classList.contains('drag-on'), true);
  bModal.dispatch('dragleave', { ...fileEvent(textarea, { files: [{ name: 'a.png' }] }), relatedTarget: null });
  assert.equal(bDrop.classList.contains('drag-on'), false);
});

test('attaches pasted images such as screenshots but keeps pasted text as text', () => {
  const { bModal, textarea, added } = createDropHarness();

  const screenshot = fileEvent(textarea, { files: [{ name: 'image.png', type: 'image/png' }] });
  bModal.dispatch('paste', screenshot);
  assert.equal(screenshot.prevented, true);

  // Spreadsheet cells come with a picture of the cells as well as their text
  const cells = fileEvent(textarea, { files: [{ name: 'image.png', type: 'image/png' }], text: 'A1\tB1' });
  bModal.dispatch('paste', cells);
  assert.equal(cells.prevented, false);

  const plain = fileEvent(textarea, { text: 'hello' });
  bModal.dispatch('paste', plain);
  assert.equal(plain.prevented, false);

  assert.deepEqual(added, [['b', ['image.png']]]);
});

function loadMediaModule() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'compose-media.js'), 'utf8'), context);
  return context.window.SocialDeckComposeMedia;
}

test('reorders attached images, but not while a post is locked for retry', () => {
  let handlers;
  const draft = loadMediaModule().createMediaDraft();
  const runtime = loadRuntime().createComposeModalRuntime({
    getAccounts: () => ({ x: [], b: { did: 'did:plc:me' } }),
    mediaDrafts: { b: draft },
    coordinator: { resetCrossPost() {}, getStatus: () => ({ isSending: false }) },
    view: { connect: value => { handlers = value; } },
  });
  runtime.open('b');
  handlers.filesAdded('b', [{ name: 'a.png', type: 'image/png' }, { name: 'b.png', type: 'image/png' }]);

  handlers.moveImage('b', 1, 0);
  assert.deepEqual(plain(runtime.getSnapshot('b').media.images.map(image => image.file.name)), ['b.png', 'a.png']);

  runtime.setBusy('b', false, '再試行', { locked: true });
  handlers.moveImage('b', 1, 0);
  assert.deepEqual(plain(runtime.getSnapshot('b').media.images.map(image => image.file.name)), ['b.png', 'a.png']);
});

function createImageViewHarness() {
  const ids = ['xPostMod', 'compMod', 'x-img-preview', 'x-img-drop', 'x-video-wrap', 'x-video-preview', 'x-compose-preview', 'x-cta', 'x-cct', 'x-sndb'];
  const elements = Object.fromEntries(ids.map(id => [id, createElement()]));
  const opened = [];
  const view = loadView().createComposeModalDomView({
    documentRef: { getElementById: id => elements[id] || null },
    urlApi: { createObjectURL: file => `blob:${file.name}`, revokeObjectURL() {} },
    ui: { openImages: (urls, startIndex) => opened.push([urls, startIndex]) },
  });
  const moves = [];
  view.connect({ moveImage: (networkId, from, to) => moves.push([networkId, from, to]) });
  const files = ['a.png', 'b.png', 'c.png'].map(name => ({ name }));
  view.render({
    networkId: 'x', open: true, xAccounts: [], blueskyAccount: null,
    selectedXAccountIndex: 0, selectedAccount: null, text: '', crossPost: false,
    crossPostAvailable: false, media: { images: files.map(file => ({ file, altText: '' })), video: null },
    reply: null, busy: false, locked: false, actionLabel: 'Post',
    characterCount: 0, characterLimit: 280, canSubmit: true, previewOpen: false, targets: ['X'],
  });
  const target = dataset => {
    const element = createElement();
    element.dataset = dataset;
    element.closest = selector => (selector === '[data-compose-action]' && dataset.composeAction)
      || (selector === '[data-compose-image-row]' && dataset.composeImageRow) ? element : null;
    return element;
  };
  return { elements, opened, moves, target };
}

test('renders each attached image as draggable with move buttons and opens it enlarged on click', () => {
  const { elements, opened, moves, target } = createImageViewHarness();
  const html = elements['x-img-preview'].innerHTML;

  assert.equal((html.match(/draggable="true"/g) || []).length, 3);
  assert.match(html, /data-compose-action="move-image"[^>]*data-compose-image-index="0"[^>]*data-compose-move="1"/);
  assert.match(html, /aria-label="1枚目を後ろへ"/);

  elements.xPostMod.dispatch('click', { target: target({ composeAction: 'move-image', composeNetwork: 'x', composeImageIndex: '1', composeMove: '-1' }) });
  elements.xPostMod.dispatch('click', { target: target({ composeAction: 'move-image', composeNetwork: 'x', composeImageIndex: '2', composeMove: '1' }) });
  elements.xPostMod.dispatch('click', { target: target({ composeAction: 'open-image', composeNetwork: 'x', composeImageIndex: '2' }) });

  assert.deepEqual(moves, [['x', 1, 0]]);
  assert.deepEqual(opened, [[['blob:a.png', 'blob:b.png', 'blob:c.png'], 2]]);
});

test('moves an image dragged onto another image, without treating it as a file drop', () => {
  const { elements, moves, target } = createImageViewHarness();
  const types = [];
  const dataTransfer = { types, setData: type => types.push(type), effectAllowed: '', dropEffect: '' };
  const event = (row, extra = {}) => ({ target: row, dataTransfer, prevented: false, preventDefault() { this.prevented = true; }, ...extra });

  elements.xPostMod.dispatch('dragstart', event(target({ composeImageRow: 'x', composeImageIndex: '0' })));
  const over = event(target({ composeImageRow: 'x', composeImageIndex: '2' }));
  elements.xPostMod.dispatch('dragover', over);
  elements.xPostMod.dispatch('drop', event(target({ composeImageRow: 'x', composeImageIndex: '2' })));
  elements.xPostMod.dispatch('dragend', event(target({})));

  assert.equal(over.prevented, true);
  assert.equal(types.includes('Files'), false);
  assert.deepEqual(moves, [['x', 0, 2]]);
});
