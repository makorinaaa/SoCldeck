(function (global) {
  function createComposeModalDomView({
    documentRef = global.document,
    urlApi = global.URL,
    ui = {},
    maxVideoSeconds = 140,
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
      'x-trim-dur-label', 'x-trim-highlight', 'x-ffmpeg-status', 'cross-post-controls',
      'cross-post-x', 'cross-post-x-account', 'comp-av', 'cta', 'cct', 'sndb',
      'b-compose-preview', 'b-img-area', 'b-img-preview', 'b-img-drop', 'b-img-file', 'b-reply-preview',
    ];
    ids.forEach(id => { elements[id] = documentRef.getElementById(id); });
    let handlers = {};
    const fileUrls = new Map();
    const activeFiles = { x: new Set(), b: new Set() };
    const renderedMedia = { x: { images: [], video: null }, b: { images: [] } };

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
      const imageCount = snapshot.media.images.length;
      const altCount = snapshot.media.images.filter(image => image.altText).length;
      const attachmentText = snapshot.networkId === 'x' && snapshot.media.video
        ? '動画 1本'
        : imageCount > 0 ? `画像 ${imageCount}枚 / ALT入力 ${altCount}枚` : '添付なし';
      preview.classList.toggle('on', snapshot.previewOpen);
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
        elements['x-cross-post-note'].textContent = snapshot.media.video ? '動画の同時投稿は未対応です' : '';
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
          ? `<div style="display:flex;align-items:center;gap:8px;padding:5px 9px;background:var(--bg3);border-radius:6px;font-size:11px;color:var(--text2);width:100%">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escape(video.file?.name || '動画')}</span>
              <button data-compose-action="remove-video" style="padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:10px">削除</button>
            </div>`
          : images.map((image, imageIndex) => `
            <div style="display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg3)">
              <img src="${escape(objectUrl(image.file))}" style="width:52px;height:52px;object-fit:cover;display:block;border-radius:4px;flex-shrink:0">
              <input id="x-alt-${imageIndex}" type="text" placeholder="画像の説明（Bluesky同時投稿に使用）" maxlength="1000"
                value="${escape(image.altText || '')}" data-compose-alt-network="x" data-compose-image-index="${imageIndex}"
                style="flex:1;min-width:0;background:transparent;border:none;color:var(--text2);font-family:inherit;font-size:11px;outline:none">
              <button data-compose-action="remove-image" data-compose-network="x" data-compose-image-index="${imageIndex}"
                style="width:18px;height:18px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;font-size:11px;line-height:1;padding:0">x</button>
            </div>`).join('');
      }
      syncAltInputs(preview, images);
      renderedMedia.x = { images: imageFiles, video: video?.file || null };
      if (elements['x-img-drop']) {
        elements['x-img-drop'].style.opacity = images.length >= 4 || video ? '0.4' : '1';
        elements['x-img-drop'].style.pointerEvents = video || snapshot.locked || snapshot.busy ? 'none' : '';
      }
      if (elements['x-video-wrap']) elements['x-video-wrap'].style.display = video ? 'block' : 'none';
      const videoElement = elements['x-video-preview'];
      if (videoElement) {
        if (video && videoElement.dataset.composeFileName !== video.file?.name) {
          videoElement.src = objectUrl(video.file);
          videoElement.dataset.composeFileName = video.file?.name || '';
        } else if (!video && videoElement.src) {
          videoElement.removeAttribute?.('src');
          videoElement.dataset.composeFileName = '';
          videoElement.load?.();
        }
      }
      if (video) {
        const duration = video.durationSeconds || 0;
        const startPercent = duration ? (video.trim.startSeconds / duration) * 100 : 0;
        const endPercent = duration ? (video.trim.endSeconds / duration) * 100 : 100;
        if (elements['x-trim-in']) elements['x-trim-in'].value = String(startPercent);
        if (elements['x-trim-out']) elements['x-trim-out'].value = String(endPercent);
        if (elements['x-trim-start-label']) elements['x-trim-start-label'].textContent = ui.formatSeconds?.(video.trim.startSeconds) || '';
        if (elements['x-trim-end-label']) elements['x-trim-end-label'].textContent = ui.formatSeconds?.(video.trim.endSeconds) || '';
        if (elements['x-trim-dur-label']) {
          elements['x-trim-dur-label'].textContent = ui.formatSeconds?.(video.trimDurationSeconds) || '';
          elements['x-trim-dur-label'].style.color = video.trimDurationSeconds > maxVideoSeconds
            ? 'var(--red)'
            : 'inherit';
        }
        if (elements['x-trim-highlight']) {
          elements['x-trim-highlight'].style.left = `${startPercent}%`;
          elements['x-trim-highlight'].style.width = `${Math.max(0, endPercent - startPercent)}%`;
        }
        if (elements['x-ffmpeg-status']) {
          elements['x-ffmpeg-status'].textContent = video.trimDurationSeconds > maxVideoSeconds
            ? `トリム後の長さが ${ui.formatSeconds?.(video.trimDurationSeconds) || video.trimDurationSeconds} です。2分20秒以内にしてください`
            : '';
        }
      } else if (elements['x-ffmpeg-status']) {
        elements['x-ffmpeg-status'].textContent = '';
      }
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
        elements['cross-post-x-account'].innerHTML = snapshot.xAccounts.map((account, accountIndex) =>
          `<option value="${accountIndex}">${escape(account.username || '')}</option>`
        ).join('');
        elements['cross-post-x-account'].value = String(snapshot.crossPostXAccountIndex || 0);
        elements['cross-post-x-account'].style.display = snapshot.crossPost ? 'block' : 'none';
        elements['cross-post-x-account'].disabled = snapshot.busy || snapshot.locked;
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
      const { images } = snapshot.media;
      activeFiles.b = new Set(images.map(image => image.file));
      const imageFiles = images.map(image => image.file);
      const mediaChanged = !sameFiles(renderedMedia.b.images, imageFiles);
      if (elements['b-img-preview'] && mediaChanged) {
        elements['b-img-preview'].innerHTML = images.map((image, imageIndex) => `
          <div style="position:relative;width:100%;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--bg3);margin-bottom:5px;border:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:8px;padding:5px 8px">
              <img src="${escape(objectUrl(image.file))}" style="width:52px;height:52px;object-fit:cover;border-radius:4px;flex-shrink:0">
              <input id="b-alt-${imageIndex}" type="text" placeholder="Alt テキスト（画像の説明）" maxlength="1000"
                value="${escape(image.altText || '')}" data-compose-alt-network="b" data-compose-image-index="${imageIndex}"
                style="flex:1;background:transparent;border:none;color:var(--text2);font-size:11px;font-family:inherit;outline:none;min-width:0">
              <button data-compose-action="remove-image" data-compose-network="b" data-compose-image-index="${imageIndex}"
                style="width:18px;height:18px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;font-size:10px;padding:0">x</button>
            </div>
          </div>`).join('');
      }
      syncAltInputs(elements['b-img-preview'], images);
      renderedMedia.b = { images: imageFiles };
      if (elements['b-img-drop']) {
        elements['b-img-drop'].style.opacity = images.length >= 4 ? '0.4' : '1';
        elements['b-img-drop'].style.pointerEvents = snapshot.locked || snapshot.busy ? 'none' : '';
      }
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
      if (action === 'remove-video') handlers.removeVideo?.();
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
      if (target.id === 'x-trim-in' || target.id === 'x-trim-out') {
        const edge = target.id === 'x-trim-in' ? 'start' : 'end';
        const snapshot = handlers.trimChanged?.(edge, target.value);
        const trim = snapshot?.media?.video?.trim;
        const video = elements['x-video-preview'];
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
    const onVideoMetadata = () => handlers.videoMetadataLoaded?.(elements['x-video-preview']?.duration || 0);
    elements['x-video-preview']?.addEventListener('loadedmetadata', onVideoMetadata);

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
        elements['x-video-preview']?.removeEventListener('loadedmetadata', onVideoMetadata);
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
      const crossPostAvailable = networkId === 'x'
        ? Boolean(currentAccounts.b && !media.video)
        : Boolean(currentAccounts.x.length > 0 && !reply);
      const crossPosting = crossPostAvailable && Boolean(crossPost[networkId]);
      const characterLimit = networkId === 'b' && !crossPosting ? 300 : 280;
      const characterCount = (text[networkId] || '').length;
      const hasAttachment = media.images.length > 0 || Boolean(networkId === 'x' && media.video);
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

    function videoMetadataLoaded(durationSeconds) {
      mediaDrafts.x?.setVideoDuration?.(durationSeconds);
      return publish('x');
    }

    function trimChanged(edge, value) {
      mediaDrafts.x?.setTrimPercent?.(edge, value);
      return publish('x');
    }

    function removeVideo() {
      mediaDrafts.x?.removeVideo?.();
      return publish('x');
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
      videoMetadataLoaded,
    });
    return runtime;
  }

  global.SocialDeckComposeModalRuntime = {
    createComposeModalDomView,
    createComposeModalRuntime,
  };
})(window);
