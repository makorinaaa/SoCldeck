(function (global) {
  const SUPPORTED_NETWORKS = new Set(['x', 'b']);

  function copyPostReference(reference) {
    if (!reference) return null;
    return { uri: reference.uri, cid: reference.cid };
  }

  function createComposeRequest({
    networkId,
    accountId,
    text = '',
    images = [],
    video = null,
    replyTo = null,
  } = {}) {
    if (!SUPPORTED_NETWORKS.has(networkId)) {
      throw new Error(`Unsupported compose network: ${networkId || 'missing'}`);
    }
    if (!accountId || !String(accountId).trim()) {
      throw new Error('Compose Request requires a target Network Account');
    }

    const normalizedText = String(text).trim();
    const attachments = Array.from(images).map(image => {
      if (!image?.file) throw new Error('Image attachment requires a file');
      return {
        kind: 'image',
        file: image.file,
        altText: String(image.altText || ''),
      };
    });

    if (video) {
      if (!video.file) throw new Error('Video attachment requires a file');
      const attachment = {
        kind: 'video',
        file: video.file,
        trim: {
          startSeconds: Number(video.trim?.startSeconds ?? 0),
          endSeconds: video.trim?.endSeconds == null
            ? null
            : Number(video.trim.endSeconds),
        },
      };
      if (video.sourcePath) attachment.sourcePath = String(video.sourcePath);
      if (Number.isFinite(Number(video.durationSeconds))) {
        attachment.durationSeconds = Number(video.durationSeconds);
      }
      if (video.altText) attachment.altText = String(video.altText);
      attachments.push(attachment);
    }

    if (!normalizedText && attachments.length === 0) {
      throw new Error('Compose Request requires text or attachment');
    }

    return {
      target: {
        networkId,
        accountId: String(accountId),
      },
      text: normalizedText,
      attachments,
      replyTo: replyTo
        ? {
            root: copyPostReference(replyTo.root),
            parent: copyPostReference(replyTo.parent),
          }
        : null,
    };
  }

  global.SocialDeckComposeRequest = {
    createComposeRequest,
  };
})(window);
