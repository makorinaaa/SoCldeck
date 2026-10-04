const fs = require('fs');
const path = require('path');

// Main プロセスだけが扱うウィンドウ設定。Renderer からは読み書きさせない。
function createAppConfigStore({ filePath, fileSystem = fs, logger = console } = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Config file path is required');

  function preserveCorruptFile() {
    try {
      fileSystem.renameSync(filePath, `${filePath}.corrupt`);
    } catch (error) {
      logger?.warn?.('[Config] 破損した設定ファイルを退避できませんでした:', error.message);
    }
  }

  function load() {
    let text;
    try {
      text = fileSystem.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') logger?.warn?.('[Config] 読み込みに失敗しました:', error.message);
      return {};
    }
    try {
      const value = JSON.parse(text);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {}
    logger?.warn?.('[Config] 設定ファイルが壊れているため既定値で起動します');
    preserveCorruptFile();
    return {};
  }

  function save(data) {
    const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
    try {
      fileSystem.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fileSystem.renameSync(tempPath, filePath);
      return true;
    } catch (error) {
      logger?.warn?.('[Config] 保存に失敗しました:', error.message);
      try { fileSystem.rmSync(tempPath, { force: true }); } catch {}
      return false;
    }
  }

  function update(patch) {
    return save({ ...load(), ...patch });
  }

  return { load, save, update };
}

module.exports = { createAppConfigStore };
