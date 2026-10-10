(function (global) {
  const TID_CHARS = '234567abcdefghijklmnopqrstuvwxyz';

  // AT Protocol の TID（マイクロ秒の時刻 53bit + clock ID 10bit を 13 文字で表す）。
  // 投稿の rkey を送信前に決めておくと、再送しても同じ投稿を指すので重複しない。
  function createPostKey({
    nowMs = Date.now(),
    clockId = Math.floor(Math.random() * 1024),
  } = {}) {
    let value = (BigInt(Math.floor(nowMs)) * 1000n << 10n) | BigInt(clockId & 1023);
    let key = '';
    for (let index = 0; index < 13; index++) {
      key = TID_CHARS[Number(value & 31n)] + key;
      value >>= 5n;
    }
    return key;
  }

  // 応答が返らなかった・サーバー側の障害など、投稿が作られたかどうか分からない失敗
  function isUnknownOutcome(error) {
    const status = Number(error?.status) || 0;
    return ['RequestTimeout', 'NetworkError'].includes(error?.code)
      || status >= 500
      || (status >= 200 && status < 300);
  }

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

      try {
        await createRecord({ repoDid: delivery.repoDid, record, ...(delivery.rkey ? { rkey: delivery.rkey } : {}) });
      } catch (error) {
        if (isUnknownOutcome(error)) return { status: 'unknown', error };
        throw error;
      }
      return { status: 'succeeded' };
    }

    return { execute };
  }

  global.SocialDeckBskyComposeDelivery = {
    createBlueskyComposeDelivery,
    createPostKey,
  };
})(window);
