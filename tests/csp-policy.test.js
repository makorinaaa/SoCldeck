const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('enforces a renderer CSP without executable inline code or wildcard connections', () => {
  const index = read('src/index.html');
  const policy = index.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';

  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /connect-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'none'/);
  assert.doesNotMatch(policy, /unsafe-eval/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(policy, /connect-src[^;]*\*/);
});

test('keeps executable event attributes out of application markup and templates', () => {
  const sources = [
    read('src/index.html'),
    read('src/renderer.js'),
    ...fs.readdirSync(path.join(root, 'src', 'renderer'))
      .filter(name => name.endsWith('.js'))
      .map(name => read(path.join('src', 'renderer', name))),
  ].join('\n');

  assert.doesNotMatch(
    sources,
    /\son(?:click|input|change|dblclick|keydown|mouseenter|mouseleave|error)\s*=/i,
  );
  assert.doesNotMatch(sources, /\beval\s*\(|\bnew\s+Function\b/);
});

test('loads delegated actions before renderer and blocks production DevTools', () => {
  const index = read('src/index.html');
  const main = read('src/main.js');
  const preload = read('src/preload.js');
  const delegatedIndex = index.indexOf(
    '<script src="renderer/delegated-action-runtime.js"></script>',
  );
  const rendererIndex = index.indexOf('<script src="renderer.js"></script>');

  assert.notEqual(delegatedIndex, -1);
  assert.ok(delegatedIndex < rendererIndex);
  assert.match(main, /if \(!isDevelopment\) return false;/);
  assert.match(preload, /devToolsEnabled: isDevelopment/);
  assert.doesNotMatch(main, /lower === 'content-security-policy'/);
});
