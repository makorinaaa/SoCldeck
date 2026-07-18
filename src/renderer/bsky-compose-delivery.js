(function (global) {
  function createBlueskyComposeDelivery({
    uploadBlob,
    uploadVideo,
    buildFacets,
    resolveFacets,
    createRecord,
    now = () => new Date().toISOString(),
  }) {
    async function execute(delivery) {
      let embed;
      if (delivery.images.length > 0) {
        const images = await Promise.all(delivery.images.map(async image => ({
          alt: image.alt,
          image: await uploadBlob(image.file),
        })));
        embed = { $type: 'app.bsky.embed.images', images };
      } else if (delivery.video) {
        const video = await uploadVideo(delivery.video);
        embed = {
          $type: 'app.bsky.embed.video',
          video,
          alt: delivery.video.alt || '',
        };
      }

      const facets = await resolveFacets(buildFacets(delivery.text));
      const record = {
        $type: 'app.bsky.feed.post',
        text: delivery.text,
        createdAt: now(),
      };
      if (facets.length) record.facets = facets;
      if (delivery.reply) record.reply = delivery.reply;
      if (embed) record.embed = embed;

      await createRecord({ repoDid: delivery.repoDid, record });
      return { status: 'succeeded' };
    }

    return { execute };
  }

  global.SocialDeckBskyComposeDelivery = {
    createBlueskyComposeDelivery,
  };
})(window);
