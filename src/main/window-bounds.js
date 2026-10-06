// 保存したウィンドウ位置は、今つながっている画面に上端が見える場合だけ使う。
// 外したモニター上の位置や、最小化中に保存された位置では画面外に開いてしまうため。
// フレームレスのウィンドウは上端のバーでしか動かせないので、上端の帯で判定する。
const TITLE_STRIP_HEIGHT = 32;
const MIN_VISIBLE_WIDTH = 120;

function positiveSize(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function showsTitleStrip(bounds, area) {
  const left = Math.max(bounds.x, area.x);
  const right = Math.min(bounds.x + bounds.width, area.x + area.width);
  const top = Math.max(bounds.y, area.y);
  const bottom = Math.min(bounds.y + TITLE_STRIP_HEIGHT, area.y + area.height);
  return right - left >= MIN_VISIBLE_WIDTH && bottom - top >= TITLE_STRIP_HEIGHT / 2;
}

// x / y を返さないときは Electron が主画面の中央に置く。
function resolveWindowBounds(saved, { defaults, displays = [] }) {
  const bounds = {
    width: positiveSize(saved?.width) ?? defaults.width,
    height: positiveSize(saved?.height) ?? defaults.height,
  };
  if (!Number.isFinite(saved?.x) || !Number.isFinite(saved?.y)) return bounds;
  const placed = { ...bounds, x: Math.round(saved.x), y: Math.round(saved.y) };
  return displays.some(area => showsTitleStrip(placed, area)) ? placed : bounds;
}

module.exports = { resolveWindowBounds };
