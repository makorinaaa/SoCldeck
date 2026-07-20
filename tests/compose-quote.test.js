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
} = {}) {
  const documentRef = createDocument();
  const calls = { records: [], toasts: [], refreshes: 0, resolvedFacets: [] };
  const quote = loadModule().createComposeQuote({
    documentRef,
    getAccount: () => account,
    buildFacets: text => (text ? [{ text }] : []),
    resolveMentionDids: async facets => {
      calls.resolvedFacets.push(facets);
      return facets;
    },
    createPostRecord: async record => {
      calls.records.push(record);
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
  assert.deepEqual(calls.toasts, ['Quote posted']);
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
