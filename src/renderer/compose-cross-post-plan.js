(function (global) {
  function createCrossPostPlan({
    text,
    media = { images: [], video: null },
    xAccountId,
    blueskyAccountId,
    createRequest,
    prepareDelivery,
    prepareCompletion,
  } = {}) {
    if (typeof createRequest !== 'function'
      || typeof prepareDelivery !== 'function'
      || typeof prepareCompletion !== 'function') {
      throw new Error('Cross-post planning requires Compose Request and Network Adapter boundaries');
    }

    const images = Array.from(media.images || []);
    const video = media.video
      ? {
          file: media.video.file,
          sourcePath: media.video.path,
          durationSeconds: media.video.durationSeconds,
          trim: { ...media.video.trim },
        }
      : null;
    const xRequest = createRequest({
      networkId: 'x',
      accountId: xAccountId,
      text,
      images,
      video,
      replyTo: null,
    });
    const blueskyRequest = createRequest({
      networkId: 'b',
      accountId: blueskyAccountId,
      text,
      images,
      video,
      replyTo: null,
    });

    function target(request, executionContext = {}) {
      return {
        request,
        delivery: prepareDelivery(request),
        completionPlan: prepareCompletion(request),
        executionContext,
      };
    }

    return {
      x: target(xRequest, {
        videoPath: media.video?.path || null,
        videoDuration: media.video?.durationSeconds || 0,
      }),
      bluesky: target(blueskyRequest),
    };
  }

  global.SocialDeckComposeCrossPostPlan = { createCrossPostPlan };
})(window);
