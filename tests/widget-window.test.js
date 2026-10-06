const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const {
  createWidgetWindowController,
  fitBoundsToDisplays,
  snapBoundsToWorkArea,
} = require('../src/main/widget-window');

const primary = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const secondary = { workArea: { x: 1920, y: 0, width: 1280, height: 1024 } };

test('keeps saved widget bounds that are still on a connected display', () => {
  const saved = { x: 2000, y: 100, width: 400, height: 700 };
  assert.deepEqual(fitBoundsToDisplays(saved, { displays: [primary, secondary], primary }), saved);
});

test('moves a widget left on a disconnected display back onto the primary display', () => {
  const saved = { x: 2000, y: 100, width: 400, height: 700 };
  assert.deepEqual(fitBoundsToDisplays(saved, { displays: [primary], primary }), {
    x: 760, y: 170, width: 400, height: 700,
  });
});

test('re-centers a widget whose drag bar is above the visible work area', () => {
  const saved = { x: 100, y: -500, width: 400, height: 700 };
  const fitted = fitBoundsToDisplays(saved, { displays: [primary], primary });
  assert.equal(fitted.y >= 0, true);
});

test('uses default size when no bounds were saved', () => {
  assert.deepEqual(fitBoundsToDisplays(undefined, { displays: [primary], primary }), { width: 400, height: 700 });
});

test('snaps widget edges that are dropped near the work area edges', () => {
  const area = primary.workArea;
  assert.deepEqual(snapBoundsToWorkArea({ x: 10, y: 300, width: 400, height: 600 }, area),
    { x: 0, y: 300, width: 400, height: 600 });
  assert.deepEqual(snapBoundsToWorkArea({ x: 1510, y: 430, width: 400, height: 600 }, area),
    { x: 1520, y: 440, width: 400, height: 600 });
  assert.equal(snapBoundsToWorkArea({ x: 200, y: 200, width: 400, height: 600 }, area), null);
});

function createHarness(initialConfig = {}) {
  let config = { ...initialConfig };
  const updates = [];
  const timers = [];
  const windows = [];
  let quitting = false;

  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.top = options.alwaysOnTop === true;
      this.topCalls = [];
      this.opacity = 1;
      this.movable = options.movable;
      this.resizable = options.resizable;
      this.destroyed = false;
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isAlwaysOnTop() { return this.top; }
    setAlwaysOnTop(value, level) { this.top = value; this.topCalls.push([value, level]); }
    moveTop() { this.movedTop = true; }
    setOpacity(value) { this.opacity = value; }
    setMovable(value) { this.movable = value; }
    setResizable(value) { this.resizable = value; }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; }
    isVisible() { return this.shown === true; }
    hide() { this.shown = false; }
    show() { this.shown = true; this.emit('show'); }
    focus() {}
    close() {
      this.emit('close');
      this.destroyed = true;
      this.emit('closed');
    }
  }

  const controller = createWidgetWindowController({
    BrowserWindow: FakeWindow,
    screen: {
      getAllDisplays: () => [primary],
      getPrimaryDisplay: () => primary,
      getDisplayMatching: () => primary,
    },
    loadConfig: () => ({ ...config }),
    updateConfig: patch => { updates.push(patch); config = { ...config, ...patch }; },
    loadContents: () => {},
    isAppQuitting: () => quitting,
    setTimer: callback => { timers.push(callback); return timers.length; },
    clearTimer: () => {},
  });
  return {
    controller,
    windows,
    updates,
    getConfig: () => config,
    runTimers: () => timers.splice(0).forEach(callback => callback()),
    quit: () => { quitting = true; },
  };
}

test('re-applies always-on-top after showing and whenever the widget loses focus', () => {
  const harness = createHarness({ widgetAlwaysOnTop: true });
  const win = harness.controller.open();
  win.emit('ready-to-show');
  assert.deepEqual(win.topCalls.at(-1), [true, 'screen-saver']);

  win.topCalls.length = 0;
  win.emit('blur');
  assert.deepEqual(win.topCalls, [[true, 'screen-saver']]);
  assert.equal(win.movedTop, true);
});

test('toggling always-on-top off stops re-asserting it on blur', () => {
  const harness = createHarness({ widgetAlwaysOnTop: true });
  const win = harness.controller.open();
  assert.equal(harness.controller.toggleTop(), false);
  assert.equal(harness.getConfig().widgetAlwaysOnTop, false);
  win.topCalls.length = 0;
  win.emit('blur');
  assert.deepEqual(win.topCalls, []);
  assert.equal(harness.controller.getState().alwaysOnTop, false);
});

test('saves bounds after moving instead of only on close', () => {
  const harness = createHarness();
  const win = harness.controller.open();
  win.bounds = { x: 10, y: 20, width: 400, height: 700 };
  win.emit('move');
  win.emit('move');
  assert.equal(harness.getConfig().widgetBounds, undefined);
  harness.runTimers();
  assert.deepEqual(harness.getConfig().widgetBounds, { x: 10, y: 20, width: 400, height: 700 });
});

test('applies opacity immediately but writes it to config only once per burst', () => {
  const harness = createHarness();
  const win = harness.controller.open();
  harness.updates.length = 0;
  harness.controller.setOpacity(0.9);
  harness.controller.setOpacity(0.8);
  harness.controller.setOpacity(0.1);
  assert.equal(win.opacity, 0.3);
  assert.deepEqual(harness.updates, []);
  harness.runTimers();
  assert.deepEqual(harness.updates, [{ widgetOpacity: 0.3 }]);
});

test('background-only transparency keeps the window itself opaque', () => {
  const harness = createHarness({ widgetOpacity: 0.5 });
  const win = harness.controller.open();
  win.emit('ready-to-show');
  assert.equal(win.opacity, 0.5);
  assert.equal(harness.controller.setBackgroundOnly(true), true);
  assert.equal(win.opacity, 1);
  harness.controller.setOpacity(0.4);
  assert.equal(win.opacity, 1);
  assert.equal(harness.controller.setBackgroundOnly(false), false);
  assert.equal(win.opacity, 0.4);
});

test('locks the widget position and size', () => {
  const harness = createHarness();
  const win = harness.controller.open();
  assert.equal(harness.controller.toggleLock(), true);
  assert.equal(win.movable, false);
  assert.equal(win.resizable, false);
  assert.equal(harness.controller.toggleLock(), false);
  assert.equal(win.movable, true);

  const lockedHarness = createHarness({ widgetLocked: true });
  const lockedWindow = lockedHarness.controller.open();
  assert.equal(lockedWindow.options.movable, false);
  assert.equal(lockedWindow.options.resizable, false);
});

test('reopens the widget on launch unless the user closed it', () => {
  const closedByUser = createHarness();
  closedByUser.controller.open().close();
  assert.equal(closedByUser.getConfig().widgetOpen, false);
  closedByUser.controller.restoreOnLaunch();
  assert.equal(closedByUser.windows.length, 1);

  const closedByQuit = createHarness();
  const win = closedByQuit.controller.open();
  win.bounds = { x: 5, y: 6, width: 400, height: 700 };
  closedByQuit.quit();
  win.close();
  assert.equal(closedByQuit.getConfig().widgetOpen, true);
  assert.deepEqual(closedByQuit.getConfig().widgetBounds, { x: 5, y: 6, width: 400, height: 700 });
  closedByQuit.controller.restoreOnLaunch();
  assert.equal(closedByQuit.windows.length, 2);
});

test('only the widget window is owned by the controller', () => {
  const harness = createHarness();
  const win = harness.controller.open();
  assert.equal(harness.controller.owns(win), true);
  assert.equal(harness.controller.owns({}), false);
  win.close();
  assert.equal(harness.controller.owns(win), false);
  assert.equal(harness.controller.window, null);
});

test('snaps to the screen edge after a drag unless the widget is locked', () => {
  const harness = createHarness();
  const win = harness.controller.open();
  win.bounds = { x: 8, y: 12, width: 400, height: 700 };
  win.emit('moved');
  assert.deepEqual(win.bounds, { x: 0, y: 0, width: 400, height: 700 });
  harness.runTimers();
  assert.deepEqual(harness.getConfig().widgetBounds, { x: 0, y: 0, width: 400, height: 700 });

  harness.controller.toggleLock();
  win.bounds = { x: 8, y: 12, width: 400, height: 700 };
  win.emit('moved');
  assert.deepEqual(win.bounds, { x: 8, y: 12, width: 400, height: 700 });
});

test('the shortcut opens, hides and shows the widget', () => {
  const harness = createHarness();
  const win = harness.controller.toggleVisibility();
  assert.equal(harness.windows.length, 1);
  win.show();
  harness.controller.toggleVisibility();
  assert.equal(win.isVisible(), false);
  harness.controller.toggleVisibility();
  assert.equal(win.isVisible(), true);
  assert.equal(harness.windows.length, 1);
});
