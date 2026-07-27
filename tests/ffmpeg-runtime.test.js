const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  buildTrimArguments,
  planTrimEncoding,
  resolveFfmpegPath,
  runFfmpegTrim,
} = require('../src/main/ffmpeg-runtime');

// 1080p60 の画面録画 (50 Mbps, 4分55秒, 1.85 GB)
const HIGH_BITRATE_SOURCE = { sourceBytes: 1_849_604_376, sourceDurationSeconds: 295.55 };

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

test('copies without re-encoding while the trimmed output stays within budget', () => {
  // 8 Mbps 素材から20秒 = 20 MB。予算内なのでコピーのまま
  const plan = planTrimEncoding({
    sourceBytes: 300_000_000,
    sourceDurationSeconds: 300,
    trimDurationSeconds: 20,
  });

  assert.equal(plan.videoBitrateBps, null);
  const args = buildTrimArguments({
    inputPath: 'in.mp4',
    outputPath: 'out.mp4',
    startSeconds: 0,
    durationSeconds: 20,
    videoBitrateBps: plan.videoBitrateBps,
  });
  assert.ok(args.includes('-c') && args.includes('copy'));
  assert.equal(args.includes('libx264'), false);
});

test('re-encodes a high bitrate screen recording down to a usable size', () => {
  // 50 Mbps 素材から20秒はコピーだと約126 MB
  const plan = planTrimEncoding({ ...HIGH_BITRATE_SOURCE, trimDurationSeconds: 20 });

  assert.ok(plan.estimatedBytes > 100_000_000, 'copy would exceed the budget');
  assert.equal(plan.videoBitrateBps, 8_000_000, '短いクリップは画質上限で頭打ちにする');

  const args = buildTrimArguments({
    inputPath: 'in.mp4',
    outputPath: 'out.mp4',
    startSeconds: 10,
    durationSeconds: 20,
    videoBitrateBps: plan.videoBitrateBps,
  });
  assert.ok(args.includes('libx264'));
  assert.deepEqual(args.slice(args.indexOf('-maxrate'), args.indexOf('-maxrate') + 2), ['-maxrate', '8000000']);
  assert.ok(args.includes('-c:a') && args.includes('aac'));
  assert.equal(args.includes('copy'), false);
});

test('lowers the bitrate further so long trims still fit the budget', () => {
  const plan = planTrimEncoding({ ...HIGH_BITRATE_SOURCE, trimDurationSeconds: 140 });

  // 60 MB を140秒で割ったビットレート = 約3.4 Mbps
  assert.ok(plan.videoBitrateBps < 8_000_000);
  const projectedBytes = (plan.videoBitrateBps * 140) / 8;
  assert.ok(projectedBytes <= 60_000_000, `projected ${projectedBytes} must fit the budget`);
});

test('honours a smaller budget such as the Bluesky upload limit', () => {
  const plan = planTrimEncoding({
    ...HIGH_BITRATE_SOURCE,
    trimDurationSeconds: 180,
    maxOutputBytes: 100_000_000,
  });

  const projectedBytes = (plan.videoBitrateBps * 180) / 8;
  assert.ok(projectedBytes <= 100_000_000);
});

test('falls back to copying when the source cannot be measured', () => {
  assert.equal(planTrimEncoding({}).videoBitrateBps, null);
  assert.equal(
    planTrimEncoding({ sourceBytes: 0, sourceDurationSeconds: 0, trimDurationSeconds: 20 }).videoBitrateBps,
    null,
  );
});

test('allows a longer FFmpeg run when re-encoding', async () => {
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, ms) => {
    timers.push(ms);
    return originalSetTimeout(callback, 60_000);
  };
  try {
    await runFfmpegTrim({
      ffmpegPath: 'ffmpeg-safe',
      inputPath: 'in.mp4',
      outputPath: path.join(os.tmpdir(), 'socialdeck-reencode.mp4'),
      startSeconds: 0,
      durationSeconds: 20,
      videoBitrateBps: 8_000_000,
      spawnImpl() {
        const child = createChild();
        queueMicrotask(() => child.emit('close', 0));
        return child;
      },
    });
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  assert.equal(timers[0], 10 * 60 * 1000);
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
