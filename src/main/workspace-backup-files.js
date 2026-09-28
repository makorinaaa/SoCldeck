const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const MAX_BYTES = 1024 * 1024;

function createWorkspaceBackupFiles({ dialog, fsImpl = fs }) {
  return {
    async save(text) {
      if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('バックアップは1MB以内にしてください');
      const result = await dialog.showSaveDialog({
        title: 'バックアップを書き出す', defaultPath: `SocialDeck-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'SocialDeck バックアップ', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return false;
      const temporary = `${result.filePath}.${randomUUID()}.tmp`;
      try {
        await fsImpl.writeFile(temporary, text, 'utf8');
        await fsImpl.rename(temporary, result.filePath);
      } finally {
        await fsImpl.unlink(temporary).catch(() => {});
      }
      return true;
    },
    async open() {
      const result = await dialog.showOpenDialog({
        title: 'バックアップを選択', properties: ['openFile'],
        filters: [{ name: 'SocialDeck バックアップ', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePaths?.[0]) return null;
      const path = result.filePaths[0];
      if ((await fsImpl.stat(path)).size > MAX_BYTES) throw new Error('バックアップは1MB以内にしてください');
      const text = await fsImpl.readFile(path, 'utf8');
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('バックアップは1MB以内にしてください');
      return text;
    },
  };
}
module.exports = { createWorkspaceBackupFiles };
