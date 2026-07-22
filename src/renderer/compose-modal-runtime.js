(function (global) {
  function waitForMediaEvent(media, eventName, timeoutMs = 2000) {
    return new Promise(resolve => {
      let timer = null;
      const done = succeeded => {
        if (timer != null) global.clearTimeout?.(timer);
        media.removeEventListener?.(eventName, onEvent);
        media.removeEventListener?.('error', handleError);
        resolve(succeeded);
      };
      const onEvent = () => done(true);
      const handleError = () => done(false);
      media.addEventListener?.(eventName, onEvent, { once: true });
      media.addEventListener?.('error', handleError, { once: true });
      timer = global.setTimeout?.(() => done(false), timeoutMs) ?? null;
    });
  }

  async function createVideoThumbnails({
    documentRef,
    sourceUrl,
    durationSeconds,
    count = 8,
  } = {}) {
    if (!sourceUrl || typeof documentRef?.createElement !== 'function') return [];
    const probe = documentRef.createElement('video');
    const canvas = documentRef.createElement('canvas');
    const context = canvas?.getContext?.('2d');
    if (!probe?.addEventListener || !context) return [];
    canvas.width = 112;
    canvas.height = 63;
    probe.muted = true;
    probe.preload = 'auto';
    const loaded = waitForMediaEvent(probe, 'loadedmetadata');
    probe.src = sourceUrl;
    probe.load?.();
    if (!(await loaded)) return [];

    const duration = Number(durationSeconds) || Number(probe.duration) || 0;
    if (!duration) return [];
    const images = [];
    for (let index = 0; index < count; index += 1) {
      const target = Math.min(Math.max(0, duration - 0.01), ((index + 0.5) / count) * duration);
      const seeked = waitForMediaEvent(probe, 'seeked');
      probe.currentTime = target;
      if (!(await seeked)) break;
      try {
        context.drawImage(probe, 0, 0, canvas.width, canvas.height);
        images.push(canvas.toDataURL('image/jpeg', 0.62));
      } catch (_) {
        break;
      }
    }
    probe.removeAttribute?.('src');
    probe.load?.();
    return images;
  }

  function createComposeModalDomView({
    documentRef = global.document,
    urlApi = global.URL,
    ui = {},
    maxVideoSeconds = { x: 140, b: 180 },
    generateThumbnails = createVideoThumbnails,
  } = {}) {
    const escape = ui.escape || (value => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;'));
    const elements = {};
    const ids = [
      'xPostMod', 'compMod', 'x-acc-select', 'x-cross-post-controls', 'x-cross-post-b',
      'x-cross-post-note', 'x-post-av', 'x-cta', 'x-cct', 'x-sndb', 'x-compose-preview',
      'x-img-area', 'x-img-preview', 'x-img-drop', 'x-img-file', 'x-video-wrap', 'x-video-preview',
      'x-trim-in', 'x-trim-out', 'x-trim-start-label', 'x-trim-end-label',
      'x-trim-dur-label', 'x-trim-highlight', 'x-trim-timeline', 'x-trim-thumbnails',
      'x-trim-playhead', 'x-trim-current-label', 'x-trim-start-input', 'x-trim-end-input',
      'x-trim-loop', 'x-ffmpeg-status', 'cross-post-controls',
      'cross-post-x', 'cross-post-x-account', 'b-cross-post-note', 'comp-av', 'cta', 'cct', 'sndb',
      'b-compose-preview', 'b-img-area', 'b-img-preview', 'b-img-drop', 'b-img-file', 'b-reply-preview',
      'b-video-wrap', 'b-video-preview', 'b-trim-in', 'b-trim-out',
      'b-trim-start-label', 'b-trim-end-label', 'b-trim-dur-label',
      'b-trim-highlight', 'b-trim-timeline', 'b-trim-thumbnails', 'b-trim-playhead',
      'b-trim-current-label', 'b-trim-start-input', 'b-trim-end-input', 'b-trim-loop',
      'b-ffmpeg-status',
    ];
    ids.forEach(id => { elements[id] = documentRef.getElementById(id); });
    let handlers = {};
    const fileUrls = new Map();
    const activeFiles = { x: new Set(), b: new Set() };
    const renderedMedia = {
      x: { images: [], video: null },
      b: { images: [], video: null },
    };
    const renderedVideoFile = { x: null, b: null };
    const renderedThumbnailFile = { x: null, b: null };
    const renderedTrim = { x: null, b: null };
    // 毎キー入力のrenderで変化しない部分は署名比較で再構築を省く
    const renderedSignatures = { xAccountSelect: null, crossPostAccounts: null };
    const trimPreviewActive = { x: false, b: false };
    const thumbnailGeneration = { x: 0, b: 0 };

    function formatTrimTime(value) {
      const seconds = Math.max(0, Number(value) || 0);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remaining = (seconds % 60).toFixed(1).padStart(4, '0');
      return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}`
        : `${minutes}:${remaining}`;
    }

    function parseTrimTime(value) {
      const parts = String(value || '').trim().split(':');
      if (parts.length > 3 || parts.some(part => part === '' || !Number.isFinite(Number(part)))) {
        return null;
      }
      const numbers = parts.map(Number);
      if (numbers.some(number => number < 0)) return null;
      if (numbers.length === 1) return numbers[0];
      if (numbers.slice(1).some(number => number >= 60)) return null;
      return numbers.reduce((total, number) => total * 60 + number, 0);
    }

    function videoLimit(networkId) {
      if (typeof maxVideoSeconds === 'number') return maxVideoSeconds;
      return Number(maxVideoSeconds?.[networkId]) || (networkId === 'b' ? 180 : 140);
    }

    function sameFiles(left, right) {
      return left.length === right.length && left.every((file, index) => file === right[index]);
    }

    function syncAltInputs(preview, images) {
      preview?.querySelectorAll?.('[data-compose-alt-network]').forEach((input, imageIndex) => {
        const nextValue = images[imageIndex]?.altText || '';
        if (input !== documentRef.activeElement && input.value !== nextValue) input.value = nextValue;
      });
    }

    function objectUrl(file) {
      if (!fileUrls.has(file)) fileUrls.set(file, urlApi.createObjectURL(file));
      return fileUrls.get(file);
    }

    function releaseUnusedUrls() {
      const active = new Set([...activeFiles.x, ...activeFiles.b]);
      for (const [file, url] of fileUrls) {
        if (active.has(file)) continue;
        urlApi.revokeObjectURL(url);
        fileUrls.delete(file);
      }
    }

    function updatePlayhead(networkId, currentSeconds) {
      const prefix = networkId === 'x' ? 'x' : 'b';
      const duration = renderedTrim[networkId]?.durationSeconds || 0;
      const percent = duration ? Math.min(100, Math.max(0, (currentSeconds / duration) * 100)) : 0;
      if (elements[`${prefix}-trim-playhead`]) {
        elements[`${prefix}-trim-playhead`].style.left = `${percent}%`;
      }
      if (elements[`${prefix}-trim-current-label`]) {
        const label = elements[`${prefix}-trim-current-label`];
        label.textContent = formatTrimTime(currentSeconds);
        label.style.transform = percent < 8
          ? 'translateX(0)'
          : percent > 92
            ? 'translateX(-100%)'
            : 'translateX(-50%)';
      }
    }

    function renderThumbnails(networkId, video, sourceUrl) {
      const prefix = networkId === 'x' ? 'x' : 'b';
      const container = elements[`${prefix}-trim-thumbnails`];
      if (!container) return;
      const fileName = video?.file?.name || '';
      if (renderedThumbnailFile[networkId] === (video?.file || null)) return;
      const generation = ++thumbnailGeneration[networkId];
      renderedThumbnailFile[networkId] = video?.file || null;
      container.dataset.composeFileName = fileName;
      container.innerHTML = '';
      if (!video || !sourceUrl) return;
      Promise.resolve(generateThumbnails({
        documentRef,
        sourceUrl,
        durationSeconds: video.durationSeconds,
      })).then(images => {
        if (generation !== thumbnailGeneration[networkId]
          || container.dataset.composeFileName !== fileName) return;
        container.innerHTML = Array.from(images || [])
          .map(imageUrl => `<img src="${escape(imageUrl)}" alt="">`)
          .join('');
      }).catch(() => {});
    }

    function renderVideoControls(networkId, video, { crossPosting = false } = {}) {
      const prefix = networkId === 'x' ? 'x' : 'b';
      if (elements[`${prefix}-video-wrap`]) {
        elements[`${prefix}-video-wrap`].style.display = video ? 'block' : 'none';
      }
      const videoElement = elements[`${prefix}-video-preview`];
      if (videoElement) {
        if (video && renderedVideoFile[networkId] !== video.file) {
          videoElement.src = objectUrl(video.file);
          renderedVideoFile[networkId] = video.file;
          videoElement.dataset.composeFileName = video.file?.name || '';
        } else if (!video && renderedVideoFile[networkId]) {
          videoElement.removeAttribute?.('src');
          renderedVideoFile[networkId] = null;
          videoElement.dataset.composeFileName = '';
          videoElement.load?.();
        }
      }
      renderThumbnails(networkId, video, videoElement?.src || '');

      const status = elements[`${prefix}-ffmpeg-status`];
      if (!video) {
        thumbnailGeneration[networkId] += 1;
        renderedTrim[networkId] = null;
        trimPreviewActive[networkId] = false;
        if (status) status.textContent = '';
        return;
      }
      renderedTrim[networkId] = {
        durationSeconds: video.durationSeconds || 0,
        startSeconds: video.trim.startSeconds,
        endSeconds: video.trim.endSeconds,
      };
      const duration = video.durationSeconds || 0;
      const startPercent = duration ? (video.trim.startSeconds / duration) * 100 : 0;
      const endPercent = duration ? (video.trim.endSeconds / duration) * 100 : 100;
      if (elements[`${prefix}-trim-in`]) elements[`${prefix}-trim-in`].value = String(startPercent);
      if (elements[`${prefix}-trim-out`]) elements[`${prefix}-trim-out`].value = String(endPercent);
      if (elements[`${prefix}-trim-start-label`]) {
        elements[`${prefix}-trim-start-label`].textContent = formatTrimTime(video.trim.startSeconds);
      }
      if (elements[`${prefix}-trim-end-label`]) {
        elements[`${prefix}-trim-end-label`].textContent = formatTrimTime(video.trim.endSeconds);
      }
      const startInput = elements[`${prefix}-trim-start-input`];
      const endInput = elements[`${prefix}-trim-end-input`];
      if (startInput && startInput !== documentRef.activeElement) {
        startInput.value = formatTrimTime(video.trim.startSeconds);
      }
      if (endInput && endInput !== documentRef.activeElement) {
        endInput.value = formatTrimTime(video.trim.endSeconds);
      }
      const limit = crossPosting
        ? Math.min(videoLimit('x'), videoLimit('b'))
        : videoLimit(networkId);
      const tooLong = video.trimDurationSeconds > limit;
      if (elements[`${prefix}-trim-dur-label`]) {
        elements[`${prefix}-trim-dur-label`].textContent = formatTrimTime(video.trimDurationSeconds);
        elements[`${prefix}-trim-dur-label`].style.color = tooLong ? 'var(--red)' : 'inherit';
      }
      if (elements[`${prefix}-trim-highlight`]) {
        elements[`${prefix}-trim-highlight`].style.left = `${startPercent}%`;
        elements[`${prefix}-trim-highlight`].style.width = `${Math.max(0, endPercent - startPercent)}%`;
      }
      updatePlayhead(networkId, videoElement?.currentTime || 0);
      if (status) {
        const formattedDuration = formatTrimTime(video.trimDurationSeconds);
        status.textContent = !tooLong
          ? ''
          : limit === 140
            ? `トリム後の長さが ${formattedDuration} です。2分20秒以内にしてください`
            : `動画を3分以内にトリミングしてください（現在 ${formattedDuration}）`;
      }
    }

    function modalId(networkId) {
      return networkId === 'x' ? 'xPostMod' : 'compMod';
    }

    function setOpen(networkId, open) {
      elements[modalId(networkId)]?.classList.toggle('on', Boolean(open));
    }

    function renderPreview(snapshot) {
      const preview = elements[snapshot.networkId === 'x' ? 'x-compose-preview' : 'b-compose-preview'];
      if (!preview) return;
      const account = snapshot.selectedAccount || {};
      const accountName = snapshot.networkId === 'x'
        ? (account.username || 'Xアカウント')
        : (account.displayName || account.handle || 'Blueskyアカウント');
      const initials = account.initials || (snapshot.networkId === 'x' ? 'X' : 'B');
      const avatar = snapshot.networkId === 'b' && account.avatar
        ? `<img src="${escape(account.avatar)}" alt="">`
        : escape(initials);
      preview.classList.toggle('on', snapshot.previewOpen);
      if (!snapshot.previewOpen) return;
      const imageCount = snapshot.media.images.length;
      const altCount = snapshot.media.images.filter(image => image.altText).length;
      const attachmentText = snapshot.media.video
        ? '動画 1本'
        : imageCount > 0 ? `画像 ${imageCount}枚 / ALT入力 ${altCount}枚` : '添付なし';
      preview.innerHTML = `
        <div class="compose-preview-head">
          <div class="compose-preview-avatar" style="background:${escape(account.bg || 'var(--bg3)')}">${avatar}</div>
          <div class="compose-preview-account">${escape(accountName)}</div>
          <div class="compose-preview-targets">${snapshot.targets.map(target => `<span class="compose-preview-target">${escape(target)}</span>`).join('')}</div>
        </div>
        <div class="compose-preview-text">${snapshot.text ? escape(snapshot.text) : '<span style="color:var(--text3)">本文なし</span>'}</div>
        <div class="compose-preview-attachments">${attachmentText}</div>`;
    }

    function renderX(snapshot) {
      if (elements['x-img-area']) {
        elements['x-img-area'].style.pointerEvents = snapshot.busy || snapshot.locked ? 'none' : '';
      }
      const accountSelect = elements['x-acc-select'];
      if (accountSelect) {
        accountSelect.style.display = snapshot.xAccounts.length > 1 ? 'flex' : 'none';
        const signature = snapshot.xAccounts.length > 1
          ? snapshot.xAccounts.map(account => `${account.username}|${account.initials}|${account.bg}`).join(',')
            + `#${snapshot.selectedXAccountIndex}`
          : '';
        if (renderedSignatures.xAccountSelect !== signature) {
          renderedSignatures.xAccountSelect = signature;
          accountSelect.innerHTML = snapshot.xAccounts.length > 1
            ? snapshot.xAccounts.map((account, accountIndex) => {
                const active = accountIndex === snapshot.selectedXAccountIndex;
                return `<button data-compose-action="select-x-account" data-compose-account-index="${accountIndex}"
                  style="display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;border:2px solid ${active ? 'var(--accent)' : 'var(--border2)'};background:${active ? 'var(--accent-dim)' : 'transparent'};color:${active ? 'var(--accent)' : 'var(--text2)'};cursor:pointer;font-family:inherit;font-size:12px;font-weight:600">
                  <span style="width:20px;height:20px;border-radius:50%;background:${escape(account.bg || 'var(--bg3)')};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#000">${escape(account.initials || 'X')}</span>
                  ${escape(account.username || '')}
                </button>`;
              }).join('')
            : '';
        }
        accountSelect.style.pointerEvents = snapshot.busy || snapshot.locked ? 'none' : '';
      }
      if (elements['x-cross-post-controls']) {
        elements['x-cross-post-controls'].style.display = snapshot.blueskyAccount ? 'flex' : 'none';
      }
      if (elements['x-cross-post-b']) {
        elements['x-cross-post-b'].checked = snapshot.crossPost;
        elements['x-cross-post-b'].disabled = !snapshot.crossPostAvailable || snapshot.busy || snapshot.locked;
      }
      if (elements['x-cross-post-note']) {
        const videoType = snapshot.media.video?.file?.type || '';
        elements['x-cross-post-note'].textContent = !snapshot.media.video
          ? ''
          : videoType && videoType !== 'video/mp4'
            ? 'Blueskyへの動画同時投稿はMP4のみ対応しています'
            : '同じトリム範囲の動画をBlueskyにも投稿します';
      }
      if (elements['x-post-av'] && snapshot.selectedAccount) {
        elements['x-post-av'].style.background = snapshot.selectedAccount.bg || '';
        elements['x-post-av'].innerHTML = `<span id="x-post-av-txt">${escape(snapshot.selectedAccount.initials || 'X')}</span>`;
      }
      if (elements['x-cta'] && elements['x-cta'].value !== snapshot.text) elements['x-cta'].value = snapshot.text;
      if (elements['x-cta']) elements['x-cta'].readOnly = snapshot.locked || snapshot.busy;
      if (elements['x-cct']) {
        elements['x-cct'].textContent = `${snapshot.characterCount} / ${snapshot.characterLimit}`;
        elements['x-cct'].className = 'cc' + (snapshot.characterCount > snapshot.characterLimit - 30 ? ' w' : '')
          + (snapshot.characterCount > snapshot.characterLimit ? ' over' : '');
      }
      if (elements['x-sndb']) {
        elements['x-sndb'].disabled = !snapshot.canSubmit;
        elements['x-sndb'].textContent = snapshot.actionLabel;
      }
      renderXMedia(snapshot);
      renderPreview(snapshot);
    }

    function renderXMedia(snapshot) {
      const { images, video } = snapshot.media;
      activeFiles.x = new Set([...images.map(image => image.file), ...(video ? [video.file] : [])]);
      const preview = elements['x-img-preview'];
      const imageFiles = images.map(image => image.file);
      const mediaChanged = !sameFiles(renderedMedia.x.images, imageFiles)
        || renderedMedia.x.video !== (video?.file || null);
      if (preview && mediaChanged) {
        preview.innerHTML = video
          ? `<div class="compose-file-row">
              <span class="compose-file-name">${escape(video.file?.name || '動画')}</span>
              <button class="compose-file-remove" data-compose-action="remove-video">削除</button>
            </div>`
          : images.map((image, imageIndex) => `
            <div class="compose-img-row">
              <img class="compose-img-thumb" src="${escape(objectUrl(image.file))}">
              <input id="x-alt-${imageIndex}" class="compose-alt-input" type="text" placeholder="画像の説明（Bluesky同時投稿に使用）" maxlength="1000"
                value="${escape(image.altText || '')}" data-compose-alt-network="x" data-compose-image-index="${imageIndex}">
              <button class="compose-img-remove" data-compose-action="remove-image" data-compose-network="x" data-compose-image-index="${imageIndex}">x</button>
            </div>`).join('');
      }
      syncAltInputs(preview, images);
      renderedMedia.x = { images: imageFiles, video: video?.file || null };
      if (elements['x-img-drop']) {
        elements['x-img-drop'].style.opacity = images.length >= 4 || video ? '0.4' : '1';
        elements['x-img-drop'].style.pointerEvents = video || snapshot.locked || snapshot.busy ? 'none' : '';
      }
      renderVideoControls('x', video, { crossPosting: snapshot.crossPost });
      releaseUnusedUrls();
    }

    function renderBluesky(snapshot) {
      if (elements['b-img-area']) {
        elements['b-img-area'].style.pointerEvents = snapshot.busy || snapshot.locked ? 'none' : '';
      }
      if (elements['cross-post-controls']) {
        elements['cross-post-controls'].style.display = snapshot.crossPostAvailable ? 'flex' : 'none';
      }
      if (elements['cross-post-x']) {
        elements['cross-post-x'].checked = snapshot.crossPost;
        elements['cross-post-x'].disabled = snapshot.busy || snapshot.locked;
      }
      if (elements['cross-post-x-account']) {
        const signature = snapshot.xAccounts.map(account => account.username || '').join(',');
        if (renderedSignatures.crossPostAccounts !== signature) {
          renderedSignatures.crossPostAccounts = signature;
          elements['cross-post-x-account'].innerHTML = snapshot.xAccounts.map((account, accountIndex) =>
            `<option value="${accountIndex}">${escape(account.username || '')}</option>`
          ).join('');
        }
        elements['cross-post-x-account'].value = String(snapshot.crossPostXAccountIndex || 0);
        elements['cross-post-x-account'].style.display = snapshot.crossPost ? 'block' : 'none';
        elements['cross-post-x-account'].disabled = snapshot.busy || snapshot.locked;
      }
      if (elements['b-cross-post-note']) {
        elements['b-cross-post-note'].textContent = snapshot.media.video
          ? '同じトリム範囲の動画をXにも投稿します'
          : '';
      }
      if (elements['cta'] && elements.cta.value !== snapshot.text) elements.cta.value = snapshot.text;
      if (elements.cta) {
        elements.cta.maxLength = snapshot.characterLimit;
        elements.cta.readOnly = snapshot.locked || snapshot.busy;
      }
      if (elements.cct) {
        elements.cct.textContent = `${snapshot.characterCount} / ${snapshot.characterLimit}`;
        elements.cct.className = 'cc' + (snapshot.characterCount > snapshot.characterLimit - 40 ? ' w' : '')
          + (snapshot.characterCount > snapshot.characterLimit ? ' over' : '');
      }
      if (elements.sndb) {
        elements.sndb.disabled = !snapshot.canSubmit;
        elements.sndb.textContent = snapshot.actionLabel;
      }
      if (elements['b-reply-preview']) {
        elements['b-reply-preview'].style.display = snapshot.reply ? 'flex' : 'none';
        elements['b-reply-preview'].innerHTML = snapshot.reply
          ? `<span style="color:var(--text2)">@${escape(snapshot.reply.handle || '')}</span> への返信`
          : '';
      }
      renderBlueskyMedia(snapshot);
      renderPreview(snapshot);
    }

    function renderBlueskyMedia(snapshot) {
      const { images, video } = snapshot.media;
      activeFiles.b = new Set([...images.map(image => image.file), ...(video ? [video.file] : [])]);
      const imageFiles = images.map(image => image.file);
      const mediaChanged = !sameFiles(renderedMedia.b.images, imageFiles)
        || renderedMedia.b.video !== (video?.file || null);
      if (elements['b-img-preview'] && mediaChanged) {
        elements['b-img-preview'].innerHTML = video
          ? `<div class="compose-file-row">
              <span class="compose-file-name">${escape(video.file?.name || '動画')}</span>
              <button class="compose-file-remove" data-compose-action="remove-video">削除</button>
            </div>`
          : images.map((image, imageIndex) => `
          <div class="compose-img-row">
            <img class="compose-img-thumb" src="${escape(objectUrl(image.file))}">
            <input id="b-alt-${imageIndex}" class="compose-alt-input" type="text" placeholder="Alt テキスト（画像の説明）" maxlength="1000"
              value="${escape(image.altText || '')}" data-compose-alt-network="b" data-compose-image-index="${imageIndex}">
            <button class="compose-img-remove" data-compose-action="remove-image" data-compose-network="b" data-compose-image-index="${imageIndex}">x</button>
          </div>`).join('');
      }
      syncAltInputs(elements['b-img-preview'], images);
      renderedMedia.b = { images: imageFiles, video: video?.file || null };
      if (elements['b-img-drop']) {
        elements['b-img-drop'].style.opacity = images.length >= 4 || video ? '0.4' : '1';
        elements['b-img-drop'].style.pointerEvents = video || snapshot.locked || snapshot.busy ? 'none' : '';
      }
      renderVideoControls('b', video, { crossPosting: snapshot.crossPost });
      releaseUnusedUrls();
    }

    function render(snapshot) {
      const modal = elements[modalId(snapshot.networkId)];
      modal?.setAttribute('aria-busy', String(snapshot.busy));
      if (snapshot.networkId === 'x') renderX(snapshot);
      else renderBluesky(snapshot);
    }

    function networkForModal(modal) {
      return modal === elements.xPostMod ? 'x' : 'b';
    }

    function onClick(event) {
      const networkId = networkForModal(event.currentTarget);
      if (event.target === event.currentTarget) {
        handlers.close?.(networkId);
        return;
      }
      const actionElement = event.target.closest?.('[data-compose-action]') || event.target;
      const action = actionElement.dataset?.composeAction
        || (actionElement.id === 'x-sndb' || actionElement.id === 'sndb' ? 'submit' : '');
      const video = elements[`${networkId}-video-preview`];
      const trim = renderedTrim[networkId];
      const timeline = event.target.closest?.('[data-compose-trim-timeline]')
        || (event.target.dataset?.composeTrimTimeline ? event.target : null);
      if (timeline && !/^[xb]-trim-(?:in|out)$/.test(event.target.id || '')) {
        const bounds = timeline.getBoundingClientRect?.();
        if (video && bounds?.width) {
          const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
          video.currentTime = ratio * (trim?.durationSeconds || video.duration || 0);
          updatePlayhead(networkId, video.currentTime);
        }
        return;
      }
      if (action === 'submit') handlers.submit?.(networkId);
      if (action === 'toggle-preview') handlers.togglePreview?.(networkId);
      if (action === 'pick-media') elements[networkId === 'x' ? 'x-img-file' : 'b-img-file']?.click?.();
      if (action === 'select-x-account') {
        handlers.selectXAccount?.(Number(actionElement.dataset.composeAccountIndex));
      }
      if (action === 'remove-image') {
        handlers.removeImage?.(
          actionElement.dataset.composeNetwork || networkId,
          Number(actionElement.dataset.composeImageIndex),
        );
      }
      if (action === 'remove-video') handlers.removeVideo?.(networkId);
      if (action === 'set-trim-edge' && video) {
        handlers.trimSecondsChanged?.(networkId, actionElement.dataset.trimEdge, video.currentTime || 0);
      }
      if (action === 'nudge-trim-edge' && trim) {
        const edge = actionElement.dataset.trimEdge;
        const current = edge === 'start' ? trim.startSeconds : trim.endSeconds;
        handlers.trimSecondsChanged?.(
          networkId,
          edge,
          current + Number(actionElement.dataset.trimDelta || 0),
        );
      }
      if (action === 'jump-trim-edge' && video && trim) {
        video.currentTime = actionElement.dataset.trimEdge === 'start'
          ? trim.startSeconds
          : trim.endSeconds;
        updatePlayhead(networkId, video.currentTime);
      }
      if (action === 'preview-trim' && video && trim) {
        video.currentTime = trim.startSeconds;
        trimPreviewActive[networkId] = true;
        updatePlayhead(networkId, video.currentTime);
        Promise.resolve(video.play?.()).catch(() => {});
      }
    }

    function onInput(event) {
      const target = event.target;
      if (target.id === 'x-cta') handlers.textChanged?.('x', target.value, event);
      if (target.id === 'cta') handlers.textChanged?.('b', target.value, event);
      if (target.dataset?.composeAltNetwork) {
        handlers.altChanged?.(
          target.dataset.composeAltNetwork,
          Number(target.dataset.composeImageIndex),
          target.value,
        );
      }
      if (/^[xb]-trim-(in|out)$/.test(target.id || '')) {
        const networkId = target.id.startsWith('x-') ? 'x' : 'b';
        const edge = target.id.endsWith('-in') ? 'start' : 'end';
        const snapshot = handlers.trimChanged?.(networkId, edge, target.value);
        const trim = snapshot?.media?.video?.trim;
        const video = elements[`${networkId}-video-preview`];
        if (video && trim) video.currentTime = edge === 'start' ? trim.startSeconds : trim.endSeconds;
      }
    }

    function onChange(event) {
      const target = event.target;
      if (target.id === 'x-cross-post-b') handlers.crossPostChanged?.('x', target.checked);
      if (target.id === 'cross-post-x') handlers.crossPostChanged?.('b', target.checked);
      if (target.id === 'cross-post-x-account') {
        handlers.selectCrossPostXAccount?.(Number(target.value));
      }
      if (target.id === 'x-img-file') handlers.filesAdded?.('x', target.files);
      if (target.id === 'b-img-file') handlers.filesAdded?.('b', target.files);
      if (target.id === 'x-img-file' || target.id === 'b-img-file') target.value = '';
      if (target.dataset?.composeTrimTime) {
        const networkId = target.id?.startsWith('b-') ? 'b' : 'x';
        const seconds = parseTrimTime(target.value);
        if (seconds == null) {
          const trim = renderedTrim[networkId];
          const edge = target.dataset.composeTrimTime;
          target.value = formatTrimTime(edge === 'start' ? trim?.startSeconds : trim?.endSeconds);
        } else {
          handlers.trimSecondsChanged?.(networkId, target.dataset.composeTrimTime, seconds);
        }
      }
    }

    function onDragOver(event) {
      const drop = event.target.closest?.('[data-compose-drop]');
      if (!drop) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      drop.classList.add('drag-on');
    }

    function onDragLeave(event) {
      event.target.closest?.('[data-compose-drop]')?.classList.remove('drag-on');
    }

    function onDrop(event) {
      const drop = event.target.closest?.('[data-compose-drop]');
      if (!drop) return;
      event.preventDefault();
      drop.classList.remove('drag-on');
      handlers.filesAdded?.(drop.dataset.composeDrop, event.dataTransfer?.files || []);
    }

    const modals = [elements.xPostMod, elements.compMod].filter(Boolean);
    modals.forEach(modal => {
      modal.addEventListener('click', onClick);
      modal.addEventListener('input', onInput);
      modal.addEventListener('change', onChange);
      modal.addEventListener('dragover', onDragOver);
      modal.addEventListener('dragleave', onDragLeave);
      modal.addEventListener('drop', onDrop);
    });
    const videoEventHandlers = ['x', 'b'].map(networkId => {
      const metadataHandler = () => handlers.videoMetadataLoaded?.(
        networkId,
        elements[`${networkId}-video-preview`]?.duration || 0,
      );
      const timeUpdateHandler = () => {
        const video = elements[`${networkId}-video-preview`];
        const trim = renderedTrim[networkId];
        if (!video || !trim) return;
        if (trimPreviewActive[networkId] && video.currentTime >= trim.endSeconds - 0.02) {
          if (elements[`${networkId}-trim-loop`]?.checked) {
            video.currentTime = trim.startSeconds;
            Promise.resolve(video.play?.()).catch(() => {});
          } else {
            video.currentTime = trim.endSeconds;
            video.pause?.();
            trimPreviewActive[networkId] = false;
          }
        }
        updatePlayhead(networkId, video.currentTime || 0);
      };
      const video = elements[`${networkId}-video-preview`];
      video?.addEventListener('loadedmetadata', metadataHandler);
      video?.addEventListener('timeupdate', timeUpdateHandler);
      return [networkId, metadataHandler, timeUpdateHandler];
    });

    return {
      connect(nextHandlers) { handlers = nextHandlers || {}; },
      dispose() {
        modals.forEach(modal => {
          modal.removeEventListener('click', onClick);
          modal.removeEventListener('input', onInput);
          modal.removeEventListener('change', onChange);
          modal.removeEventListener('dragover', onDragOver);
          modal.removeEventListener('dragleave', onDragLeave);
          modal.removeEventListener('drop', onDrop);
        });
        videoEventHandlers.forEach(([networkId, metadataHandler, timeUpdateHandler]) => {
          const video = elements[`${networkId}-video-preview`];
          video?.removeEventListener('loadedmetadata', metadataHandler);
          video?.removeEventListener('timeupdate', timeUpdateHandler);
        });
        for (const url of fileUrls.values()) urlApi.revokeObjectURL(url);
        fileUrls.clear();
        handlers = {};
      },
      render,
      setOpen,
    };
  }

  function createComposeModalRuntime({
    getAccounts = () => ({ x: [], b: null }),
    getPreferences = () => ({}),
    mediaDrafts = {},
    coordinator = {},
    view = {},
    intents = {},
  } = {}) {
    let disposed = false;
    let selectedXAccountIndex = 0;
    let crossPostXAccountIndex = 0;
    let openNetworkId = null;
    let reply = null;
    const busy = { x: false, b: false };
    const locked = { x: false, b: false };
    const actionLabels = { x: 'ポスト', b: '投稿' };
    const text = { x: '', b: '' };
    const crossPost = { x: false, b: false };
    const previewOpen = { x: false, b: false };

    function accounts() {
      const current = getAccounts() || {};
      return {
        x: Array.isArray(current.x) ? current.x : [],
        b: current.b || null,
      };
    }

    function getSnapshot(networkId = openNetworkId) {
      const currentAccounts = accounts();
      const media = mediaDrafts[networkId]?.getSnapshot?.() || { images: [], video: null };
      const crossPostVideoCompatible = mediaDrafts[networkId]?.validateVideo?.({
        allowedMimeTypes: ['video/mp4'],
      })?.valid !== false;
      const crossPostAvailable = networkId === 'x'
        ? Boolean(currentAccounts.b && crossPostVideoCompatible)
        : Boolean(currentAccounts.x.length > 0 && !reply);
      const crossPosting = crossPostAvailable && Boolean(crossPost[networkId]);
      const characterLimit = networkId === 'b' && !crossPosting ? 300 : 280;
      const characterCount = (text[networkId] || '').length;
      const hasAttachment = media.images.length > 0 || Boolean(media.video);
      return {
        networkId,
        open: openNetworkId === networkId,
        xAccounts: currentAccounts.x,
        blueskyAccount: currentAccounts.b,
        selectedXAccountIndex,
        selectedAccount: networkId === 'x'
          ? currentAccounts.x[selectedXAccountIndex] || null
          : currentAccounts.b,
        text: text[networkId] || '',
        crossPost: crossPosting,
        crossPostAvailable,
        crossPostXAccountIndex,
        crossPostXAccount: currentAccounts.x[crossPostXAccountIndex] || null,
        media,
        reply,
        busy: Boolean(busy[networkId]),
        locked: Boolean(locked[networkId]),
        actionLabel: actionLabels[networkId],
        characterCount,
        characterLimit,
        canSubmit: !busy[networkId]
          && characterCount <= characterLimit
          && (characterCount > 0 || hasAttachment),
        previewOpen: previewOpen[networkId],
        targets: networkId === 'x'
          ? ['X', ...(crossPosting ? ['Bluesky'] : [])]
          : ['Bluesky', ...(crossPosting ? ['X'] : [])],
      };
    }

    function open(networkId, { reply: nextReply = null } = {}) {
      if (disposed) return { status: 'ignored', detail: 'disposed' };
      if (!['x', 'b'].includes(networkId)) throw new Error('Unknown Compose network');
      const currentAccounts = accounts();
      if (selectedXAccountIndex >= currentAccounts.x.length) selectedXAccountIndex = 0;
      if (crossPostXAccountIndex >= currentAccounts.x.length) crossPostXAccountIndex = 0;
      reply = networkId === 'b' ? nextReply : null;
      const preferences = getPreferences() || {};
      crossPost[networkId] = Boolean(networkId === 'x'
        ? preferences.crossPostFromX
        : preferences.crossPostFromBluesky);
      coordinator.resetCrossPost?.();
      openNetworkId = networkId;
      view.setOpen?.(networkId, true);
      const snapshot = getSnapshot(networkId);
      view.render?.(snapshot);
      return snapshot;
    }

    function close(networkId) {
      if (coordinator.getStatus?.(networkId)?.isSending) {
        return { status: 'blocked', snapshot: getSnapshot(networkId) };
      }
      coordinator.reset?.(networkId);
      mediaDrafts[networkId]?.clear?.();
      busy[networkId] = false;
      locked[networkId] = false;
      actionLabels[networkId] = networkId === 'x' ? 'ポスト' : '投稿';
      text[networkId] = '';
      crossPost[networkId] = false;
      previewOpen[networkId] = false;
      if (networkId === 'b') reply = null;
      if (openNetworkId === networkId) openNetworkId = null;
      view.setOpen?.(networkId, false);
      intents.closed?.(networkId);
      const snapshot = getSnapshot(networkId);
      view.render?.(snapshot);
      return { status: 'closed', snapshot };
    }

    function setBusy(networkId, isBusy, label = null, options = {}) {
      busy[networkId] = Boolean(isBusy);
      if (typeof options.locked === 'boolean') locked[networkId] = options.locked;
      actionLabels[networkId] = label || (networkId === 'x' ? 'ポスト' : '投稿');
      const snapshot = getSnapshot(networkId);
      view.render?.(snapshot);
      return snapshot;
    }

    function publish(networkId) {
      const snapshot = getSnapshot(networkId);
      view.render?.(snapshot);
      return snapshot;
    }

    function textChanged(networkId, value, event) {
      text[networkId] = String(value || '');
      if (networkId === 'b') intents.onBlueskyTextInput?.(event);
      return publish(networkId);
    }

    function selectXAccount(accountIndex) {
      const currentAccounts = accounts();
      const nextIndex = Number(accountIndex);
      if (!Number.isInteger(nextIndex) || !currentAccounts.x[nextIndex]) return getSnapshot('x');
      selectedXAccountIndex = nextIndex;
      return publish('x');
    }

    function crossPostChanged(networkId, enabled) {
      coordinator.resetCrossPost?.();
      crossPost[networkId] = Boolean(enabled);
      intents.updatePreference?.(
        networkId === 'x' ? 'crossPostFromX' : 'crossPostFromBluesky',
        crossPost[networkId],
      );
      return publish(networkId);
    }

    function selectCrossPostXAccount(accountIndex) {
      const currentAccounts = accounts();
      const nextIndex = Number(accountIndex);
      if (!Number.isInteger(nextIndex) || !currentAccounts.x[nextIndex]) return getSnapshot('b');
      coordinator.resetCrossPost?.();
      crossPostXAccountIndex = nextIndex;
      return publish('b');
    }

    function togglePreview(networkId) {
      previewOpen[networkId] = !previewOpen[networkId];
      return publish(networkId);
    }

    function filesAdded(networkId, files) {
      const result = mediaDrafts[networkId]?.addFiles?.(files) || { status: 'ignored' };
      if (result.status === 'rejected') {
        const message = result.reason === 'mixed-media'
          ? '画像と動画を同時に添付できません'
          : result.reason === 'unsupported-video'
            ? 'Blueskyの動画投稿はMP4形式に対応しています'
          : networkId === 'x' ? '画像は最大4枚まで添付できます' : '画像は最大4枚まで';
        intents.toast?.(message);
      }
      publish(networkId);
      return result;
    }

    function altChanged(networkId, imageIndex, value) {
      mediaDrafts[networkId]?.updateAlt?.(Number(imageIndex), value);
      return publish(networkId);
    }

    function removeImage(networkId, imageIndex) {
      mediaDrafts[networkId]?.removeImage?.(Number(imageIndex));
      return publish(networkId);
    }

    function videoMetadataLoaded(networkId, durationSeconds) {
      mediaDrafts[networkId]?.setVideoDuration?.(durationSeconds);
      return publish(networkId);
    }

    function trimChanged(networkId, edge, value) {
      mediaDrafts[networkId]?.setTrimPercent?.(edge, value);
      return publish(networkId);
    }

    function trimSecondsChanged(networkId, edge, value) {
      mediaDrafts[networkId]?.setTrimSeconds?.(edge, value);
      return publish(networkId);
    }

    function removeVideo(networkId) {
      mediaDrafts[networkId]?.removeVideo?.();
      return publish(networkId);
    }

    function submit(networkId) {
      return intents.submit?.(networkId, getSnapshot(networkId));
    }

    function dispose() {
      if (disposed) return { status: 'disposed' };
      disposed = true;
      openNetworkId = null;
      view.dispose?.();
      view.connect?.(null);
      return { status: 'disposed' };
    }

    const runtime = {
      close,
      dispose,
      getSnapshot,
      open,
      setBusy,
    };
    view.connect?.({
      altChanged,
      close,
      crossPostChanged,
      filesAdded,
      removeImage,
      removeVideo,
      selectCrossPostXAccount,
      selectXAccount,
      submit,
      textChanged,
      togglePreview,
      trimChanged,
      trimSecondsChanged,
      videoMetadataLoaded,
    });
    return runtime;
  }

  global.SocialDeckComposeModalRuntime = {
    createComposeModalDomView,
    createComposeModalRuntime,
  };
})(window);
