const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { window: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'file-drag-shield.js'), 'utf8');
  vm.runInNewContext(source, context);
  return context.window.SocialDeckFileDragShield;
}

function createDocument() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, listener) { listeners[type] = listener; },
    querySelectorAll: () => [],
  };
}

function fileDrag(insideSelector) {
  return {
    target: { closest: selector => (selector === insideSelector ? {} : null) },
    dataTransfer: { types: ['Files'], dropEffect: 'copy' },
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

test('lets files reach the whole Compose modals and blocks them everywhere else', () => {
  const documentRef = createDocument();
  loadModule().createFileDragShield({ documentRef }).attach();

  for (const selector of ['#xPostMod', '#compMod']) {
    const over = fileDrag(selector);
    documentRef.listeners.dragover(over);
    assert.equal(over.dataTransfer.dropEffect, 'copy');
    const drop = fileDrag(selector);
    documentRef.listeners.drop(drop);
    assert.equal(drop.prevented, false);
  }

  const outside = fileDrag(null);
  documentRef.listeners.dragover(outside);
  assert.equal(outside.dataTransfer.dropEffect, 'none');
  const drop = fileDrag(null);
  documentRef.listeners.drop(drop);
  assert.equal(drop.prevented, true);
});
