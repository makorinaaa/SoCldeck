const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

async function composer({ ticks = [], fileInput = true } = {}) {
  const state = { photos: 0, video: false, busy: false, disabled: false, clicks: 0, polls: 0, error: '', files: [] };
  const style = { setProperty() {}, removeProperty() {} };
  const button = { get disabled() { return state.disabled; }, getAttribute: () => null, click() { state.clicks++; } };
  const input = { dispatchEvent() { state.files = this.files; } };
  const scope = {
    isConnected: true, style, parentElement: null,
    querySelector(selector) {
      if (selector.includes('toolBar')) return {};
      if (selector.includes('fileInput')) return fileInput ? input : null;
      if (selector.includes('videoPlayer')) return state.video ? {} : null;
      if (selector.includes('progressbar')) return state.busy ? {} : null;
      if (selector.includes('tweetButton')) return button;
      if (selector.includes('alert')) return state.error ? { textContent: state.error } : null;
      return null;
    },
    querySelectorAll: selector => selector.includes('tweetPhoto') ? Array(state.photos).fill({}) : [],
  };
  const box = {
    parentElement: scope, isConnected: true, style, textContent: '', click() {}, focus() {}, setAttribute() {},
    dispatchEvent(event) {
      if (event.type === 'paste') this.textContent = event.clipboardData.text;
      if (event.type === 'drop') state.files = event.dataTransfer.files;
    },
  };
  class Transfer {
    constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; }
    setData(type, text) { this.text = text; }
  }
  class BrowserEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  const context = {
    window: {}, document: { querySelector: () => box },
    DataTransfer: Transfer, Event: BrowserEvent, ClipboardEvent: BrowserEvent, DragEvent: BrowserEvent,
    File: class { constructor(bytes, name, options) { this.name = name; this.type = options.type; } },
    atob: text => Buffer.from(text, 'base64').toString('binary'),
    Date: { now: () => state.polls * 200 },
    setTimeout(resolve) { state.polls++; ticks.shift()?.(state, box); resolve(); },
  };
  const { createSubmissionScript } = await import('../src/renderer/x-composer-submit.mjs');
  return {
    state,
    submit: input => vm.runInNewContext(createSubmissionScript({ timeoutMs: 1000, ...input }), context),
  };
}
const photo = { name: 'photo.png', type: 'image/png', dataUrl: 'data:image/png;base64,eA==' };

test('waits for every image and processing to finish even when the post button is enabled', async () => {
  const { state, submit } = await composer({ ticks: [
    state => { state.photos = 1; assert.equal(state.clicks, 0); },
    state => { state.photos = 2; state.busy = true; assert.equal(state.clicks, 0); },
    state => { state.busy = false; },
  ] });
  await submit({ text: 'hello', images: [photo, photo] });
  assert.equal(state.clicks, 1);
  assert.equal(state.polls, 3);
  assert.equal(state.files.length, 2);
});

test('does not send text alone when an attachment never appears', async () => {
  const { state, submit } = await composer();
  await assert.rejects(submit({ text: 'hello', images: [photo] }), /添付/);
  assert.equal(state.clicks, 0);
});

test('waits for video processing and button enablement', async () => {
  const { state, submit } = await composer({ ticks: [
    state => { state.video = true; state.busy = true; },
    state => { state.busy = false; state.disabled = true; },
    state => { state.disabled = false; },
  ] });
  await submit({ text: '', videoDataUrl: 'data:video/mp4;base64,eA==' });
  assert.equal(state.clicks, 1);
  assert.equal(state.polls, 3);
});

test('stops without clicking when the composer disappears or reports an upload error', async () => {
  for (const tick of [
    (state, box) => { box.isConnected = false; },
    state => { state.error = 'Upload failed'; },
  ]) {
    const { state, submit } = await composer({ ticks: [tick] });
    await assert.rejects(submit({ text: '', images: [photo] }), /閉じられ|Upload failed/);
    assert.equal(state.clicks, 0);
  }
});

test('supports image drop fallback and text-only submission', async () => {
  const dropped = await composer({ fileInput: false, ticks: [state => { state.photos = 1; }] });
  await dropped.submit({ text: '', images: [photo] });
  assert.equal(dropped.state.files.length, 1);
  assert.equal(dropped.state.clicks, 1);
  const plain = await composer();
  await plain.submit({ text: 'hello' });
  assert.equal(plain.state.clicks, 1);
});
