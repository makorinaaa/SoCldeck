const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { resolveFfmpegPath, runFfmpegTrim } = require('./ffmpeg-runtime');

const MAX_VIDEO_BYTES = 100_000_000;
const MAX_VIDEO_SECONDS = 180;

function createBlueskyVideoFileService({
  exists = fs.existsSync,
  getSize = async filePath => (await fs.promises.stat(filePath)).size,
  readFile = filePath => fs.promises.readFile(filePath),
  removeFile = filePath => fs.promises.rm(filePath, { force: true }),
  makeTempPath = () => path.join(os.tmpdir(), `socialdeck_bsky_video_${randomUUID()}.mp4`),
  runTrim = runFfmpegTrim,
  resolveFfmpeg = resolveFfmpegPath,
  isPackaged = false,
} = {}) {
  async function prepare(input = {}) {
    const inputPath = path.resolve(String(input.filePath || ''));
    if (path.extname(inputPath).toLowerCase() !== '.mp4') {
      throw new Error('Bluesky video must be an MP4 file');
    }
    if (!exists(inputPath)) throw new Error('Bluesky video file was not found');

    const startSeconds = Number(input.startSeconds);
    const endSeconds = Number(input.endSeconds);
    const durationSeconds = Number(input.durationSeconds);
    const trimDuration = endSeconds - startSeconds;
    if (![startSeconds, endSeconds, durationSeconds].every(Number.isFinite)
      || startSeconds < 0 || endSeconds > durationSeconds || trimDuration <= 0) {
      throw new Error('Invalid Bluesky video trim range');
    }
    if (trimDuration > MAX_VIDEO_SECONDS) {
      throw new Error('Bluesky video must be 180 seconds or shorter');
    }

    const shouldTrim = startSeconds > 0.001 || endSeconds < durationSeconds - 0.001;
    const outputPath = shouldTrim ? makeTempPath() : inputPath;
    try {
      if (shouldTrim) {
        await runTrim({
          ffmpegPath: resolveFfmpeg({ isPackaged }),
          inputPath,
          outputPath,
          startSeconds,
          durationSeconds: trimDuration,
        });
      }
      const size = await getSize(outputPath);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
        throw new Error('Bluesky video must be 100 MB or smaller');
      }
      const bytes = await readFile(outputPath);
      if (!bytes?.length || bytes.length > MAX_VIDEO_BYTES) {
        throw new Error('Bluesky video could not be read safely');
      }
      return { name: path.basename(String(input.name || 'video.mp4')), bytes };
    } finally {
      if (shouldTrim) await removeFile(outputPath).catch(() => {});
    }
  }

  return { prepare };
}

module.exports = {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  createBlueskyVideoFileService,
};
