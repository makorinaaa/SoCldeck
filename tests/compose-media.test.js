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
  const narrowTrim = draft.setTrimPercent('start', 99);
  assert.ok(Math.abs(narrowTrim.percent - 69.95) < 0.000001);
  assert.ok(Math.abs(narrowTrim.trim.startSeconds - 139.9) < 0.000001);
  assert.equal(narrowTrim.trim.endSeconds, 140);
  assert.ok(Math.abs(narrowTrim.trimDurationSeconds - 0.1) < 0.000001);

  const video = draft.getSnapshot().video;
  assert.equal(video.path, 'C:\\video\\clip.mp4');
  assert.equal(video.durationSeconds, 200);
});

test('sets trim edges in seconds with sub-second precision', () => {
  const media = loadComposeMedia();
  const draft = media.createMediaDraft({ supportsVideo: true });

  draft.addFiles([file('clip.mp4', 'video/mp4')]);
  draft.setVideoDuration(600);

  const startTrim = draft.setTrimSeconds('start', 123.45);
  assert.ok(Math.abs(startTrim.percent - 20.575) < 0.000001);
  assert.deepEqual(plain(startTrim.trim), { startSeconds: 123.45, endSeconds: 600 });
  assert.equal(startTrim.trimDurationSeconds, 476.55);
  const narrowed = draft.setTrimSeconds('end', 123.5);
  assert.ok(Math.abs(narrowed.percent - 20.5916666667) < 0.000001);
  assert.equal(narrowed.trim.startSeconds, 123.45);
  assert.ok(Math.abs(narrowed.trim.endSeconds - 123.55) < 0.000001);
  assert.ok(Math.abs(narrowed.trimDurationSeconds - 0.1) < 0.000001);
});

test('uses a fixed 0.1 second trim gap instead of one percent of the video', () => {
  const media = loadComposeMedia();
  const draft = media.createMediaDraft({ supportsVideo: true });

  draft.addFiles([file('long.mp4', 'video/mp4')]);
  draft.setVideoDuration(1200);
  draft.setTrimSeconds('end', 600);
  const result = draft.setTrimPercent('start', 50);

  assert.equal(result.trim.endSeconds, 600);
  assert.ok(Math.abs(result.trim.startSeconds - 599.9) < 0.000001);
  assert.ok(Math.abs(result.trimDurationSeconds - 0.1) < 0.000001);
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

test('allows only configured Bluesky video MIME types', () => {
  const media = loadComposeMedia();
  const draft = media.createMediaDraft({
    supportsVideo: true,
    videoMimeTypes: ['video/mp4'],
  });

  assert.deepEqual(
    plain(draft.addFiles([file('clip.webm', 'video/webm')])),
    { status: 'rejected', reason: 'unsupported-video' },
  );
  assert.equal(draft.addFiles([file('clip.mp4', 'video/mp4')]).status, 'video-added');
  draft.clear();
  assert.equal(draft.addFiles([file('clip.mp4', '')]).status, 'video-added');
});

test('validates cross-post video rules behind the Media Draft boundary', () => {
  const media = loadComposeMedia();
  const draft = media.createMediaDraft({
    supportsVideo: true,
    resolveFilePath: selected => selected.path,
  });
  draft.addFiles([file('clip.mp4', 'video/mp4', 'C:\\video\\clip.mp4')]);
  draft.setVideoDuration(180);

  assert.deepEqual(plain(draft.validateVideo({
    allowedMimeTypes: ['video/mp4'],
    maxDurationSeconds: 140,
    requirePath: true,
  })), {
    valid: false,
    reason: 'duration-limit',
    durationSeconds: 180,
    maxDurationSeconds: 140,
  });
  draft.setTrimSeconds('end', 120);
  assert.deepEqual(plain(draft.validateVideo({
    allowedMimeTypes: ['video/mp4'],
  })), { valid: true });
  assert.deepEqual(plain(draft.validateVideo({
    allowedMimeTypes: ['video/mp4'],
    maxDurationSeconds: 140,
    requirePath: true,
  })), { valid: true });
});
