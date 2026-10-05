const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { createXVideoFileService } = require('../src/main/x-video-file');

const sourcePath = path.resolve('fixture-video.mp4');
const temporaryPath = path.join(os.tmpdir(), 'socialdeck_trim_fixture.mp4');

test('validates the video and trim range before starting FFmpeg', async () => {
  let runs = 0;
  const files = createXVideoFileService({ exists: () => true, runTrim: () => { runs++; } });
  for (const input of [
    { filePath: 'fixture.txt', startSec: 0, endSec: 10 },
    { filePath: sourcePath, startSec: -1, endSec: 10 },
    { filePath: sourcePath, startSec: 0, endSec: 141 },
    { filePath: sourcePath, startSec: 10, endSec: 10 },
  ]) await assert.rejects(files.trim(input));
  assert.equal(runs, 0);
});

test('trims high bitrate video with the same output budget and bundled FFmpeg', async () => {
  let request;
  const files = createXVideoFileService({
    isPackaged: true, exists: () => true,
    stat: async file => ({ size: file === sourcePath ? 1_849_604_376 : 40_000_000 }),
    makeTempPath: () => temporaryPath,
    resolveFfmpeg: options => { assert.equal(options.isPackaged, true); return 'bundled-ffmpeg'; },
    runTrim: async value => { request = value; },
  });
  assert.equal(await files.trim({ filePath: sourcePath, startSec: 5, endSec: 65, durationSec: 295.55 }), temporaryPath);
  assert.equal(request.inputPath, sourcePath);
  assert.equal(request.durationSeconds, 60);
  assert.equal(request.ffmpegPath, 'bundled-ffmpeg');
  assert.equal(request.videoBitrateBps, 8_000_000);
});

test('removes an oversized trim result before reporting the error', async () => {
  const removed = [];
  const files = createXVideoFileService({ exists: () => true,
    stat: async () => ({ size: 200_000_000 }), makeTempPath: () => temporaryPath,
    resolveFfmpeg: () => 'fixture', runTrim: async () => {}, removeFile: async file => removed.push(file),
  });
  await assert.rejects(files.trim({ filePath: sourcePath, startSec: 0, endSec: 10, durationSec: 60 }), /大きすぎ/);
  assert.deepEqual(removed, [temporaryPath]);
});

test('temporary-file reads and deletes cannot escape the temporary directory', async () => {
  const reads = [], deletes = [];
  const files = createXVideoFileService({ stat: async () => ({ size: 1 }),
    readFile: async file => { reads.push(file); return Buffer.from('x'); },
    unlinkFile: file => deletes.push(file),
  });
  for (const file of [sourcePath, path.join(os.tmpdir(), 'other.mp4'), path.join(os.tmpdir(), '..', 'socialdeck_trim_escape.mp4')]) {
    await assert.rejects(files.readDataUrl(file), /Invalid temp/);
    files.remove(file);
  }
  assert.deepEqual(reads, []);
  assert.deepEqual(deletes, []);
  assert.equal(await files.readDataUrl(temporaryPath), 'data:video/mp4;base64,eA==');
  assert.equal(files.remove(temporaryPath), true);
  assert.deepEqual(deletes, [temporaryPath]);
});

test('rejects unsupported and oversized temporary videos before reading their bytes', async () => {
  const files = createXVideoFileService({ stat: async () => ({ size: 200_000_000 }),
    readFile: () => assert.fail('must not read'),
  });
  await assert.rejects(files.readDataUrl(temporaryPath.replace('.mp4', '.txt')), /Unsupported/);
  await assert.rejects(files.readDataUrl(temporaryPath), /大きすぎ/);
});
