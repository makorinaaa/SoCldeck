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
