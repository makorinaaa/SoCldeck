const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  buildTrimArguments,
  resolveFfmpegPath,
  runFfmpegTrim,
} = require('../src/main/ffmpeg-runtime');

function createChild() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

test('resolves the verified bundled Windows binary and supports an explicit override', () => {
  assert.equal(
    resolveFfmpegPath({
      platform: 'win32',
      isPackaged: true,
      resourcesPath: 'C:\\SocialDeck\\resources',
      env: {},
    }),
    path.join('C:\\SocialDeck\\resources', 'ffmpeg', 'ffmpeg.exe'),
  );
  assert.equal(
    resolveFfmpegPath({ platform: 'linux', env: { SOCIALDECK_FFMPEG_PATH: '/opt/ffmpeg-safe' } }),
    path.resolve('/opt/ffmpeg-safe'),
  );
});

test('builds a fixed FFmpeg argument vector without invoking a shell', async () => {
  const calls = [];
  const outputPath = path.join(os.tmpdir(), 'socialdeck-ffmpeg-success.mp4');
  const result = await runFfmpegTrim({
    ffmpegPath: 'ffmpeg-safe',
    inputPath: 'C:\\Media\\clip.mp4',
    outputPath,
    startSeconds: 2,
    durationSeconds: 10,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = createChild();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  assert.equal(result, outputPath);
  assert.equal(calls[0].command, 'ffmpeg-safe');
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].args, buildTrimArguments({
    inputPath: 'C:\\Media\\clip.mp4',
    outputPath,
    startSeconds: 2,
    durationSeconds: 10,
  }));
  assert.ok(calls[0].args.includes('-nostdin'));
  assert.ok(calls[0].args.includes('-map_metadata'));
});

test('removes a partial output and reports bounded FFmpeg failures', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'socialdeck-ffmpeg-test-'));
  const outputPath = path.join(directory, 'partial.mp4');
  fs.writeFileSync(outputPath, 'partial');

  await assert.rejects(
    runFfmpegTrim({
      ffmpegPath: 'ffmpeg-safe',
      inputPath: 'input.mp4',
      outputPath,
      startSeconds: 0,
      durationSeconds: 1,
      spawnImpl() {
        const child = createChild();
        queueMicrotask(() => {
          child.stderr.emit('data', 'invalid media');
          child.emit('close', 1);
        });
        return child;
      },
    }),
    /FFmpeg exited with code 1: invalid media/,
  );
  assert.equal(fs.existsSync(outputPath), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('terminates an FFmpeg process that exceeds the trim deadline', async () => {
  let killed = false;
  await assert.rejects(
    runFfmpegTrim({
      ffmpegPath: 'ffmpeg-safe',
      inputPath: 'input.mp4',
      outputPath: path.join(os.tmpdir(), 'socialdeck-ffmpeg-timeout.mp4'),
      startSeconds: 0,
      durationSeconds: 1,
      timeoutMs: 1,
      spawnImpl() {
        const child = createChild();
        child.kill = () => { killed = true; };
        return child;
      },
    }),
    /FFmpeg timed out/,
  );
  assert.equal(killed, true);
});
