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
