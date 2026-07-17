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

test('the release workflow validates its tag before running isolated test phases', () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, '.github', 'workflows', 'release.yml'),
    'utf8'
  );

  assert.match(workflow, /name: Validate release tag/);
  assert.match(workflow, /github\.ref_name/);
  assert.match(workflow, /require\(['"]\.\/package\.json['"]\)\.version/);
  assert.match(workflow, /name: Run unit tests/);
  assert.match(workflow, /npm\.cmd test/);
  assert.match(workflow, /name: Run Electron E2E tests/);
  assert.match(workflow, /npm\.cmd run test:e2e/);
  assert.doesNotMatch(workflow, /npm run test:all/);

  const validationIndex = workflow.indexOf('name: Validate release tag');
  const unitIndex = workflow.indexOf('name: Run unit tests');
  const e2eIndex = workflow.indexOf('name: Run Electron E2E tests');
  const buildIndex = workflow.indexOf('name: Build Windows release');
  assert.ok(validationIndex < unitIndex);
  assert.ok(unitIndex < e2eIndex);
  assert.ok(e2eIndex < buildIndex);
});

test('the release workflow preserves diagnostics and bounds E2E retries', () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, '.github', 'workflows', 'release.yml'),
    'utf8'
  );

  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /actions\/upload-artifact@v6/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /test-results/);
  assert.match(workflow, /e2e-attempt-\$attempt\.log/);
  assert.match(workflow, /\$maxAttempts = 2/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /Get-Content -LiteralPath \$logPath -Tail 80/);
  assert.match(workflow, /retention-days: 14/);
});

test('the release workflow verifies generated updater files before publishing', () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, '.github', 'workflows', 'release.yml'),
    'utf8'
  );

  assert.match(workflow, /name: Verify release artifacts/);
  assert.match(workflow, /SocialDeck-\$packageVersion-x64\.exe/);
  assert.match(workflow, /latest\.yml/);
  assert.match(workflow, /\.exe\.blockmap/);
  assert.ok(
    workflow.indexOf('name: Verify release artifacts')
      < workflow.indexOf('softprops/action-gh-release@v2')
  );
});
