const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

test('tag builds cannot trigger electron-builder implicit publishing', () => {
  const pkg = require('../package.json');
  assert.match(pkg.scripts['build-win'], /--publish\s+never/);
});

test('the release workflow uploads every auto-update artifact explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, '.github', 'workflows', 'release.yml'),
    'utf8'
  );
  assert.match(workflow, /npm run build-win/);
  assert.match(workflow, /softprops\/action-gh-release@v2/);
  assert.match(workflow, /dist\/\*\.exe/);
  assert.match(workflow, /dist\/\*\.exe\.blockmap/);
  assert.match(workflow, /dist\/latest\.yml/);
});
