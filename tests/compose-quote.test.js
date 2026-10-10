const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadModule() {
  const context = { window: { setTimeout: callback => { callback(); return 1; } } };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'compose-quote.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckComposeQuote;
}

function createDocument() {
  const elements = {};
  return {
    elements,
    register(element) { elements[element.id] = element; },
    getElementById(id) { return elements[id] || null; },
    createElement() {
      const element = {
        id: '',
        className: '',
        innerHTML: '',
        onclick: null,
        remove() { delete elements[element.id]; },
      };
      return element;
    },
    body: {
      appendChild(element) { elements[element.id] = element; },
    },
  };
}

function createHarness({
  account = { bg: '#123', initials: 'ME' },
  createPostRecord = async record => ({ record }),
  measurePost,
  createPostKey,
  isUnknownOutcome,
} = {}) {
  const documentRef = createDocument();
  const calls = { records: [], keys: [], toasts: [], refreshes: 0, resolvedFacets: [] };
  const quote = loadModule().createComposeQuote({
    documentRef,
    ...(measurePost ? { measurePost } : {}),
    ...(createPostKey ? { createPostKey } : {}),
    ...(isUnknownOutcome ? { isUnknownOutcome } : {}),
    getAccount: () => account,
    buildFacets: text => (text ? [{ text }] : []),
    resolveMentionDids: async facets => {
      calls.resolvedFacets.push(facets);
      return facets;
    },
    createPostRecord: async (record, options = {}) => {
      calls.records.push(record);
      calls.keys.push(options.rkey ?? null);
      return createPostRecord(record);
    },
    intents: {
      toast: message => calls.toasts.push(message),
      refreshTimelines: () => { calls.refreshes += 1; },
    },
  });
  return { quote, documentRef, calls };
}

test('opens the quote modal with escaped source metadata', () => {
  const { quote, documentRef } = createHarness();

  quote.open('at://did:plc:a/app.bsky.feed.post/abc123', 'cid-1', 'alice.<b>');

  const overlay = documentRef.getElementById('quote-modal-ov');
  assert.ok(overlay);
  assert.equal(overlay.className, 'ov on');
  assert.match(overlay.innerHTML, /@alice\.&lt;b&gt; の投稿を引用/);
  assert.match(overlay.innerHTML, /abc123/);
  assert.match(overlay.innerHTML, /class="quote-src"/);
  assert.doesNotMatch(overlay.innerHTML, /onmouse|style="border/);
});

test('tracks the character count against the Bluesky limit', () => {
  const { quote, documentRef } = createHarness();
  const textarea = { id: 'quote-ta', value: 'あ'.repeat(261) };
  const counter = { id: 'quote-cct', textContent: '', className: '' };
  const button = { id: 'quote-sndb', disabled: false };
  documentRef.register(textarea);
  documentRef.register(counter);
  documentRef.register(button);

  quote.updateCharacterCount();
  assert.equal(counter.textContent, '261 / 300');
  assert.equal(counter.className, 'cc w');
  assert.equal(button.disabled, false);

  textarea.value = 'あ'.repeat(301);
  quote.updateCharacterCount();
  assert.equal(counter.className, 'cc w over');
  assert.equal(button.disabled, true);
});

test('submits a quote record and refreshes timelines afterwards', async () => {
  const { quote, documentRef, calls } = createHarness();
  quote.open('at://post/1', 'cid-1', 'alice.test');
  documentRef.register({ id: 'quote-ta', value: ' 引用コメント ' });
  documentRef.register({ id: 'quote-sndb', disabled: false, textContent: '引用して投稿' });

  await quote.submit();

  assert.equal(calls.records.length, 1);
  const record = calls.records[0];
  assert.equal(record.$type, 'app.bsky.feed.post');
  assert.equal(record.text, '引用コメント');
  assert.deepEqual(plain(record.embed), {
    $type: 'app.bsky.embed.record',
    record: { uri: 'at://post/1', cid: 'cid-1' },
  });
  assert.deepEqual(plain(record.facets), [{ text: '引用コメント' }]);
  assert.equal(documentRef.getElementById('quote-modal-ov'), null);
  assert.deepEqual(calls.toasts, ['引用ポストを投稿しました']);
  assert.equal(calls.refreshes, 1);
});

test('keeps the modal open and re-enables submit after a failure', async () => {
  const { quote, documentRef, calls } = createHarness({
    createPostRecord: async () => { throw new Error('boom'); },
  });
  quote.open('at://post/1', 'cid-1', 'alice.test');
  const button = { id: 'quote-sndb', disabled: false, textContent: '引用して投稿' };
  documentRef.register({ id: 'quote-ta', value: 'x' });
  documentRef.register(button);

  await quote.submit();

  assert.ok(documentRef.getElementById('quote-modal-ov'));
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '引用して投稿');
  assert.deepEqual(calls.toasts, ['エラー: boom']);
  assert.equal(calls.refreshes, 0);
});

test('close clears the quote target so submit becomes a no-op', async () => {
  const { quote, documentRef, calls } = createHarness();
  quote.open('at://post/1', 'cid-1', 'alice.test');
  documentRef.register({ id: 'quote-ta', value: 'x' });

  quote.close();
  assert.equal(documentRef.getElementById('quote-modal-ov'), null);

  await quote.submit();
  assert.equal(calls.records.length, 0);
});

test('counts quote text by Bluesky graphemes', async () => {
  const { measurePost } = await import('../src/renderer/post-length.mjs');
  const { quote, documentRef } = createHarness({ measurePost });
  const textarea = { id: 'quote-ta', value: '😀'.repeat(151) };
  const counter = { id: 'quote-cct', textContent: '', className: '' };
  const button = { id: 'quote-sndb', disabled: false };
  documentRef.register(textarea);
  documentRef.register(counter);
  documentRef.register(button);

  quote.updateCharacterCount();
  assert.equal(counter.textContent, '151 / 300');
  assert.equal(button.disabled, false);

  textarea.value = '😀'.repeat(301);
  quote.updateCharacterCount();
  assert.equal(button.disabled, true);
});

function loadDelivery() {
  const context = { window: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'bsky-compose-delivery.js'), 'utf8');
  vm.runInNewContext(source, context);
  return context.window.SocialDeckBskyComposeDelivery;
}

function timeout() {
  return Object.assign(new Error('createRecord request timed out'), { status: 0, code: 'RequestTimeout' });
}

function openWithText(quote, documentRef, uri, value) {
  quote.open(uri, 'cid-1', 'alice.test');
  const textarea = { id: 'quote-ta', value, readOnly: false };
  const button = { id: 'quote-sndb', disabled: false, textContent: '引用して投稿' };
  documentRef.register(textarea);
  documentRef.register(button);
  return { textarea, button };
}

test('retries a quote under the record key chosen when the quote was opened', async () => {
  const keys = ['key-1', 'key-2'];
  let failures = 1;
  const { quote, documentRef, calls } = createHarness({
    createPostKey: () => keys.shift(),
    createPostRecord: async record => {
      if (failures-- > 0) throw new Error('boom');
      return { record };
    },
  });
  openWithText(quote, documentRef, 'at://post/1', '引用');

  await quote.submit();
  await quote.submit();

  assert.deepEqual(calls.keys, ['key-1', 'key-1']);
  assert.equal(documentRef.getElementById('quote-modal-ov'), null);
});

test('locks the quote text after an unknown outcome so a retry cannot post different text', async () => {
  const { isUnknownPostOutcome } = loadDelivery();
  let failures = 1;
  const { quote, documentRef, calls } = createHarness({
    createPostKey: () => 'key-1',
    isUnknownOutcome: isUnknownPostOutcome,
    createPostRecord: async record => {
      if (failures-- > 0) throw timeout();
      return { record };
    },
  });
  const { textarea, button } = openWithText(quote, documentRef, 'at://post/1', '引用');

  await quote.submit();

  assert.equal(textarea.readOnly, true);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '再試行');
  assert.match(calls.toasts.at(-1), /重複/);
  assert.ok(documentRef.getElementById('quote-modal-ov'));

  textarea.value = '書き換えた引用';
  await quote.submit();
  assert.deepEqual(calls.records.map(record => record.text), ['引用', '引用']);
  assert.deepEqual(calls.keys, ['key-1', 'key-1']);
});

test('reopening a quote whose outcome is unknown keeps its text and record key', async () => {
  const { isUnknownPostOutcome } = loadDelivery();
  const keys = ['key-1', 'key-2'];
  const { quote, documentRef, calls } = createHarness({
    createPostKey: () => keys.shift(),
    isUnknownOutcome: isUnknownPostOutcome,
    createPostRecord: async () => { throw timeout(); },
  });
  openWithText(quote, documentRef, 'at://post/1', '最初の引用');
  await quote.submit();
  quote.close();

  const textarea = { id: 'quote-ta', value: '', readOnly: false, focus() {} };
  documentRef.register(textarea);
  quote.open('at://post/1', 'cid-1', 'alice.test');
  assert.equal(textarea.value, '最初の引用');
  assert.equal(textarea.readOnly, true);
  await quote.submit();
  assert.deepEqual(calls.keys, ['key-1', 'key-1']);

  quote.open('at://post/2', 'cid-2', 'bob.test');
  documentRef.register({ id: 'quote-ta', value: '別の引用', readOnly: false });
  await quote.submit();
  assert.deepEqual(calls.keys, ['key-1', 'key-1', 'key-2']);
});
