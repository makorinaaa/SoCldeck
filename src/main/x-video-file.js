const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MAX_TRIM_OUTPUT_BYTES, planTrimEncoding, resolveFfmpegPath, runFfmpegTrim } = require('./ffmpeg-runtime');
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);

function isSocialDeckTempFile(filePath) {
  if (typeof filePath !== 'string') return false;
  const resolved = path.resolve(filePath);
  const tmpRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tmpRoot, resolved);
  return relative &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    path.basename(resolved).startsWith('socialdeck_trim_');
}

function createXVideoFileService({
  isPackaged = false,
  exists = fs.existsSync,
  stat = filePath => fs.promises.stat(filePath),
  readFile = filePath => fs.promises.readFile(filePath),
  removeFile = filePath => fs.promises.rm(filePath, { force: true }),
  unlinkFile = fs.unlinkSync,
  makeTempPath = ext => path.join(os.tmpdir(), `socialdeck_trim_${randomUUID()}${ext}`),
  resolveFfmpeg = resolveFfmpegPath,
  runTrim = runFfmpegTrim,
} = {}) {
  async function trim({ filePath, startSec, endSec, durationSec }) {
    if (typeof filePath !== 'string') throw new Error('Invalid video file');
    const inputPath = path.resolve(filePath);
    const ext = path.extname(inputPath).toLowerCase() || '.mp4';
    if (!VIDEO_EXTENSIONS.has(ext)) throw new Error('Unsupported video format');
    if (!exists(inputPath)) throw new Error('Video file not found');

    const start = Number(startSec);
    const end = Number(endSec);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) {
      throw new Error('Invalid trim range');
    }
    const duration = end - start;
    if (duration <= 0) throw new Error('トリム範囲が不正です');
    if (duration > 140) throw new Error('動画が2分20秒を超えています');

    const outPath = makeTempPath(ext);

    // 高ビットレート素材はコピーすると数百MBになり投稿経路が破綻するため再エンコードする
    const { size: sourceBytes } = await stat(inputPath);
    const { videoBitrateBps } = planTrimEncoding({
      sourceBytes,
      sourceDurationSeconds: durationSec,
      trimDurationSeconds: duration,
    });

    const ffmpegPath = resolveFfmpeg({ isPackaged });
    await runTrim({
      ffmpegPath,
      inputPath,
      outputPath: outPath,
      startSeconds: start,
      durationSeconds: duration,
      videoBitrateBps,
    });

    const { size: trimmedBytes } = await stat(outPath);
    if (trimmedBytes > MAX_TRIM_OUTPUT_BYTES * 2) {
      await removeFile(outPath).catch(() => {});
      throw new Error('トリム後の動画が大きすぎます。範囲を短くしてください');
    }
    return outPath;
  }

  function remove(filePath) {
    try {
      if (isSocialDeckTempFile(filePath)) unlinkFile(path.resolve(filePath));
      return true;
    } catch { return false; }
  }

  async function readDataUrl(filePath) {
    try {
      if (!isSocialDeckTempFile(filePath)) throw new Error('Invalid temp file');
      const resolved = path.resolve(filePath);
      const ext = path.extname(resolved).slice(1).toLowerCase() || 'mp4';
      if (!VIDEO_EXTENSIONS.has(`.${ext}`)) throw new Error('Unsupported video format');
      // 同期読み込みはメインプロセスを止めてアプリ全体を固まらせるため非同期にする
      const { size } = await stat(resolved);
      if (size > MAX_TRIM_OUTPUT_BYTES * 2) {
        throw new Error('動画が大きすぎます。トリム範囲を短くしてください');
      }
      const data = await readFile(resolved);
      const mime = ext === 'mp4' ? 'video/mp4' : `video/${ext}`;
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch (e) {
      throw new Error('ファイル読み込みエラー: ' + e.message);
    }
  }

  return { trim, remove, readDataUrl };
}

module.exports = { createXVideoFileService };
