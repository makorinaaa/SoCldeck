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

  global.SocialDeckComposeMedia = {
    MAX_IMAGE_COUNT,
    MAX_VIDEO_SECONDS,
    availableImageSlots,
    clampTrimPercent,
    firstVideo,
    imageFiles,
    isImageFile,
    isVideoFile,
    toFiles,
  };
})(window);
