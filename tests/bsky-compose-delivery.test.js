const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadFactory() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'bsky-compose-delivery.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckBskyComposeDelivery.createBlueskyComposeDelivery;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('builds and creates a Bluesky post record behind its Adapter interface', async () => {
  const createDelivery = loadFactory();
  const created = [];
  const uploaded = [];
  const delivery = createDelivery({
    uploadBlob: async file => {
      uploaded.push(file.name);
      return { ref: `blob:${file.name}` };
    },
    buildFacets: text => [{ text }],
    resolveFacets: async facets => facets.map(facet => ({ ...facet, resolved: true })),
    createRecord: async record => created.push(plain(record)),
    now: () => '2026-07-16T00:00:00.000Z',
  });

  await delivery.execute({
    repoDid: 'did:plc:alice',
    text: 'hello @bob.test',
    images: [{
      file: { name: 'photo.jpg', type: 'image/jpeg' },
      alt: 'A photo',
    }],
    reply: {
      root: { uri: 'at://root', cid: 'root-cid' },
      parent: { uri: 'at://parent', cid: 'parent-cid' },
    },
  });

  assert.deepEqual(uploaded, ['photo.jpg']);
  assert.deepEqual(created, [{
    repoDid: 'did:plc:alice',
    record: {
      $type: 'app.bsky.feed.post',
      text: 'hello @bob.test',
      createdAt: '2026-07-16T00:00:00.000Z',
      facets: [{ text: 'hello @bob.test', resolved: true }],
      reply: {
        root: { uri: 'at://root', cid: 'root-cid' },
        parent: { uri: 'at://parent', cid: 'parent-cid' },
      },
      embed: {
        $type: 'app.bsky.embed.images',
        images: [{ alt: 'A photo', image: { ref: 'blob:photo.jpg' } }],
      },
    },
  }]);
});

test('uploads and embeds one Bluesky video', async () => {
  const createDelivery = loadFactory();
  const calls = [];
  const delivery = createDelivery({
    uploadBlob: async () => { throw new Error('image upload should not run'); },
    uploadVideo: async video => {
      calls.push(['uploadVideo', plain(video)]);
      return { ref: 'video-ref' };
    },
    buildFacets: () => [],
    resolveFacets: async facets => facets,
    createRecord: async record => calls.push(['createRecord', plain(record)]),
    now: () => '2026-07-18T00:00:00.000Z',
  });

  await delivery.execute({
    repoDid: 'did:plc:alice',
    text: 'video post',
    images: [],
    video: {
      file: { name: 'clip.mp4' },
      sourcePath: 'C:\\media\\clip.mp4',
      trim: { startSeconds: 5, endSeconds: 65 },
      durationSeconds: 90,
      alt: 'Demo video',
    },
    reply: null,
  });

  assert.equal(calls[0][0], 'uploadVideo');
  assert.deepEqual(calls[1][1].record.embed, {
    $type: 'app.bsky.embed.video',
    video: { ref: 'video-ref' },
    alt: 'Demo video',
  });
});

for (const withImage of [false, true]) {
  test('Bluesky delivery reaches authenticated API and completes: ' + (withImage ? 'image' : 'text'), async () => {
    const { createAtprotoClient } = require('../src/main/bluesky-atproto-client');
    const { createBlueskyGateway } = require('../src/main/bluesky-gateway');
    const calls = [];
    const client = createAtprotoClient({ fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, text: async () => JSON.stringify(url.endsWith('uploadBlob')
        ? { blob: { $type: 'blob', ref: { $link: 'fixture' }, mimeType: 'image/png', size: 1 } }
        : { uri: 'at://did:plc:test/app.bsky.feed.post/1', cid: 'fixture' }) };
    } });
    const gateway = createBlueskyGateway({ client, vault: {
      load: () => ({ did: 'did:plc:test', accessJwt: 'fixture', refreshJwt: 'fixture' }),
      save() {}, clear() {},
    } });
    const delivery = loadFactory()({
      uploadBlob: async () => (await gateway.execute('uploadBlob', { mimeType: 'image/png', bytes: Buffer.from([1]) })).blob,
      buildFacets: () => [], resolveFacets: async value => value,
      createRecord: payload => gateway.execute('createPostRecord', payload),
    });
    const result = await delivery.execute({ text: '投稿テスト', images: withImage ? [{ file: {}, alt: '画像' }] : [] });
    assert.equal(result.status, 'succeeded');
    assert.equal(calls.length, withImage ? 2 : 1);
    const record = JSON.parse(calls.at(-1).options.body);
    assert.equal(record.repo, 'did:plc:test');
    assert.equal(record.record.text, '投稿テスト');
    assert.equal(Boolean(record.record.embed), withImage);
    for (const call of calls) assert.equal(call.options.headers.Authorization, 'Bearer fixture');
  });
}

test('Bluesky upload rejection does not submit an attachment-free post', async () => {
  let created = 0;
  const delivery = loadFactory()({
    uploadBlob: async () => { throw new Error('Upload failed'); },
    buildFacets: () => [], resolveFacets: async value => value,
    createRecord: async () => { created++; },
  });
  await assert.rejects(delivery.execute({ text: 'hello', images: [{ file: {}, alt: '' }] }), /Upload failed/);
  assert.equal(created, 0);
});

function loadModule() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'bsky-compose-delivery.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckBskyComposeDelivery;
}

test('sends the post under the record key chosen for this delivery', async () => {
  const created = [];
  const delivery = loadFactory()({
    buildFacets: () => [], resolveFacets: async value => value,
    createRecord: async payload => created.push(payload.rkey),
  });

  await delivery.execute({ text: 'hello', images: [], rkey: '3lbcdefghijk2' });

  assert.deepEqual(created, ['3lbcdefghijk2']);
});

for (const [label, error] of [
  ['a timeout', Object.assign(new Error('timed out'), { status: 0, code: 'RequestTimeout' })],
  ['a lost connection', Object.assign(new Error('failed'), { status: 0, code: 'NetworkError' })],
  ['a server error', Object.assign(new Error('Upstream'), { status: 502, code: '' })],
]) {
  test(`reports ${label} while creating the post as an unknown outcome`, async () => {
    const delivery = loadFactory()({
      buildFacets: () => [], resolveFacets: async value => value,
      createRecord: async () => { throw error; },
    });

    const result = await delivery.execute({ text: 'hello', images: [] });

    assert.equal(result.status, 'unknown');
  });
}

test('keeps a rejected post as a failure', async () => {
  const delivery = loadFactory()({
    buildFacets: () => [], resolveFacets: async value => value,
    createRecord: async () => {
      throw Object.assign(new Error('Record/text must not be longer than 300 graphemes'), { status: 400 });
    },
  });

  await assert.rejects(delivery.execute({ text: 'hello', images: [] }), /300 graphemes/);
});

test('creates time-ordered post record keys in the TID format', () => {
  const { createPostKey } = loadModule();
  const first = createPostKey({ nowMs: 1_700_000_000_000, clockId: 0 });
  const later = createPostKey({ nowMs: 1_700_000_000_001, clockId: 0 });

  assert.match(first, /^[2-7a-j][2-7a-z]{12}$/);
  assert.match(createPostKey(), /^[2-7a-j][2-7a-z]{12}$/);
  assert.ok(first < later);
});
