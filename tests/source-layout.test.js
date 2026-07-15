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
