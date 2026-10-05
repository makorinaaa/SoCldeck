const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal DOM: supports the simple selectors keyboard-navigation uses
// (".class", "#id", "tag", "[data-attr]") and comma-separated lists of them.
function matchesSimple(node, selector) {
  if (selector.startsWith('.')) return node.classes.has(selector.slice(1));
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  if (selector.startsWith('[data-')) return selector.slice(6, -1) in node.attrs;
  return node.tagName === selector.toUpperCase();
}
function node(tagName, { classes = [], id = '', attrs = {}, children = [] } = {}) {
  const self = {
    tagName: tagName.toUpperCase(), id, attrs, classes: new Set(classes), parent: null, children: [],
    hidden: false, disabled: false, clicks: 0, scrolled: 0,
    dataset: { bskyAction: attrs['bsky-action'] },
    classList: {
      contains: name => self.classes.has(name), add: name => self.classes.add(name), remove: name => self.classes.delete(name),
    },
    matches: selector => selector.split(',').some(part => matchesSimple(self, part.trim())),
    closest(selector) {
      for (let current = self; current; current = current.parent) if (current.matches(selector)) return current;
      return null;
    },
    querySelectorAll(selector) {
      const found = [];
      const walk = parent => parent.children.forEach(child => { if (child.matches(selector)) found.push(child); walk(child); });
      walk(self);
      return found;
    },
    querySelector: selector => self.querySelectorAll(selector)[0] || null,
    focus() { doc.activeElement = self; },
    blur() { doc.activeElement = doc.body; },
    click() { self.clicks++; },
    scrollIntoView() { self.scrolled++; },
  };
  children.forEach(child => { child.parent = self; self.children.push(child); });
  return self;
}
let doc;

function post(name) {
  return node('div', { classes: ['post'], id: name, children: ['reply', 'repost', 'like']
    .map(action => node('button', { attrs: { 'bsky-action': action } })) });
}
function harness() {
  const columnA = node('div', { classes: ['col'], children: [node('div', { classes: ['feed'], children: [post('a1'), post('a2'), post('a3')] })] });
  const columnB = node('div', { classes: ['col'], children: [node('div', { classes: ['feed'], children: [post('b1')] })] });
  const columnX = node('div', { classes: ['col'], children: [node('webview', { id: 'x-view' })] });
  const login = node('div', { id: 'login-screen', classes: ['hidden'] });
  const modal = node('div', { classes: ['ov'], id: 'settingsMod' });
  const body = node('body', { children: [login, modal, columnA, columnB, columnX] });
  doc = {
    body, activeElement: body,
    getElementById: id => (body.id === id ? body : body.querySelectorAll(`#${id}`)[0] || null),
    querySelectorAll: selector => body.querySelectorAll(selector),
  };
  const calls = [];
  return import('../src/renderer/keyboard-navigation.mjs').then(({ createKeyboardNavigation }) => {
    const nav = createKeyboardNavigation({ documentRef: doc, actions: {
      'open-compose': input => calls.push(['open-compose', input]),
      'open-shortcuts': () => calls.push(['open-shortcuts']),
    } });
    const press = (key, extra = {}) => {
      let prevented = false;
      const consumed = nav.onKeydown({ key, target: doc.activeElement, preventDefault() { prevented = true; }, ...extra });
      assert.equal(consumed, prevented);
      return consumed;
    };
    const byId = id => body.querySelectorAll(`#${id}`)[0];
    return { press, byId, calls, login, modal, columnB, focused: () => doc.activeElement.id };
  });
}

test('j/k move through the column and start from the first post', async () => {
  const h = await harness();
  assert.equal(h.press('j'), true); assert.equal(h.focused(), 'a1');
  h.press('j'); h.press('j'); assert.equal(h.focused(), 'a3');
  assert.equal(h.press('j'), true, 'consumed at the end without leaving the column');
  assert.equal(h.focused(), 'a3');
  h.press('k'); assert.equal(h.focused(), 'a2');
  assert.ok(h.byId('a2').scrolled > 0);
});

test('l/t/r click the focused post action and skip disabled buttons', async () => {
  const h = await harness();
  assert.equal(h.press('l'), false, 'ignored without a selected post');
  h.press('j');
  const [reply, repost, like] = h.byId('a1').children;
  h.press('l'); h.press('t'); h.press('r');
  assert.deepEqual([reply.clicks, repost.clicks, like.clicks], [1, 1, 1]);
  like.disabled = true; h.press('l'); assert.equal(like.clicks, 1);
});

test('number keys and arrows move between columns, including X WebViews', async () => {
  const h = await harness();
  h.press('2'); assert.equal(h.focused(), 'b1');
  h.press('ArrowRight'); assert.equal(h.focused(), 'x-view');
  h.press('1'); h.press('ArrowRight'); assert.equal(h.focused(), 'b1');
  assert.equal(h.press('9'), false);
  h.columnB.classList.add('collapsed');
  h.press('2'); assert.equal(h.focused(), 'x-view');
});

test('n opens compose for the network of the selected column; ? opens help', async () => {
  const h = await harness();
  h.press('n'); h.press('j'); h.press('n'); h.press('?');
  assert.deepEqual(h.calls, [
    ['open-compose', { network: null }], ['open-compose', { network: 'bluesky' }], ['open-shortcuts'],
  ]);
});

test('shortcuts stay out of the way of typing, modifiers, IME, modals and login', async () => {
  const h = await harness();
  assert.equal(h.press('j', { target: node('textarea') }), false);
  assert.equal(h.press('j', { ctrlKey: true }), false);
  assert.equal(h.press('j', { isComposing: true }), false);
  h.modal.classList.add('on'); assert.equal(h.press('j'), false); h.modal.classList.remove('on');
  h.login.classList.remove('hidden'); assert.equal(h.press('j'), false); h.login.classList.add('hidden');
  assert.equal(h.press('j'), true);
  assert.equal(h.press('Escape'), true); assert.equal(h.focused(), '');
});
