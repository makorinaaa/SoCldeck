const assert = require('node:assert/strict');
const test = require('node:test');

const { createBlueskyVideoFileService } = require('../src/main/bluesky-video-file');

test('trims a selected MP4 and removes its temporary output after reading', async () => {
  const events = [];
  const service = createBlueskyVideoFileService({
    exists: filePath => filePath === 'C:\\media\\clip.mp4',
    getSize: async () => 3,
    makeTempPath: () => 'C:\\temp\\socialdeck_bsky_video_1.mp4',
    readFile: async filePath => {
      events.push(['read', filePath]);
      return Buffer.from([1, 2, 3]);
    },
    removeFile: async filePath => events.push(['remove', filePath]),
    runTrim: async options => events.push(['trim', options]),
    resolveFfmpeg: () => 'ffmpeg.exe',
  });

  const result = await service.prepare({
    filePath: 'C:\\media\\clip.mp4',
    name: 'clip.mp4',
    startSeconds: 5,
    endSeconds: 65,
    durationSeconds: 90,
  });

  assert.deepEqual(result, { name: 'clip.mp4', bytes: Buffer.from([1, 2, 3]) });
  assert.equal(events[0][0], 'trim');
  assert.equal(events[0][1].durationSeconds, 60);
  assert.deepEqual(events.slice(1), [
    ['read', 'C:\\temp\\socialdeck_bsky_video_1.mp4'],
    ['remove', 'C:\\temp\\socialdeck_bsky_video_1.mp4'],
  ]);
});

test('rejects unsupported, oversized, and overlong Bluesky videos', async () => {
  const createService = bytes => createBlueskyVideoFileService({
    exists: () => true,
    getSize: async () => bytes,
    readFile: async () => Buffer.from([1]),
  });

  await assert.rejects(
    createService(1).prepare({
      filePath: 'C:\\media\\clip.webm', name: 'clip.webm',
      startSeconds: 0, endSeconds: 10, durationSeconds: 10,
    }),
    /MP4/i,
  );
  await assert.rejects(
    createService(1).prepare({
      filePath: 'C:\\media\\clip.mp4', name: 'clip.mp4',
      startSeconds: 0, endSeconds: 181, durationSeconds: 181,
    }),
    /180 seconds/i,
  );
  await assert.rejects(
    createService(100_000_001).prepare({
      filePath: 'C:\\media\\clip.mp4', name: 'clip.mp4',
      startSeconds: 0, endSeconds: 10, durationSeconds: 10,
    }),
    /100 MB/i,
  );
});
