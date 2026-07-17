const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'delegated-action-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckDelegatedActionRuntime;
}

function createRoot() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatch(type, event) { listeners.get(type)?.(event); },
    listenerCount: () => listeners.size,
  };
}

function createTarget(dataset = {}) {
  const target = {
    dataset,
    disabled: false,
    value: 'current-value',
    closest: selector => selector.includes(`[data-${target.lookupAttribute}]`) ? target : null,
  };
  return target;
}

test('delegates declared UI actions without evaluating DOM strings', () => {
  const root = createRoot();
  const calls = [];
  const runtime = loadModule().createDelegatedActionRuntime({
    root,
    actions: {
      removeColumn: context => calls.push(context),
    },
  });
  const target = createTarget({ action: 'removeColumn', columnId: 'column-1' });
  target.lookupAttribute = 'action';
  const event = {
    target,
    preventDefault: () => calls.push('prevented'),
    stopPropagation: () => calls.push('stopped'),
  };

  root.dispatch('click', event);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, target);
  assert.equal(calls[0].event, event);
  assert.equal(calls[0].dataset.columnId, 'column-1');
  runtime.dispose();
  assert.equal(root.listenerCount(), 0);
});

test('supports input, change, double-click, and bounded key actions', () => {
  const root = createRoot();
  const calls = [];
  loadModule().createDelegatedActionRuntime({
    root,
    actions: {
      update: ({ event }) => calls.push(event.type),
    },
  });

  for (const [type, attribute] of [
    ['input', 'inputAction'],
    ['change', 'changeAction'],
    ['dblclick', 'dblclickAction'],
  ]) {
    const target = createTarget({ [attribute]: 'update' });
    target.lookupAttribute = attribute.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
    root.dispatch(type, { type, target });
  }
  const keyTarget = createTarget({ keydownAction: 'update', actionKey: 'Enter' });
  keyTarget.lookupAttribute = 'keydown-action';
  root.dispatch('keydown', { type: 'wrong-key', key: 'Escape', target: keyTarget });
  root.dispatch('keydown', { type: 'keydown', key: 'Enter', target: keyTarget });

  assert.deepEqual(calls, ['input', 'change', 'dblclick', 'keydown']);
});

test('ignores unknown actions and disabled controls', () => {
  const root = createRoot();
  let calls = 0;
  loadModule().createDelegatedActionRuntime({
    root,
    actions: { submit: () => { calls += 1; } },
  });
  const unknown = createTarget({ action: 'globalThis.attack()' });
  unknown.lookupAttribute = 'action';
  root.dispatch('click', { target: unknown });
  const disabled = createTarget({ action: 'submit' });
  disabled.lookupAttribute = 'action';
  disabled.disabled = true;
  root.dispatch('click', { target: disabled });

  assert.equal(calls, 0);
});
