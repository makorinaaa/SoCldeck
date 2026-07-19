(function (global) {
  const MAX_IMAGE_COUNT = 4;
  const MAX_VIDEO_SECONDS = 140;
  const MIN_TRIM_SECONDS = 0.1;

  function toFiles(files) {
    return Array.from(files || []);
  }

  function isImageFile(file) {
    return Boolean(file?.type?.startsWith('image/'));
  }

  function fileExtension(file) {
    return String(file?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  }

  function isVideoFile(file) {
    return Boolean(file?.type?.startsWith('video/'))
      || (!file?.type && ['mp4', 'mov', 'm4v', 'webm'].includes(fileExtension(file)));
  }

  function matchesVideoTypes(file, allowedTypes) {
    if (!allowedTypes) return true;
    if (allowedTypes.has(file?.type)) return true;
    return !file?.type
      && fileExtension(file) === 'mp4'
      && allowedTypes.has('video/mp4');
  }

  function firstVideo(files, allowedTypes = null) {
    return toFiles(files).find(file => (
      isVideoFile(file) && matchesVideoTypes(file, allowedTypes)
    )) || null;
  }

  function imageFiles(files) {
    return toFiles(files).filter(isImageFile);
  }

  function availableImageSlots(currentCount, maxCount = MAX_IMAGE_COUNT) {
    return Math.max(0, maxCount - Number(currentCount || 0));
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function createMediaDraft({
    supportsVideo = false,
    videoMimeTypes = null,
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
      const allowedVideoTypes = videoMimeTypes ? new Set(videoMimeTypes) : null;
      const videoFile = supportsVideo ? firstVideo(candidates, allowedVideoTypes) : null;
      if (supportsVideo && !videoFile && firstVideo(candidates)) {
        return { status: 'rejected', reason: 'unsupported-video' };
      }
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

    function setTrimSeconds(edge, value) {
      if (!video?.durationSeconds) return null;
      const isStart = edge === 'start';
      if (!isStart && edge !== 'end') return null;
      const requestedSeconds = Number.parseFloat(value);
      if (!Number.isFinite(requestedSeconds)) return null;
      const minimumGap = Math.min(MIN_TRIM_SECONDS, video.durationSeconds);
      const seconds = isStart
        ? clamp(requestedSeconds, 0, Math.max(0, video.trim.endSeconds - minimumGap))
        : clamp(requestedSeconds, Math.min(video.durationSeconds, video.trim.startSeconds + minimumGap), video.durationSeconds);
      if (isStart) video.trim.startSeconds = seconds;
      else video.trim.endSeconds = seconds;
      const snapshot = copyVideo();
      return {
        percent: (seconds / video.durationSeconds) * 100,
        trim: snapshot.trim,
        trimDurationSeconds: snapshot.trimDurationSeconds,
      };
    }

    function setTrimPercent(edge, value) {
      if (!video?.durationSeconds) return null;
      const percent = clamp(Number.parseFloat(value), 0, 100);
      if (!Number.isFinite(percent)) return null;
      return setTrimSeconds(edge, (percent / 100) * video.durationSeconds);
    }

    function validateVideo({
      allowedMimeTypes = null,
      maxDurationSeconds = null,
      requirePath = false,
    } = {}) {
      if (!video) return { valid: true };
      const allowedTypes = allowedMimeTypes ? new Set(allowedMimeTypes) : null;
      if (allowedTypes && !matchesVideoTypes(video.file, allowedTypes)) {
        return {
          valid: false,
          reason: 'unsupported-video',
          mimeType: video.file?.type || '',
        };
      }
      if (requirePath && !video.path) return { valid: false, reason: 'missing-path' };
      const durationSeconds = Math.max(0, video.trim.endSeconds - video.trim.startSeconds);
      const maximum = maxDurationSeconds == null ? null : Number(maxDurationSeconds);
      if (Number.isFinite(maximum) && durationSeconds > maximum) {
        return {
          valid: false,
          reason: 'duration-limit',
          durationSeconds,
          maxDurationSeconds: maximum,
        };
      }
      return { valid: true };
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
      setTrimSeconds,
      setVideoDuration,
      updateAlt,
      validateVideo,
    };
  }

  global.SocialDeckComposeMedia = {
    MAX_IMAGE_COUNT,
    MAX_VIDEO_SECONDS,
    createMediaDraft,
  };
})(window);
