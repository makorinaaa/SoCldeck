const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

test('keeps the executable renderer implementation under src only', () => {
  assert.equal(fs.existsSync(path.join(projectRoot, 'renderer.js')), false);
  assert.equal(fs.existsSync(path.join(projectRoot, 'src', 'renderer.js')), true);
});

test('uses the Bluesky client module without a shadow implementation', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  assert.match(renderer, /SocialDeckBskyClient\.createBskyClient\(\)/);
  assert.doesNotMatch(renderer, /\blegacyBsky\b/);
});

test('loads Mute Rules before the renderer entry point', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const muteRulesIndex = index.indexOf('<script src="renderer/mute-rules.js"></script>');
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(muteRulesIndex, -1);
  assert.notEqual(rendererIndex, -1);
  assert.ok(muteRulesIndex < rendererIndex);
});

test('loads the X WebView Runtime before renderer and keeps X ownership behind it', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const runtimeIndex = index.indexOf(
    '<script src="renderer/x-webview-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(runtimeIndex, -1);
  assert.ok(runtimeIndex < rendererIndex);
  assert.match(renderer, /SocialDeckXWebViewRuntime\.createXWebViewRuntime\(\{/);
  assert.match(renderer, /xWebViewRuntime\.mountColumn\(\{/);
  assert.match(renderer, /xWebViewRuntime\.executeCompose\(/);
  assert.match(renderer, /xWebViewRuntime\.listNotifications\(\{/);
  assert.match(renderer, /xWebViewRuntime\.openNotificationTarget\(\{/);
  assert.match(renderer, /columnLifecycle\.refreshAll\(\{ force: true \}\)/);
  assert.match(renderer, /columnLifecycle\.clear\(\{ removeElements: true \}\)/);
  assert.doesNotMatch(renderer, /document\.createElement\(\s*['"]webview['"]\s*\)/);
  assert.doesNotMatch(renderer, /<webview\b/i);
  assert.doesNotMatch(renderer, /querySelector\(\s*['"]webview['"]\s*\)/);
  assert.doesNotMatch(renderer, /getElementById\(\s*`wv-\$\{/);
  assert.doesNotMatch(renderer, /\b(?:xPostingNow|wvReloadQueue|wvSilentReloading)\b/);
  assert.doesNotMatch(
    renderer,
    /\b(?:getXNotificationReader|waitForXNotificationReader|waitForXColumnWebViewReady)\b/,
  );
  assert.doesNotMatch(renderer, /\bX_[A-Z_]+_SCRIPT\b/);
  assert.doesNotMatch(
    renderer,
    /querySelectorAll\(['"]webview['"]\)\.forEach\([^)]*\.reload\(/,
  );
});

test('loads the Anime Schedule Runtime before renderer', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const runtimeIndex = index.indexOf(
    '<script src="renderer/anime-schedule-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(runtimeIndex, -1);
  assert.ok(runtimeIndex < rendererIndex);
  assert.match(renderer, /SocialDeckAnimeScheduleRuntime\.createAnimeScheduleRuntime\(\{/);
  assert.match(renderer, /networkAdapters\.getColumnDefinitions\('anime'\)/);
  assert.match(renderer, /insertAnimeScheduleCol\(plan\.config\)/);
});

test('keeps API-backed Bluesky Columns behind their Runtime', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const runtimeIndex = index.indexOf(
    '<script src="renderer/bsky-columns-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(runtimeIndex, -1);
  assert.ok(runtimeIndex < rendererIndex);
  assert.match(renderer, /SocialDeckBlueskyColumnsRuntime\.createBlueskyColumnsRuntime\(\{/);
  assert.match(renderer, /bskyColumnsRuntime\.mount\(\{/);
  assert.match(renderer, /bskyColumnsRuntime\.refresh\(/);
  assert.doesNotMatch(
    renderer,
    /\b(?:colCursors|renderBskyPost|renderBskyNotif|doSearch|toggleLike|toggleRepost|showRtMenu|openBskyPost)\b/,
  );
});

test('keeps Notification Center state and rendering behind its Runtime', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const runtimeIndex = index.indexOf(
    '<script src="renderer/notification-center-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(runtimeIndex, -1);
  assert.ok(runtimeIndex < rendererIndex);
  assert.match(
    renderer,
    /SocialDeckNotificationCenterRuntime\.createNotificationCenterRuntime\(/,
  );
  assert.doesNotMatch(
    renderer,
    /\b(?:notificationCenterItems|xNotificationCenterItems|visibleNotificationCenterItems|xNotificationCenterErrors)\b/,
  );
  assert.doesNotMatch(
    renderer,
    /function (?:loadNotificationCenter|renderNotificationCenter|markNotificationCenterRead)\b/,
  );
});

test('keeps Compose Experience media Runtime State out of renderer globals', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');

  assert.match(renderer, /composeMedia\.createMediaDraft\(/);
  assert.doesNotMatch(
    renderer,
    /\blet (?:xImgFiles|xImgAlts|xVideoFile|xVideoPath|xTrimIn|xTrimOut|bImgFiles|bImgAlts)\b/,
  );
});

test('keeps network-specific Compose delivery behind Network Adapters', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.doesNotMatch(renderer, /function _deliver(?:X|Bsky)Post/);
  assert.match(renderer, /networkAdapters\.executeComposeDelivery\(/);
  for (const script of ['x-compose-delivery.js', 'bsky-compose-delivery.js']) {
    const scriptIndex = index.indexOf(`<script src="renderer/${script}"></script>`);
    assert.notEqual(scriptIndex, -1);
    assert.ok(scriptIndex < rendererIndex);
  }
});

test('keeps Compose orchestration behind the Compose Coordinator', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const coordinatorIndex = index.indexOf(
    '<script src="renderer/compose-coordinator.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(coordinatorIndex, -1);
  assert.ok(coordinatorIndex < rendererIndex);
  assert.match(
    renderer,
    /SocialDeckComposeCoordinator\.createComposeCoordinator\(/,
  );
  assert.doesNotMatch(
    renderer,
    /const (?:xComposeAttempt|bskyComposeAttempt|crossPostRuntime)\b/,
  );
});
