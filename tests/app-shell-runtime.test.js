const test = require('node:test');
const assert = require('node:assert/strict');

function eventRoot() {
  const events = new Map();
  return {
    addEventListener(type, handler) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(handler); },
    removeEventListener(type, handler) { events.get(type)?.delete(handler); },
    emit(type, event = {}) { events.get(type)?.forEach(handler => handler(event)); },
  };
}
function element(...classes) {
  const names = new Set(classes);
  return { innerHTML: '', textContent: '', disabled: false, clicks: 0,
    click() { this.clicks++; },
    classList: { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name) },
  };
}
async function harness() {
  const { createAppShellRuntime } = await import('../src/renderer/app-shell-runtime.mjs');
  const nodes = Object.fromEntries(['login-screen', 'lightbox', 'xPostMod', 'compMod', 'appearanceMod', 'x-sndb', 'sndb', 'toast', 'win-max-btn'].map(id => [id, element()]));
  nodes['login-screen'].classList.add('hidden');
  const documentRef = { ...eventRoot(), getElementById: id => nodes[id], querySelector: () => null, querySelectorAll: () => [] };
  let timer, canceled = 0, escaped = 0;
  const windowRef = { ...eventRoot(), screen: { availWidth: 100, availHeight: 100 }, outerWidth: 100, outerHeight: 100,
    setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { canceled++; } };
  const calls = [], host = new Map();
  const api = {
    onUpdateStatus: callback => { host.set('update-status', callback); return () => host.delete('update-status'); } };
  const actions = Object.fromEntries(['open-add-column', 'refresh-all', 'move-lightbox', 'close-lightbox', 'open-about', 'update-status']
    .map(action => [action, input => calls.push([action, input])]));
  const runtime = createAppShellRuntime({ documentRef, windowRef, api, actions,
    cancelAppearance: () => escaped++, closeOverlay: () => escaped++, closeQuote: () => escaped++,
  });
  return { runtime, documentRef, windowRef, nodes, calls, host, fireTimer: () => timer(), escaped: () => escaped, canceled: () => canceled };
}

test('keyboard shortcuts click only the enabled visible composer and prioritize lightbox', async () => {
  const h = await harness(); h.runtime.attach();
  h.nodes.xPostMod.classList.add('on');
  const event = { key: 'Enter', ctrlKey: true, preventDefault() {} };
  h.documentRef.emit('keydown', event);
  assert.equal(h.nodes['x-sndb'].clicks, 1);
  h.nodes['x-sndb'].disabled = true;
  h.documentRef.emit('keydown', event);
  assert.equal(h.nodes['x-sndb'].clicks, 1);
  h.nodes.lightbox.classList.add('on');
  h.documentRef.emit('keydown', { key: 'ArrowRight' });
  h.documentRef.emit('keydown', { key: 'Escape' });
  assert.deepEqual(h.calls.map(([action]) => action), ['move-lightbox', 'close-lightbox']);
  assert.equal(h.escaped(), 0);
});

test('attach/dispose can repeat without duplicate keyboard or host subscriptions', async () => {
  const h = await harness(); h.runtime.attach(); h.runtime.attach();
  h.documentRef.emit('keydown', { key: 'n', ctrlKey: true, preventDefault() {} });
  h.host.get('update-status')('ready');
  assert.equal(h.calls.length, 2);
  h.runtime.dispose(); assert.equal(h.host.size, 0);
  h.documentRef.emit('keydown', { key: 'n', ctrlKey: true, preventDefault() {} });
  assert.equal(h.calls.length, 2);
  h.runtime.attach(); h.host.get('update-status')('ready'); assert.equal(h.calls.length, 3);
});

test('toast uses textContent and replaces its previous hide timer', async () => {
  const h = await harness(); h.runtime.toast('<img src=x>');
  assert.equal(h.nodes.toast.textContent, '<img src=x>');
  assert.equal(h.nodes.toast.innerHTML, '');
  h.runtime.toast('next'); assert.equal(h.canceled(), 2);
  h.fireTimer(); assert.equal(h.nodes.toast.classList.contains('sh'), false);
});
