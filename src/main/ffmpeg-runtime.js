const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_ERROR_LENGTH = 8_000;

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

function buildTrimArguments({ inputPath, outputPath, startSeconds, durationSeconds }) {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel', 'error',
    '-ss', formatSeconds(startSeconds),
    '-i', inputPath,
    '-t', formatSeconds(durationSeconds),
    '-map_metadata', '-1',
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
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
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn,
} = {}) {
  const args = buildTrimArguments({ inputPath, outputPath, startSeconds, durationSeconds });
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
    }, timeoutMs);

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
  buildTrimArguments,
  resolveFfmpegPath,
  runFfmpegTrim,
};
