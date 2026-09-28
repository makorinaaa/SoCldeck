const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceBackupFiles } = require('../src/main/workspace-backup-files');

test('cancelled backup dialogs perform no file operations', async () => {
  const files = createWorkspaceBackupFiles({ dialog: {
    showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }),
  }, fsImpl: {} });
  assert.equal(await files.save('{}'), false);
  assert.equal(await files.open(), null);
});

test('oversized import is rejected before reading the file', async () => {
  const files = createWorkspaceBackupFiles({ dialog: { showOpenDialog: async () => ({ filePaths: ['backup.json'] }) },
    fsImpl: { stat: async () => ({ size: 2 * 1024 * 1024 }) } });
  await assert.rejects(files.open(), /1MB/);
});

test('failed backup writes do not replace the destination and remove the temporary file', async () => {
  const removed = [];
  const files = createWorkspaceBackupFiles({ dialog: { showSaveDialog: async () => ({ filePath: 'backup.json' }) },
    fsImpl: { writeFile: async () => { throw new Error('Full'); }, unlink: async file => removed.push(file) } });
  await assert.rejects(files.save('{}'), /Full/);
  assert.match(removed[0], /^backup\.json\..*\.tmp$/);
});
