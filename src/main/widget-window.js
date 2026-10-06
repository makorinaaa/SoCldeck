// デスクトップウィジェットのウィンドウ制御（Main プロセス専用）。
// 位置・透明度・最前面・ロックの状態をウィンドウと設定ファイルの両方に反映する。

const DEFAULT_BOUNDS = { width: 400, height: 700 };
const MIN_WIDTH = 280;
const MIN_HEIGHT = 300;
const MIN_OPACITY = 0.3;
// これ以上見えていればモニター上にあるとみなす（タイトルバーを掴める大きさ）
const MIN_VISIBLE = 80;
const SAVE_DELAY_MS = 500;
// Windows では別の最前面ウィンドウに z-order を奪われるため、最も高いレベルで固定する
const TOP_LEVEL = 'screen-saver';

function clampOpacity(value) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return null;
  return Math.min(1, Math.max(MIN_OPACITY, opacity));
}

function visibleArea(bounds, area) {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return width > 0 && height > 0 ? { width, height } : null;
}

// 保存済みの位置がどのモニターにも十分に重なっていなければ、主モニターの中に収め直す
function fitBoundsToDisplays(saved, { displays = [], primary } = {}) {
  const width = Math.max(MIN_WIDTH, Number(saved?.width) || DEFAULT_BOUNDS.width);
  const height = Math.max(MIN_HEIGHT, Number(saved?.height) || DEFAULT_BOUNDS.height);
  const x = Number(saved?.x);
  const y = Number(saved?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { width, height };

  const bounds = { x, y, width, height };
  const areas = displays.map(display => display.workArea).filter(Boolean);
  const isReachable = areas.some(area => {
    const visible = visibleArea(bounds, area);
    // ドラッグ用バーは上端にあるので、上端がモニター内に入っていることも条件にする
    return visible && visible.width >= Math.min(MIN_VISIBLE, width)
      && y >= area.y && y < area.y + area.height;
  });
  if (isReachable || areas.length === 0) return bounds;

  const area = primary?.workArea || areas[0];
  const fittedWidth = Math.min(width, area.width);
  const fittedHeight = Math.min(height, area.height);
  return {
    x: Math.round(area.x + (area.width - fittedWidth) / 2),
    y: Math.round(area.y + (area.height - fittedHeight) / 2),
    width: fittedWidth,
    height: fittedHeight,
  };
}

function createWidgetWindowController({
  BrowserWindow,
  screen,
  loadConfig,
  updateConfig,
  configureWindow = () => {},
  loadContents,
  isAppQuitting = () => false,
  isMainWindowOpen = () => true,
  webPreferences = {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let widgetWindow = null;
  let wantsTop = false;
  let saveTimer = null;
  let pendingPatch = {};

  function isOpen() {
    return Boolean(widgetWindow && !widgetWindow.isDestroyed());
  }

  function flushSave() {
    if (saveTimer) clearTimer(saveTimer);
    saveTimer = null;
    const patch = pendingPatch;
    pendingPatch = {};
    if (Object.keys(patch).length) updateConfig(patch);
  }

  // 移動・リサイズ・スライダー操作のたびに書き込まないようまとめて保存する
  function scheduleSave(patch) {
    pendingPatch = { ...pendingPatch, ...patch };
    if (saveTimer) clearTimer(saveTimer);
    saveTimer = setTimer(flushSave, SAVE_DELAY_MS);
  }

  function applyAlwaysOnTop(win, enabled) {
    if (enabled) {
      win.setAlwaysOnTop(true, TOP_LEVEL);
      win.moveTop?.();
    } else {
      win.setAlwaysOnTop(false);
    }
  }

  function applyLock(win, locked) {
    win.setMovable(!locked);
    win.setResizable(!locked);
  }

  function applyOpacity(win, config) {
    const opacity = clampOpacity(config.widgetOpacity) ?? 1;
    win.setOpacity(config.widgetBackgroundOnly ? 1 : opacity);
  }

  function open() {
    if (isOpen()) {
      widgetWindow.show();
      widgetWindow.focus();
      return widgetWindow;
    }
    const config = loadConfig();
    const bounds = fitBoundsToDisplays(config.widgetBounds, {
      displays: screen?.getAllDisplays?.() || [],
      primary: screen?.getPrimaryDisplay?.(),
    });
    const alwaysOnTop = config.widgetAlwaysOnTop === true;
    wantsTop = alwaysOnTop;
    const locked = config.widgetLocked === true;

    const win = new BrowserWindow({
      ...bounds,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      skipTaskbar: true,
      alwaysOnTop,
      movable: !locked,
      resizable: !locked,
      title: 'SocialDeck Widget',
      webPreferences,
      show: false,
    });
    widgetWindow = win;
    updateConfig({ widgetOpen: true });

    configureWindow(win);
    loadContents(win);

    win.once('ready-to-show', () => {
      applyOpacity(win, config);
      win.show();
      // コンストラクタの alwaysOnTop は非表示のまま作ると Windows で外れることがあるので表示後に掛け直す
      if (wantsTop) applyAlwaysOnTop(win, true);
    });

    // 他の最前面ウィンドウやフルスクリーンアプリに z-order を奪われたら取り戻す
    const reassertTop = () => {
      if (!win.isDestroyed() && wantsTop) applyAlwaysOnTop(win, true);
    };
    win.on('blur', reassertTop);
    win.on('show', reassertTop);
    win.on('restore', reassertTop);

    const saveBounds = () => {
      if (!win.isDestroyed()) scheduleSave({ widgetBounds: win.getBounds() });
    };
    win.on('move', saveBounds);
    win.on('resize', saveBounds);

    win.on('close', () => {
      if (win.isDestroyed()) return;
      pendingPatch = { ...pendingPatch, widgetBounds: win.getBounds() };
      // アプリ終了やメイン画面を閉じた後の終了は「開いたまま」として次回起動時に復元する
      if (!isAppQuitting() && isMainWindowOpen()) pendingPatch.widgetOpen = false;
      flushSave();
    });
    win.on('closed', () => {
      if (widgetWindow === win) widgetWindow = null;
    });
    return win;
  }

  function restoreOnLaunch() {
    if (loadConfig().widgetOpen === true) open();
  }

  function owns(win) {
    return Boolean(win && isOpen() && win === widgetWindow);
  }

  function getState() {
    const config = loadConfig();
    return {
      alwaysOnTop: isOpen() ? wantsTop : config.widgetAlwaysOnTop === true,
      locked: config.widgetLocked === true,
      opacity: clampOpacity(config.widgetOpacity) ?? 1,
      backgroundOnly: config.widgetBackgroundOnly === true,
    };
  }

  function toggleTop() {
    const next = !wantsTop;
    wantsTop = next;
    applyAlwaysOnTop(widgetWindow, next);
    updateConfig({ widgetAlwaysOnTop: next });
    return next;
  }

  function toggleLock() {
    const next = loadConfig().widgetLocked !== true;
    applyLock(widgetWindow, next);
    updateConfig({ widgetLocked: next });
    return next;
  }

  function setOpacity(value) {
    const opacity = clampOpacity(value);
    if (opacity === null) return false;
    const config = { ...loadConfig(), ...pendingPatch, widgetOpacity: opacity };
    applyOpacity(widgetWindow, config);
    scheduleSave({ widgetOpacity: opacity });
    return true;
  }

  function setBackgroundOnly(enabled) {
    const next = enabled === true;
    flushSave();
    const config = { ...loadConfig(), widgetBackgroundOnly: next };
    applyOpacity(widgetWindow, config);
    updateConfig({ widgetBackgroundOnly: next });
    return next;
  }

  function close() {
    if (isOpen()) widgetWindow.close();
  }

  return {
    close,
    flushSave,
    getState,
    isOpen,
    open,
    owns,
    restoreOnLaunch,
    setBackgroundOnly,
    setOpacity,
    toggleLock,
    toggleTop,
    get window() { return isOpen() ? widgetWindow : null; },
  };
}

module.exports = { createWidgetWindowController, fitBoundsToDisplays, clampOpacity };
