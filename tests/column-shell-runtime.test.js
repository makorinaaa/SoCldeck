const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return new Set(String(this.element.className || '').split(/\s+/).filter(Boolean));
  }

  write(values) {
    this.element.className = [...values].join(' ');
  }

  add(...names) {
    const values = this.values();
    names.forEach(name => values.add(name));
    this.write(values);
  }

  remove(...names) {
    const values = this.values();
    names.forEach(name => values.delete(name));
    this.write(values);
  }

  contains(name) {
    return this.values().has(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.className = '';
    this.classList = new FakeClassList(this);
    this.id = '';
    this.title = '';
    this.textContent = '';
    this.innerHTML = '';
    this.listeners = new Map();
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  closest(selector) {
    if (selector === 'button' && this.tagName === 'BUTTON') return this;
    if (selector === '[data-shell-action]' && this.dataset.shellAction) return this;
    if (selector === '[data-shell-dblclick-action]' && this.dataset.shellDblclickAction) return this;
    return this.parentNode?.closest?.(selector) || null;
  }
}

function descendants(element) {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}

function findByClass(element, className) {
  return descendants(element).find(child => child.classList.contains(className));
}

function createHarness() {
  const documentListeners = new Map();
  const documentRef = {
    createElement: tagName => new FakeElement(tagName),
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (documentListeners.get(type) === listener) documentListeners.delete(type);
    },
  };
  const container = new FakeElement('main');
  const addButton = new FakeElement('button');
  addButton.className = 'add-col-btn';
  container.appendChild(addButton);
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'column-shell-runtime.js'),
    'utf8',
  );
  const context = { window: { document: documentRef } };
  vm.runInNewContext(source, context);
  const collapsed = [];
  const resized = [];
  const intents = [];
  const runtime = context.window.SocialDeckColumnShellRuntime.createColumnShellRuntime({
    documentRef,
    container,
    getInsertionPoint: () => addButton,
    onCollapseChange: (id, value) => collapsed.push([id, value]),
    onWidthChange: (id, width) => resized.push([id, width]),
    onIntent: intent => intents.push(intent),
  });
  return { runtime, container, addButton, collapsed, resized, intents, documentListeners };
}

function mountFixture(runtime, overrides = {}) {
  return runtime.mount({
    id: 'anime-1',
    kind: 'schedule',
    network: 'anime',
    definitionId: 'anime-today',
    title: '<Today>',
    subtitle: 'Schedule',
    iconClass: 'ic-anime',
    icon: '<svg>trusted</svg>',
    indicatorColor: '#ffd166',
    badge: true,
    actions: ['refresh', 'collapse', { type: 'settings', columnType: 'schedule' }, 'remove'],
    hosts: [
      { name: 'content', id: 'feed-anime-1', className: 'feed anime-schedule' },
    ],
    ...overrides,
  });
}

test('mounts a capability-driven Column shell before the add button', () => {
  const { runtime, container, addButton } = createHarness();

  const result = mountFixture(runtime);

  assert.equal(container.children[0], result.root);
  assert.equal(container.children[1], addButton);
  assert.equal(result.root.id, 'col-anime-1');
  assert.equal(result.root.dataset.network, 'anime');
  assert.equal(result.root.dataset.definitionId, 'anime-today');
  assert.equal(findByClass(result.root, 'col-title').textContent, '<Today>');
  assert.equal(findByClass(result.root, 'col-ic').innerHTML, '<svg>trusted</svg>');
  assert.equal(result.hosts.content.id, 'feed-anime-1');
  assert.equal(findByClass(result.root, 'cbadge').style.display, 'none');
  assert.deepEqual(
    descendants(result.root).filter(element => element.tagName === 'BUTTON').map(button => button.dataset.shellAction),
    ['refresh', 'collapse', 'settings', 'remove'],
  );
});

test('updates refresh presentation without querying global Column DOM', () => {
  const { runtime } = createHarness();
  const { root } = mountFixture(runtime);

  runtime.setRefreshState('anime-1', {
    status: 'succeeded',
    lastUpdatedAt: '2026-07-18T12:34:00.000Z',
  });

  const state = findByClass(root, 'col-refresh-state');
  assert.match(state.textContent, /12:34|21:34/);
  assert.match(state.title, /2026/);

  runtime.setRefreshState('anime-1', { status: 'failed', error: new Error('offline') });
  assert.equal(state.textContent, '失敗');
  assert.match(state.title, /offline/);
});

test('owns collapse presentation and reports user changes', () => {
  const { runtime, collapsed } = createHarness();
  const { root, hosts } = mountFixture(runtime);

  assert.equal(runtime.toggleCollapsed('anime-1'), true);
  assert.equal(runtime.isCollapsed('anime-1'), true);
  assert.equal(root.style.width, '42px');
  assert.equal(hosts.content.style.display, 'none');
  assert.deepEqual(collapsed, [['anime-1', true]]);

  assert.equal(runtime.setCollapsed('anime-1', false), true);
  assert.equal(runtime.isCollapsed('anime-1'), false);
  assert.equal(hosts.content.style.display, '');
  assert.deepEqual(collapsed, [['anime-1', true]]);
});

test('applies width, rejects duplicate ids, and disposes shell-owned DOM', () => {
  const { runtime, container, addButton } = createHarness();
  mountFixture(runtime);

  assert.equal(runtime.applyWidth('anime-1', '360px'), true);
  assert.throws(() => mountFixture(runtime), /already mounted/);
  assert.deepEqual(Array.from(runtime.listIds()), ['anime-1']);
  assert.equal(runtime.remove('anime-1'), true);
  assert.deepEqual(container.children, [addButton]);

  mountFixture(runtime);
  runtime.dispose();
  assert.deepEqual(Array.from(runtime.listIds()), []);
  assert.deepEqual(container.children, [addButton]);
});

test('owns resize presentation and reports the committed width', () => {
  const { runtime, resized, documentListeners } = createHarness();
  const { root } = mountFixture(runtime);
  root.offsetWidth = 300;
  const handle = findByClass(root, 'col-resize');

  handle.listeners.get('mousedown')({ clientX: 100, preventDefault() {} });
  documentListeners.get('mousemove')({ clientX: 175 });
  documentListeners.get('mouseup')();

  assert.equal(root.style.width, '375px');
  assert.equal(root.style.minWidth, '375px');
  assert.deepEqual(resized, [['anime-1', '375px']]);
  assert.equal(documentListeners.has('mousemove'), false);
  assert.equal(documentListeners.has('mouseup'), false);
});

test('translates shell events into one semantic intent', () => {
  const { runtime, container, intents, collapsed } = createHarness();
  const { root } = mountFixture(runtime);
  const buttons = descendants(root).filter(element => element.tagName === 'BUTTON');
  const refresh = buttons.find(button => button.dataset.shellAction === 'refresh');
  const collapse = buttons.find(button => button.dataset.shellAction === 'collapse');
  const info = findByClass(root, 'col-info');

  container.listeners.get('click')({ target: refresh });
  container.listeners.get('click')({ target: info });
  container.listeners.get('click')({ target: collapse });
  container.listeners.get('dblclick')({ target: info });

  assert.deepEqual(
    intents.map(({ type, id, kind }) => [type, id, kind]),
    [['refresh', 'anime-1', 'schedule'], ['scroll-top', 'anime-1', 'schedule']],
  );
  assert.deepEqual(collapsed, [['anime-1', true], ['anime-1', false]]);
  assert.equal(runtime.isCollapsed('anime-1'), false);
});
