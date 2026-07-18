const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'ci.yml',
);

test('unit CI protects pull requests and main pushes', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /pull_request:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.doesNotMatch(workflow, /tags:/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
});

test('unit CI installs the lockfile and runs only the fast test suite', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /cache:\s*npm/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npm\.cmd test/);
  assert.doesNotMatch(workflow, /test:e2e|build-win|electron-builder/);
});
