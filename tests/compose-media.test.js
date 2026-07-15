const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadComposeMedia() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'compose-media.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckComposeMedia;
}

function file(name, type, pathValue = null) {
  return { name, type, path: pathValue };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('owns image limits and alt text as Compose Experience Runtime State', () => {
  const media = loadComposeMedia();
  const draft = media.createMediaDraft();
  const files = Array.from({ length: 5 }, (_, index) => file(`${index}.png`, 'image/png'));

  assert.deepEqual(
    plain(draft.addFiles(files)),
    { status: 'images-added', addedCount: 4, limitReached: true },
  );
  assert.equal(draft.updateAlt(1, 'second image'), true);
  assert.deepEqual(
    plain(draft.getSnapshot().images.map(image => ({ name: image.file.name, altText: image.altText }))),
    [
      { name: '0.png', altText: '' },
      { name: '1.png', altText: 'second image' },
      { name: '2.png', altText: '' },
      { name: '3.png', altText: '' },
    ],
  );
  assert.deepEqual(
    plain(draft.addFiles([file('extra.png', 'image/png')])),
    { status: 'rejected', reason: 'image-limit' },
  );
});

test('prevents mixed image and video attachments for X', () => {
  const media = loadComposeMedia();
  const draft = media.createMediaDraft({ supportsVideo: true });

  draft.addFiles([file('image.png', 'image/png')]);
  assert.deepEqual(
    plain(draft.addFiles([file('clip.mp4', 'video/mp4')])),
    { status: 'rejected', reason: 'mixed-media' },
  );

  draft.clear();
  draft.addFiles([file('clip.mp4', 'video/mp4')]);
  assert.deepEqual(
    plain(draft.addFiles([file('image.png', 'image/png')])),
    { status: 'rejected', reason: 'mixed-media' },
  );
});

test('owns video path, duration, and clamped trim calculations', () => {
  const media = loadComposeMedia();
  const draft = media.createMediaDraft({
    supportsVideo: true,
    resolveFilePath: selected => selected.path,
  });

  assert.equal(
    draft.addFiles([file('clip.mp4', 'video/mp4', 'C:\\video\\clip.mp4')]).status,
    'video-added',
  );
  draft.setVideoDuration(200);
  assert.deepEqual(plain(draft.setTrimPercent('start', 20)), {
    percent: 20,
    trim: { startSeconds: 40, endSeconds: 200 },
    trimDurationSeconds: 160,
  });
  assert.deepEqual(plain(draft.setTrimPercent('end', 70)), {
    percent: 70,
    trim: { startSeconds: 40, endSeconds: 140 },
    trimDurationSeconds: 100,
  });
  assert.deepEqual(plain(draft.setTrimPercent('start', 99)), {
    percent: 69,
    trim: { startSeconds: 138, endSeconds: 140 },
    trimDurationSeconds: 2,
  });

  const video = draft.getSnapshot().video;
  assert.equal(video.path, 'C:\\video\\clip.mp4');
  assert.equal(video.durationSeconds, 200);
});

test('ignores unsupported video files in a Bluesky media draft', () => {
  const media = loadComposeMedia();
  const draft = media.createMediaDraft();

  assert.deepEqual(
    plain(draft.addFiles([file('clip.mp4', 'video/mp4')])),
    { status: 'ignored' },
  );
  assert.deepEqual(plain(draft.getSnapshot()), { images: [], video: null });
});
