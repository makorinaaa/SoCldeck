const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveWindowBounds } = require('../src/main/window-bounds');

const defaults = { width: 1400, height: 900 };
const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary = { x: 1920, y: 0, width: 2560, height: 1400 };

test('uses the defaults when nothing was saved', () => {
  assert.deepEqual(resolveWindowBounds(undefined, { defaults, displays: [primary] }), defaults);
});

test('restores a window that is on a connected display', () => {
  const saved = { x: 2000, y: 100, width: 1200, height: 800 };
  assert.deepEqual(resolveWindowBounds(saved, { defaults, displays: [primary, secondary] }), saved);
});

test('keeps the size but centers a window whose display was disconnected', () => {
  const saved = { x: 2000, y: 100, width: 1200, height: 800 };
  assert.deepEqual(resolveWindowBounds(saved, { defaults, displays: [primary] }), { width: 1200, height: 800 });
});

test('centers a window saved while minimized', () => {
  const saved = { x: -32000, y: -32000, width: 160, height: 28 };
  assert.deepEqual(resolveWindowBounds(saved, { defaults, displays: [primary] }), { width: 160, height: 28 });
});

test('centers a window whose top bar is above the screen', () => {
  const saved = { x: 100, y: -200, width: 1200, height: 800 };
  assert.deepEqual(resolveWindowBounds(saved, { defaults, displays: [primary] }), { width: 1200, height: 800 });
});

test('restores a window that only partly hangs off the screen edge', () => {
  const saved = { x: 1700, y: 50, width: 1200, height: 800 };
  assert.deepEqual(resolveWindowBounds(saved, { defaults, displays: [primary] }), saved);
});

test('falls back to the default size for broken values', () => {
  const saved = { x: 10, y: 10, width: 0, height: 'big' };
  assert.deepEqual(resolveWindowBounds(saved, { defaults, displays: [primary] }), { ...defaults, x: 10, y: 10 });
});
