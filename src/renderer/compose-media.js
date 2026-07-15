(function (global) {
  const MAX_IMAGE_COUNT = 4;
  const MAX_VIDEO_SECONDS = 140;

  function toFiles(files) {
    return Array.from(files || []);
  }

  function isImageFile(file) {
    return Boolean(file?.type?.startsWith('image/'));
  }

  function isVideoFile(file) {
    return Boolean(file?.type?.startsWith('video/'));
  }

  function firstVideo(files) {
    return toFiles(files).find(isVideoFile) || null;
  }

  function imageFiles(files) {
    return toFiles(files).filter(isImageFile);
  }

  function availableImageSlots(currentCount, maxCount = MAX_IMAGE_COUNT) {
    return Math.max(0, maxCount - Number(currentCount || 0));
  }

  function clampTrimPercent({ value, otherValue, minGapPercent = 1, direction }) {
    const number = Number.parseFloat(value);
    const other = Number.parseFloat(otherValue);
    if (!Number.isFinite(number)) return 0;
    if (!Number.isFinite(other)) return number;
    if (direction === 'in' && number >= other - minGapPercent) return other - minGapPercent;
    if (direction === 'out' && number <= other + minGapPercent) return other + minGapPercent;
    return number;
  }

  function createMediaDraft({
    supportsVideo = false,
    maxImages = MAX_IMAGE_COUNT,
    resolveFilePath = () => null,
  } = {}) {
    let images = [];
    let video = null;

    function copyVideo() {
      if (!video) return null;
      const trim = { ...video.trim };
      return {
        file: video.file,
        path: video.path,
        durationSeconds: video.durationSeconds,
        trim,
        trimDurationSeconds: Math.max(0, trim.endSeconds - trim.startSeconds),
      };
    }

    function getSnapshot() {
      return {
        images: images.map(image => ({ ...image })),
        video: copyVideo(),
      };
    }

    function addFiles(files) {
      const candidates = toFiles(files);
      const videoFile = supportsVideo ? firstVideo(candidates) : null;
      if (videoFile) {
        if (images.length > 0) return { status: 'rejected', reason: 'mixed-media' };
        video = {
          file: videoFile,
          path: resolveFilePath(videoFile),
          durationSeconds: 0,
          trim: { startSeconds: 0, endSeconds: 0 },
        };
        return { status: 'video-added', file: videoFile };
      }

      const selectedImages = imageFiles(candidates);
      if (selectedImages.length === 0) return { status: 'ignored' };
      if (video) return { status: 'rejected', reason: 'mixed-media' };

      const remaining = availableImageSlots(images.length, maxImages);
      if (remaining <= 0) return { status: 'rejected', reason: 'image-limit' };
      const added = selectedImages.slice(0, remaining);
      images.push(...added.map(file => ({ file, altText: '' })));
      return {
        status: 'images-added',
        addedCount: added.length,
        limitReached: images.length >= maxImages,
      };
    }

    function updateAlt(index, altText) {
      if (!images[index]) return false;
      images[index].altText = String(altText || '');
      return true;
    }

    function removeImage(index) {
      if (!Number.isInteger(index) || index < 0 || index >= images.length) return false;
      images.splice(index, 1);
      return true;
    }

    function removeVideo() {
      if (!video) return false;
      video = null;
      return true;
    }

    function setVideoDuration(durationSeconds) {
      const duration = Number(durationSeconds);
      if (!video || !Number.isFinite(duration) || duration < 0) return false;
      video.durationSeconds = duration;
      video.trim = { startSeconds: 0, endSeconds: duration };
      return true;
    }

    function setTrimPercent(edge, value) {
      if (!video?.durationSeconds) return null;
      const isStart = edge === 'start';
      const otherSeconds = isStart ? video.trim.endSeconds : video.trim.startSeconds;
      const otherPercent = (otherSeconds / video.durationSeconds) * 100;
      const percent = clampTrimPercent({
        value,
        otherValue: otherPercent,
        direction: isStart ? 'in' : 'out',
      });
      const seconds = (percent / 100) * video.durationSeconds;
      if (isStart) video.trim.startSeconds = seconds;
      else video.trim.endSeconds = seconds;
      const snapshot = copyVideo();
      return {
        percent,
        trim: snapshot.trim,
        trimDurationSeconds: snapshot.trimDurationSeconds,
      };
    }

    function clear() {
      images = [];
      video = null;
    }

    return {
      addFiles,
      clear,
      getSnapshot,
      removeImage,
      removeVideo,
      setTrimPercent,
      setVideoDuration,
      updateAlt,
    };
  }

  global.SocialDeckComposeMedia = {
    MAX_IMAGE_COUNT,
    MAX_VIDEO_SECONDS,
    createMediaDraft,
  };
})(window);
