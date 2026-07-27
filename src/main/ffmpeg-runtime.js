const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const REENCODE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ERROR_LENGTH = 8_000;
// 画面録画は50Mbps級になることがあり、そのまま切り出すと数百MBになって
// 投稿経路がメモリを使い果たす。収まらない見込みのときだけ再エンコードする。
const MAX_TRIM_OUTPUT_BYTES = 60_000_000;
const MAX_TRIM_BITRATE_BPS = 8_000_000;

function resolveFfmpegPath({
  isPackaged = false,
  platform = process.platform,
  resourcesPath = process.resourcesPath,
  appRoot = path.resolve(__dirname, '..', '..'),
  env = process.env,
} = {}) {
  const override = String(env.SOCIALDECK_FFMPEG_PATH || '').trim();
  if (override) return path.resolve(override);
  if (platform !== 'win32') return 'ffmpeg';
  return isPackaged
    ? path.join(resourcesPath, 'ffmpeg', 'ffmpeg.exe')
    : path.join(appRoot, 'vendor', 'ffmpeg', 'win32-x64', 'ffmpeg.exe');
}

function formatSeconds(value) {
  return String(Math.round(Number(value) * 1000) / 1000);
}

// コピーしたときの推定サイズが予算を超える場合だけ、予算に収まるビットレートを返す
function planTrimEncoding({
  sourceBytes,
  sourceDurationSeconds,
  trimDurationSeconds,
  maxOutputBytes = MAX_TRIM_OUTPUT_BYTES,
  maxBitrateBps = MAX_TRIM_BITRATE_BPS,
} = {}) {
  const bytes = Number(sourceBytes);
  const sourceDuration = Number(sourceDurationSeconds);
  const trimDuration = Number(trimDurationSeconds);
  const measurable = [bytes, sourceDuration, trimDuration].every(Number.isFinite)
    && bytes > 0 && sourceDuration > 0 && trimDuration > 0;
  // 推定できないときは従来どおりコピーし、出力サイズの検査に委ねる
  if (!measurable) return { videoBitrateBps: null, estimatedBytes: null };

  const estimatedBytes = bytes * Math.min(1, trimDuration / sourceDuration);
  if (estimatedBytes <= maxOutputBytes) return { videoBitrateBps: null, estimatedBytes };

  const budgetBps = (maxOutputBytes * 8) / trimDuration;
  return {
    videoBitrateBps: Math.max(1, Math.floor(Math.min(maxBitrateBps, budgetBps))),
    estimatedBytes,
  };
}

function buildTrimArguments({
  inputPath,
  outputPath,
  startSeconds,
  durationSeconds,
  videoBitrateBps = null,
}) {
  const bitrate = Number(videoBitrateBps);
  const reencode = Number.isFinite(bitrate) && bitrate > 0;
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel', 'error',
    '-ss', formatSeconds(startSeconds),
    '-i', inputPath,
    '-t', formatSeconds(durationSeconds),
    '-map_metadata', '-1',
    ...(reencode
      ? [
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '23',
          '-maxrate', String(bitrate),
          '-bufsize', String(bitrate * 2),
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
        ]
      : ['-c', 'copy', '-avoid_negative_ts', 'make_zero']),
    '-movflags', '+faststart',
    '-y', outputPath,
  ];
}

function removePartialOutput(outputPath) {
  try {
    fs.rmSync(outputPath, { force: true });
  } catch {}
}

function runFfmpegTrim({
  ffmpegPath,
  inputPath,
  outputPath,
  startSeconds,
  durationSeconds,
  videoBitrateBps = null,
  timeoutMs = null,
  spawnImpl = spawn,
} = {}) {
  const args = buildTrimArguments({
    inputPath,
    outputPath,
    startSeconds,
    durationSeconds,
    videoBitrateBps,
  });
  // 再エンコードはコピーより時間がかかるため待ち時間を広げる
  const limitMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : videoBitrateBps ? REENCODE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let stderr = '';
    let timer = null;

    function finish(error) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) {
        removePartialOutput(outputPath);
        reject(error);
      } else {
        resolve(outputPath);
      }
    }

    try {
      child = spawnImpl(ffmpegPath, args, {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (error) {
      removePartialOutput(outputPath);
      reject(new Error(`Unable to start FFmpeg: ${error.message}`));
      return;
    }

    timer = setTimeout(() => {
      child.kill?.();
      finish(new Error('FFmpeg timed out'));
    }, limitMs);

    child.stderr?.on?.('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-MAX_ERROR_LENGTH);
    });
    child.once?.('error', error => finish(new Error(`Unable to start FFmpeg: ${error.message}`)));
    child.once?.('close', code => {
      if (code === 0) finish();
      else finish(new Error(`FFmpeg exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_TRIM_BITRATE_BPS,
  MAX_TRIM_OUTPUT_BYTES,
  REENCODE_TIMEOUT_MS,
  buildTrimArguments,
  planTrimEncoding,
  resolveFfmpegPath,
  runFfmpegTrim,
};
