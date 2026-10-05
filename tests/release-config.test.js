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
  assert.match(workflow, /softprops\/action-gh-release@[0-9a-f]{40} # v2/);
  assert.match(workflow, /dist\/\*\.exe/);
  assert.match(workflow, /dist\/\*\.exe\.blockmap/);
  assert.match(workflow, /dist\/latest\.yml/);
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /name: Generate release notes/);
  assert.match(workflow, /git log/);
  assert.match(workflow, /body_path:\s*release-notes\.md/);
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

  assert.match(workflow, /actions\/checkout@[0-9a-f]{40} # v6/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40} # v6/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40} # v6/);
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
      < workflow.indexOf('softprops/action-gh-release@')
  );
});

test('packaged builds disable Node.js entry points and only load the integrity-checked app.asar', () => {
  const { build } = require('../package.json');
  assert.equal(build.asar, true);
  assert.deepEqual(build.electronFuses, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
    enableCookieEncryption: true,
  });
});

test('only the publish job can write the release, and it never installs dependencies', () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, '.github', 'workflows', 'release.yml'),
    'utf8'
  );
  const publishIndex = workflow.indexOf('\n  publish-release:');
  assert.ok(publishIndex > 0);
  const buildJob = workflow.slice(0, publishIndex);
  const publishJob = workflow.slice(publishIndex);

  assert.match(buildJob, /^permissions:\s*\n\s*contents:\s*read/m);
  assert.doesNotMatch(buildJob, /contents:\s*write/);
  assert.match(publishJob, /needs:\s*build-windows/);
  assert.match(publishJob, /contents:\s*write/);
  assert.doesNotMatch(publishJob, /npm|setup-node/);
});

test('workflows pin every action to a full commit SHA', () => {
  for (const name of ['ci.yml', 'release.yml']) {
    const workflow = fs.readFileSync(path.join(projectRoot, '.github', 'workflows', name), 'utf8');
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map(match => match[1]);
    assert.ok(uses.length > 0);
    for (const action of uses) assert.match(action, /@[0-9a-f]{40}$/, `${name}: ${action}`);
  }
});
