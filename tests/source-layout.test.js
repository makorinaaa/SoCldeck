const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

// Keep repository boundaries here; module and Electron tests exercise behavior.
test('keeps one application entry under src', () => {
  assert.equal(fs.existsSync(path.join(root, 'renderer.js')), false);
  const index = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const scripts = [...index.matchAll(/<script\b([^>]*)src="([^"]+)"[^>]*>/g)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /type="module"/);
  assert.equal(fs.existsSync(path.join(root, 'src', scripts[0][2])), true);
});

test('keeps authenticated transport out of browser source', () => {
  const files = [path.join(root, 'src/renderer.js'),
    ...fs.readdirSync(path.join(root, 'src/renderer'))
      .filter(name => /\.m?js$/.test(name))
      .map(name => path.join(root, 'src/renderer', name))];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /Authorization\s*:\s*[`'"]Bearer/, file);
    assert.doesNotMatch(source, /https:\/\/bsky\.social\/xrpc/, file);
  }
});
