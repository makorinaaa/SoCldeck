const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

test('keeps the executable renderer implementation under src only', () => {
  assert.equal(fs.existsSync(path.join(projectRoot, 'renderer.js')), false);
  assert.equal(fs.existsSync(path.join(projectRoot, 'src', 'renderer.js')), true);
});

test('keeps authenticated Bluesky transport outside the renderer', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const adapterIndex = index.indexOf(
    '<script src="renderer/bluesky-gateway-adapter.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(adapterIndex, -1);
  assert.ok(adapterIndex < rendererIndex);
  assert.match(renderer, /SocialDeckBlueskyGatewayAdapter\.createBlueskyGatewayAdapter\(\{/);
  assert.doesNotMatch(renderer, /bsky\.social\/xrpc|accessJwt|refreshJwt|Authorization/);
  assert.equal(fs.existsSync(path.join(projectRoot, 'src', 'renderer', 'bsky-client.js')), false);
});

test('loads Mute Rules before the renderer entry point', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const muteRulesIndex = index.indexOf('<script src="renderer/mute-rules.js"></script>');
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(muteRulesIndex, -1);
  assert.notEqual(rendererIndex, -1);
  assert.ok(muteRulesIndex < rendererIndex);
});

test('loads the Bluesky Session Runtime before renderer', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const runtimeIndex = index.indexOf(
    '<script src="renderer/bluesky-session-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(runtimeIndex, -1);
  assert.ok(runtimeIndex < rendererIndex);
  assert.match(renderer, /SocialDeckBlueskySessionRuntime\.createBlueskySessionRuntime\(/);
  assert.match(renderer, /initializeBlueskySession\(\)/);
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
  const picker = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'column-picker.js'),
    'utf8',
  );
  assert.match(renderer, /SocialDeckAnimeScheduleRuntime\.createAnimeScheduleRuntime\(\{/);
  assert.match(renderer, /networkAdapters\.getColumnDefinitions\(networkId\)/);
  assert.match(picker, /getColumnDefinitions\('anime'\)/);
  assert.match(renderer, /mountAnimeScheduleColumn\(plan\.config\)/);
});

test('keeps common Column shell DOM behind Column Shell Runtime', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const runtimeIndex = index.indexOf(
    '<script src="renderer/column-shell-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(runtimeIndex, -1);
  assert.ok(runtimeIndex < rendererIndex);
  assert.match(renderer, /SocialDeckColumnShellRuntime\.createColumnShellRuntime\(\{/);
  for (const functionName of [
    'insertColumnRestoreError',
    'mountAnimeScheduleColumn',
    'mountBlueskyColumn',
    'mountWebViewColumn',
  ]) {
    const start = renderer.indexOf(`function ${functionName}`);
    const end = renderer.indexOf('\nfunction ', start + 1);
    const body = renderer.slice(start, end === -1 ? undefined : end);
    assert.notEqual(start, -1, `${functionName} must exist`);
    assert.match(body, /columnShellRuntime\.mount\(\{/);
  }
  assert.doesNotMatch(renderer, /function insert(?:AnimeSchedule|Bsky|WebView)Col\b/);
  const rendererWithoutWidgetStyles = renderer.replace(/ws\.textContent = `[\s\S]*?`;/, '');
  assert.doesNotMatch(
    rendererWithoutWidgetStyles,
    /(?:col-head|col-info|col-actions|col-refresh-state|col-collapse-btn|col-resize)/,
  );
  assert.doesNotMatch(renderer, /className\s*=\s*['"]col['"]/);
  assert.doesNotMatch(renderer, /\bcol\.style\.(?:width|minWidth)\b/);
  assert.doesNotMatch(renderer, /function (?:renderColumnRefreshState|toggleColCollapse)\b/);
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
  assert.doesNotMatch(
    renderer,
    /\b(?:hoverCardTimer|hoverCardHideTimer|hoverCardCache|hoverCardShow|hoverCardHide|_hoverCardRemove|_hoverCardRender|hoverCardToggleFollow|_hoverCardPosition)\b/,
  );
});

test('keeps Bluesky post view, reactions, and profile card behind their modules', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const runtime = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'bsky-columns-runtime.js'),
    'utf8',
  );
  const runtimeIndex = index.indexOf('<script src="renderer/bsky-columns-runtime.js"></script>');

  assert.notEqual(runtimeIndex, -1);
  for (const script of ['bsky-post-view.js', 'bsky-reactions.js', 'bsky-profile-card.js']) {
    const scriptIndex = index.indexOf(`<script src="renderer/${script}"></script>`);
    assert.notEqual(scriptIndex, -1, `${script} must be loaded`);
    assert.ok(scriptIndex < runtimeIndex, `${script} must load before bsky-columns-runtime.js`);
  }
  assert.match(runtime, /SocialDeckBlueskyPostView\?\.createBlueskyPostView/);
  assert.match(runtime, /SocialDeckBlueskyReactions\?\.createBlueskyReactions/);
  assert.match(runtime, /SocialDeckBlueskyProfileCard\?\.createBlueskyProfileCard/);
  assert.doesNotMatch(
    runtime,
    /function (?:renderPost|renderNotification|renderThreadReplies|collectThreadParents|getNotificationIdentity|toggleLike|toggleRepost|openRepostMenu|closeRepostMenu|syncReactionAcrossColumns|syncPostMetrics|reapplyPendingReactions|showProfileCard|positionProfileCard|toggleProfileFollow|removeProfileCard)\b/,
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
    /function (?:loadNotificationCenter|renderNotificationCenter|markNotificationCenterRead|scrollToNotifCol|goToNotifColAndRead|markBskyNotifsRead)\b/,
  );
});

test('keeps desktop notification rules and settings behind their Runtime', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(projectRoot, 'src', 'main.js'), 'utf8');
  const runtimeIndex = index.indexOf(
    '<script src="renderer/desktop-notification-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');
  const modal = index.slice(
    index.indexOf('<div class="ov" id="desktopNotifSettingsMod">'),
    index.indexOf('<!-- ABOUT MODAL -->'),
  );

  assert.notEqual(runtimeIndex, -1);
  assert.ok(runtimeIndex < rendererIndex);
  assert.match(
    renderer,
    /SocialDeckDesktopNotificationRuntime\.createDesktopNotificationRuntime\(\{/,
  );
  assert.match(main, /createDesktopNotificationService\(\{/);
  assert.match(
    renderer,
    /retainReader: desktopNotificationRuntime\?\.getSnapshot\(\)\.rules\.enabled === true/,
  );
  assert.match(renderer, /if \(!rules\.enabled\) xWebViewRuntime\.disposeNotificationReaders\(\)/);
  assert.doesNotMatch(modal, /\son(?:click|change|input)=/i);
  assert.doesNotMatch(
    renderer,
    /function (?:matchesDesktopNotificationRules|pollDesktopNotifications|renderDesktopNotificationSettings)\b/,
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

test('keeps Compose modal presentation and events behind its Runtime', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const runtimeIndex = index.indexOf(
    '<script src="renderer/compose-modal-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');
  const xModal = index.slice(index.indexOf('<div class="ov" id="xPostMod">'), index.indexOf('<div class="ov" id="addMod"'));
  const bModal = index.slice(index.indexOf('<div class="ov" id="compMod">'), index.indexOf('<div id="lightbox"'));

  assert.notEqual(runtimeIndex, -1);
  assert.ok(runtimeIndex < rendererIndex);
  assert.match(renderer, /SocialDeckComposeModalRuntime\.createComposeModalRuntime\(\{/);
  assert.doesNotMatch(`${xModal}${bModal}`, /\son(?:click|input|change|drop|dragover|dragleave)=/i);
  assert.doesNotMatch(
    renderer,
    /function (?:renderXImgPreviews|renderBImgPreviews|updateXCrossPostControls|updateCrossPostControls|updXCC|updCC)\b/,
  );
  const crossPostPlanIndex = index.indexOf(
    '<script src="renderer/compose-cross-post-plan.js"></script>',
  );
  assert.notEqual(crossPostPlanIndex, -1);
  assert.ok(crossPostPlanIndex < rendererIndex);
  assert.match(renderer, /SocialDeckComposeCrossPostPlan/);
});

test('keeps settings modal presentation behind Settings Modals Runtime', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const runtimeIndex = index.indexOf(
    '<script src="renderer/settings-modals-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(runtimeIndex, -1);
  assert.ok(runtimeIndex < rendererIndex);
  assert.match(renderer, /SocialDeckSettingsModalsRuntime\.createSettingsModalsRuntime\(\{/);
  assert.match(renderer, /settingsModals\.openColumnSettings\(/);
  assert.doesNotMatch(
    renderer,
    /function (?:openNgSettings|addNg|removeNg|openColSettings|applyInterval|applyColFontSize|openMemSettings|applyMemInterval|renderMemoryMetrics|refreshMemoryMetrics|runMemoryClear|formatMemoryMb|getMemInterval|syncAppearanceSettings|openAppearanceSettings|previewAppearance|cancelAppearance|saveAppearance)\b/,
  );
  assert.doesNotMatch(renderer, /ng-modal-ov|col-settings-ov|mem-settings-ov/);
});

test('keeps mention suggestions, the Column picker, and widget mode behind their modules', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  for (const script of ['compose-mention-suggest.js', 'column-picker.js', 'widget-mode-runtime.js']) {
    const scriptIndex = index.indexOf(`<script src="renderer/${script}"></script>`);
    assert.notEqual(scriptIndex, -1, `${script} must be loaded`);
    assert.ok(scriptIndex < rendererIndex, `${script} must load before renderer.js`);
  }
  assert.match(renderer, /SocialDeckComposeMentionSuggest\.createComposeMentionSuggest\(\{/);
  assert.match(renderer, /SocialDeckColumnPicker\.createColumnPicker\(\{/);
  assert.match(renderer, /SocialDeckWidgetModeRuntime\.createWidgetModeRuntime\(\{/);
  assert.doesNotMatch(
    renderer,
    /function (?:onCompTextareaInput|insertMention|buildOptGrid|mkOptX|mkOpt|nextColumnId|addColFromModal|openAddMod|initWidgetMode|wgToggleTop|wgSelectCol)\b/,
  );
  assert.doesNotMatch(renderer, /mention-suggest|opt-grid|widget-bar/);
});

test('keeps Compose submission orchestration behind Compose Submission', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const submissionIndex = index.indexOf(
    '<script src="renderer/compose-submission.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(submissionIndex, -1);
  assert.ok(submissionIndex < rendererIndex);
  assert.match(renderer, /SocialDeckComposeSubmission\.createComposeSubmission\(\{/);
  assert.match(renderer, /composeSubmission\.submit\(/);
  assert.doesNotMatch(
    renderer,
    /function (?:doXPost|doSend|doXOriginCrossPost|doCrossPost|submitSharedCrossPost|createSharedCrossPostPlan|validateCrossPostVideo|describeCrossPostFailure)\b/,
  );
  assert.doesNotMatch(renderer, /submitSingle\(|submitCrossPost\(/);
});

test('keeps Account Session lifecycle and presentation behind its Runtime', () => {
  const renderer = fs.readFileSync(path.join(projectRoot, 'src', 'renderer.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src', 'index.html'), 'utf8');
  const runtimeIndex = index.indexOf(
    '<script src="renderer/account-session-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');
  const loginScreen = index.slice(
    index.indexOf('<div id="login-screen">'),
    index.indexOf('<div id="app"'),
  );

  assert.notEqual(runtimeIndex, -1);
  assert.ok(runtimeIndex < rendererIndex);
  assert.match(renderer, /SocialDeckAccountSessionRuntime\.createAccountSessionRuntime\(\{/);
  assert.doesNotMatch(
    renderer,
    /function (?:updateLoginUI|loginX|loginBluesky|logoutBluesky|logoutAll|removeXAccount|renderNavChips|renderSbAvatars)\b/,
  );
  assert.doesNotMatch(
    loginScreen,
    /onclick="(?:loginX|loginBluesky|logoutBluesky|enterApp)\(/,
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
