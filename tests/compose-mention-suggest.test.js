const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = {
    window: {
      setTimeout: callback => { callback(); return 1; },
      clearTimeout: () => {},
      innerWidth: 1200,
    },
    Event: class Event {
      constructor(type, options) { this.type = type; this.options = options; }
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'compose-mention-suggest.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckComposeMentionSuggest;
}

function createDocument() {
  const elements = {};
  const listeners = {};
  return {
    elements,
    listeners,
    register(element) { elements[element.id] = element; },
    getElementById(id) { return elements[id] || null; },
    createElement: () => ({
      id: '',
      innerHTML: '',
      style: {},
      dataset: {},
    }),
    body: {
      appendChild(element) { elements[element.id] = element; },
    },
    addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener() {},
  };
}

test('suggests Bluesky actors for the @query before the cursor', async () => {
  const documentRef = createDocument();
  const searches = [];
  const suggest = loadModule().createComposeMentionSuggest({
    documentRef,
    windowRef: { innerWidth: 1200 },
    searchActors: async query => {
      searches.push(query);
      return [
        { handle: 'alice.bsky.social', displayName: 'Alice', avatar: '' },
        { handle: 'albert.example', displayName: '', avatar: 'https://cdn/a.jpg' },
      ];
    },
    ui: { avatarBackground: () => 'bg-1' },
  });

  const textarea = {
    value: 'hello @al',
    selectionStart: 9,
    getBoundingClientRect: () => ({ left: 100, bottom: 240 }),
  };
  await suggest.onInput({ target: textarea });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(searches, ['al']);
  const box = documentRef.getElementById('mention-suggest');
  assert.ok(box, 'suggest box must be created');
  assert.equal(box.style.display, 'block');
  assert.equal(box.style.left, '108px');
  assert.equal(box.style.top, '244px');
  assert.match(box.innerHTML, /data-handle="alice\.bsky\.social"/);
  assert.match(box.innerHTML, /Alice/);
  assert.match(box.innerHTML, /https:\/\/cdn\/a\.jpg/);

  // 同じクエリでは再検索しない
  await suggest.onInput({ target: textarea });
  assert.equal(searches.length, 1);
});

test('hides the suggest box when no @query precedes the cursor', async () => {
  const documentRef = createDocument();
  const box = { id: 'mention-suggest', style: { display: 'block' } };
  documentRef.register(box);
  const suggest = loadModule().createComposeMentionSuggest({
    documentRef,
    searchActors: async () => [],
  });

  await suggest.onInput({ target: { value: 'plain text', selectionStart: 10 } });
  assert.equal(box.style.display, 'none');
});

test('inserts the picked handle at the @query and notifies the textarea', () => {
  const documentRef = createDocument();
  const events = [];
  const textarea = {
    id: 'cta',
    value: 'hi @al and more',
    selectionStart: 6,
    selectionEnd: 6,
    focus() { this.focused = true; },
    dispatchEvent: event => events.push(event.type),
  };
  documentRef.register(textarea);
  const box = { id: 'mention-suggest', style: { display: 'block' } };
  documentRef.register(box);
  const suggest = loadModule().createComposeMentionSuggest({
    documentRef,
    searchActors: async () => [],
  });

  suggest.insert('alice.bsky.social');

  assert.equal(textarea.value, 'hi @alice.bsky.social  and more');
  assert.equal(textarea.selectionStart, 'hi @alice.bsky.social '.length);
  assert.equal(textarea.focused, true);
  assert.deepEqual(events, ['input']);
  assert.equal(box.style.display, 'none');
});

test('hides the suggest box when clicking outside it', () => {
  const documentRef = createDocument();
  const box = { id: 'mention-suggest', style: { display: 'block' } };
  documentRef.register(box);
  loadModule().createComposeMentionSuggest({
    documentRef,
    searchActors: async () => [],
  });

  documentRef.listeners.click({ target: { closest: () => null } });
  assert.equal(box.style.display, 'none');
});
