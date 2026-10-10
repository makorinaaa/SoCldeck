(function (global) {
  const DRAFT_KEY_PREFIX = 'socialdeck_draft_v1_';

  function createComposeModalRuntime({
    getAccounts = () => ({ x: [], b: null }),
    getPreferences = () => ({}),
    mediaDrafts = {},
    coordinator = {},
    view = {},
    intents = {},
    storage = null,
  } = {}) {
    let disposed = false;
    let selectedXAccountIndex = 0;
    let crossPostXAccountIndex = 0;
    let openNetworkId = null;
    let reply = null;
    let xReply = null;
    const busy = { x: false, b: false };
    const locked = { x: false, b: false };
    const actionLabels = { x: 'ポスト', b: '投稿' };
    const text = { x: '', b: '' };
    const crossPost = { x: false, b: false };
    const previewOpen = { x: false, b: false };
    const initialized = { x: false, b: false };
    const reattachMedia = { x: false, b: false };
    const draftError = { x: false, b: false };
    const loadedKeys = { x: null, b: null };
    const sessionDrafts = new Map();
    const deliveryAccounts = { x: null, b: null };

    function targetAccounts(networkId) {
      const current = accounts();
      const x = current.x[networkId === 'x' ? selectedXAccountIndex : crossPostXAccountIndex];
      return { x: x?.partition || x?.username || null, b: current.b?.did || null };
    }

    function draftKey(networkId) {
      const account = accounts();
      const owner = networkId === 'x'
        ? account.x[selectedXAccountIndex]?.partition || account.x[selectedXAccountIndex]?.username
        : account.b?.did;
      return owner ? `${DRAFT_KEY_PREFIX}${networkId}_${owner}` : null;
    }

    function saveDraft(networkId) {
      const key = loadedKeys[networkId] || draftKey(networkId);
      if (!key) return;
      try {
        const media = mediaDrafts[networkId]?.getSnapshot?.();
        let results = locked[networkId] || busy[networkId] ? coordinator.getStatus?.(networkId)?.crossPost?.targets || [] : [];
        if (busy[networkId] && crossPost[networkId] && !results.length) results = ['x', 'b'].map(id => ({ id, status: 'unknown' }));
        const draft = { text: text[networkId], reply: networkId === 'b' ? reply : xReply,
          crossPost: crossPost[networkId], crossPostXAccountIndex,
          deliveryAccounts: deliveryAccounts[networkId],
          results: results.map(target => ({ id: target.id, status: busy[networkId] && target.status !== 'succeeded' ? 'unknown' : target.status, error: target.error ? { message: target.error.message } : null })),
          hasMedia: Boolean(media?.images?.length || media?.video || reattachMedia[networkId]) };
        sessionDrafts.set(key, { ...draft, media });
        storage?.setItem(key, JSON.stringify(draft));
        draftError[networkId] = false;
      } catch { draftError[networkId] = true; }
    }

    function restoreDraft(networkId) {
      if (initialized[networkId]) return;
      initialized[networkId] = true;
      loadedKeys[networkId] = draftKey(networkId);
      try {
        const cached = sessionDrafts.get(draftKey(networkId));
        const draft = cached || JSON.parse(storage?.getItem(draftKey(networkId)) || 'null');
        if (!draft || typeof draft.text !== 'string') return;
        text[networkId] = draft.text;
        if (networkId === 'b') reply = draft.reply || null;
        else xReply = draft.reply || null;
        reattachMedia[networkId] = draft.hasMedia === true
          && !(cached?.media?.images?.length || cached?.media?.video);
        if (cached?.media) {
          const media = mediaDrafts[networkId];
          const images = cached.media.images || [];
          if (images.length) {
            media?.addFiles?.(images.map(image => image.file));
            images.forEach((image, index) => media?.updateAlt?.(index, image.altText || ''));
          }
          const video = cached.media.video;
          if (video) {
            media?.addFiles?.([video.file]);
            media?.setVideoDuration?.(video.durationSeconds);
            media?.setTrimSeconds?.('start', video.trim?.startSeconds || 0);
            media?.setTrimSeconds?.('end', video.trim?.endSeconds || video.durationSeconds);
          }
        }
        if (Array.isArray(draft.results) && draft.results.length) {
          coordinator.restoreCrossPost?.(draft.results);
          crossPost[networkId] = Boolean(draft.crossPost);
          crossPostXAccountIndex = Number.isInteger(draft.crossPostXAccountIndex) ? draft.crossPostXAccountIndex : 0;
          locked[networkId] = true;
          deliveryAccounts[networkId] = draft.deliveryAccounts || null;
          if (networkId === 'b' && deliveryAccounts[networkId]?.x) {
            const index = accounts().x.findIndex(account => (account.partition || account.username) === deliveryAccounts[networkId].x);
            if (index >= 0) crossPostXAccountIndex = index;
          }
          actionLabels[networkId] = '未完了の投稿先を再試行';
        }
      } catch { /* Invalid or unavailable storage must not prevent composing. */ }
    }

    function resetDraft(networkId) {
      if (!busy[networkId]) coordinator.reset?.(networkId);
      mediaDrafts[networkId]?.clear?.();
      text[networkId] = '';
      if (networkId === 'b') reply = null;
      else xReply = null;
      locked[networkId] = false;
      reattachMedia[networkId] = false;
      deliveryAccounts[networkId] = null;
      actionLabels[networkId] = networkId === 'x' ? 'ポスト' : '投稿';
      initialized[networkId] = false;
      loadedKeys[networkId] = null;
      if (openNetworkId === networkId) {
        openNetworkId = null;
        view.setOpen?.(networkId, false);
        intents.closed?.(networkId);
      }
    }

    function removeStoredDraft(key) {
      sessionDrafts.delete(key);
      try { storage?.removeItem?.(key); } catch { /* Unavailable storage has nothing left to leak. */ }
    }

    // 削除したアカウントの partition は次に追加するアカウントへ再利用されるため、下書きを残さない
    function forgetXAccount(account) {
      const keys = [account?.partition, account?.username].filter(Boolean)
        .map(owner => `${DRAFT_KEY_PREFIX}x_${owner}`);
      keys.forEach(removeStoredDraft);
      if (keys.includes(loadedKeys.x)) resetDraft('x');
    }

    function forgetAllDrafts() {
      sessionDrafts.clear();
      try {
        const keys = [];
        for (let index = 0; index < (storage?.length || 0); index++) {
          const key = storage.key(index);
          if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
        }
        keys.forEach(key => storage.removeItem(key));
      } catch { /* Unavailable storage has nothing left to leak. */ }
      resetDraft('x');
      resetDraft('b');
    }

    function accounts() {
      const current = getAccounts() || {};
      return {
        x: Array.isArray(current.x) ? current.x : [],
        b: current.b || null,
      };
    }

    function getSnapshot(networkId = openNetworkId) {
      const currentAccounts = accounts();
      const accountMismatch = locked[networkId] && deliveryAccounts[networkId]
        && JSON.stringify(deliveryAccounts[networkId]) !== JSON.stringify(targetAccounts(networkId));
      const media = mediaDrafts[networkId]?.getSnapshot?.() || { images: [], video: null };
      const crossPostVideoCompatible = mediaDrafts[networkId]?.validateVideo?.({
        allowedMimeTypes: ['video/mp4'],
      })?.valid !== false;
      const crossPostAvailable = networkId === 'x'
        ? Boolean(currentAccounts.b && crossPostVideoCompatible && !xReply)
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
        reply: networkId === 'x' ? xReply : reply,
        busy: Boolean(busy[networkId]),
        locked: Boolean(locked[networkId]),
        draftError: draftError[networkId],
        reattachMedia: reattachMedia[networkId],
        accountMismatch,
        deliveryResults: coordinator.getStatus?.(networkId)?.crossPost?.targets || [],
        actionLabel: actionLabels[networkId],
        characterCount,
        characterLimit,
        canSubmit: !busy[networkId] && !reattachMedia[networkId] && !accountMismatch
          && characterCount <= characterLimit
          && (characterCount > 0 || hasAttachment),
        previewOpen: previewOpen[networkId],
        targets: networkId === 'x'
          ? ['X', ...(crossPosting ? ['Bluesky'] : [])]
          : ['Bluesky', ...(crossPosting ? ['X'] : [])],
      };
    }

    function open(networkId, { reply: nextReply = null, accountIndex = null, appendText = '' } = {}) {
      if (disposed) return { status: 'ignored', detail: 'disposed' };
      if (!['x', 'b'].includes(networkId)) throw new Error('Unknown Compose network');
      const other = networkId === 'x' ? 'b' : 'x';
      if (locked[other] || busy[other]) {
        intents.toast?.('もう一方の投稿画面で、未完了の投稿を再試行するか下書きを削除してください');
        return { status: 'blocked' };
      }
      const currentAccounts = accounts();
      // Replies and quotes from a native X Column are sent from that Column's account.
      if (networkId === 'x' && Number.isInteger(accountIndex) && currentAccounts.x[accountIndex]
        && accountIndex !== selectedXAccountIndex) {
        if (busy.x || locked.x) {
          intents.toast?.('未完了の投稿を再試行するか下書きを削除してください');
          return { status: 'blocked' };
        }
        if (initialized.x) saveDraft('x');
        selectedXAccountIndex = accountIndex;
      }
      if (selectedXAccountIndex >= currentAccounts.x.length) selectedXAccountIndex = 0;
      if (crossPostXAccountIndex >= currentAccounts.x.length) crossPostXAccountIndex = 0;
      if (initialized[networkId] && loadedKeys[networkId] !== draftKey(networkId)) {
        text[networkId] = '';
        mediaDrafts[networkId]?.clear?.();
        if (networkId === 'b') reply = null;
        else xReply = null;
        initialized[networkId] = false;
        reattachMedia[networkId] = false;
        locked[networkId] = false;
      }
      restoreDraft(networkId);
      if (networkId === 'b' && nextReply && JSON.stringify(nextReply) !== JSON.stringify(reply)) {
        if (locked.b || busy.b) {
          intents.toast?.('未完了の投稿を再試行するか下書きを削除してから返信してください');
          return { status: 'blocked' };
        }
        if (text.b && intents.confirm?.('書きかけの下書きの返信先を変更しますか？') === false) return { status: 'cancelled' };
        reply = nextReply;
      }
      if (networkId === 'x' && nextReply && JSON.stringify(nextReply) !== JSON.stringify(xReply)) {
        if (locked.x || busy.x) {
          intents.toast?.('未完了の投稿を再試行するか下書きを削除してから返信してください');
          return { status: 'blocked' };
        }
        if (text.x && intents.confirm?.('書きかけの下書きの返信先を変更しますか？') === false) return { status: 'cancelled' };
        xReply = nextReply;
      }
      if (networkId === 'x' && appendText && !locked.x && !busy.x && !text.x.includes(appendText)) {
        text.x = text.x ? `${text.x.replace(/\s+$/, '')} ${appendText}` : ` ${appendText}`;
      }
      const preferences = getPreferences() || {};
      if (!locked[networkId]) crossPost[networkId] = Boolean(networkId === 'x'
        ? preferences.crossPostFromX
        : preferences.crossPostFromBluesky);
      if (!locked[networkId]) coordinator.resetCrossPost?.();
      openNetworkId = networkId;
      view.setOpen?.(networkId, true);
      saveDraft(networkId);
      const snapshot = getSnapshot(networkId);
      view.render?.(snapshot);
      return snapshot;
    }

    function close(networkId, { discard = false } = {}) {
      if (coordinator.getStatus?.(networkId)?.isSending) {
        return { status: 'blocked', snapshot: getSnapshot(networkId) };
      }
      if (!discard) {
        saveDraft(networkId);
        if (openNetworkId === networkId) openNetworkId = null;
        view.setOpen?.(networkId, false);
        intents.closed?.(networkId);
        return { status: 'closed', snapshot: getSnapshot(networkId) };
      }
      coordinator.reset?.(networkId);
      mediaDrafts[networkId]?.clear?.();
      busy[networkId] = false;
      locked[networkId] = false;
      deliveryAccounts[networkId] = null;
      actionLabels[networkId] = networkId === 'x' ? 'ポスト' : '投稿';
      text[networkId] = '';
      reattachMedia[networkId] = false;
      crossPost[networkId] = false;
      previewOpen[networkId] = false;
      if (networkId === 'b') reply = null;
      else xReply = null;
      saveDraft(networkId);
      if (openNetworkId === networkId) openNetworkId = null;
      view.setOpen?.(networkId, false);
      intents.closed?.(networkId);
      const snapshot = getSnapshot(networkId);
      view.render?.(snapshot);
      return { status: 'closed', snapshot };
    }

    function setBusy(networkId, isBusy, label = null, options = {}) {
      if (isBusy && !busy[networkId] && !locked[networkId]) deliveryAccounts[networkId] = targetAccounts(networkId);
      busy[networkId] = Boolean(isBusy);
      if (typeof options.locked === 'boolean') locked[networkId] = options.locked;
      actionLabels[networkId] = label || (networkId === 'x' ? 'ポスト' : '投稿');
      saveDraft(networkId);
      const snapshot = getSnapshot(networkId);
      view.render?.(snapshot);
      return snapshot;
    }

    function publish(networkId) {
      saveDraft(networkId);
      const snapshot = getSnapshot(networkId);
      view.render?.(snapshot);
      return snapshot;
    }

    function textChanged(networkId, value, event) {
      if (busy[networkId] || locked[networkId]) return getSnapshot(networkId);
      text[networkId] = String(value || '');
      if (networkId === 'b') intents.onBlueskyTextInput?.(event);
      return publish(networkId);
    }

    function selectXAccount(accountIndex) {
      if (busy.x || locked.x) return getSnapshot('x');
      const currentAccounts = accounts();
      const nextIndex = Number(accountIndex);
      if (!Number.isInteger(nextIndex) || !currentAccounts.x[nextIndex]) return getSnapshot('x');
      saveDraft('x');
      selectedXAccountIndex = nextIndex;
      deliveryAccounts.x = null;
      text.x = '';
      mediaDrafts.x?.clear?.();
      initialized.x = false;
      reattachMedia.x = false;
      restoreDraft('x');
      return publish('x');
    }

    function crossPostChanged(networkId, enabled) {
      if (busy[networkId] || locked[networkId]) return getSnapshot(networkId);
      coordinator.resetCrossPost?.();
      crossPost[networkId] = Boolean(enabled);
      intents.updatePreference?.(
        networkId === 'x' ? 'crossPostFromX' : 'crossPostFromBluesky',
        crossPost[networkId],
      );
      return publish(networkId);
    }

    function selectCrossPostXAccount(accountIndex) {
      if (busy.b || locked.b) return getSnapshot('b');
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
      if (busy[networkId] || (locked[networkId] && !reattachMedia[networkId])) return { status: 'ignored' };
      const result = mediaDrafts[networkId]?.addFiles?.(files) || { status: 'ignored' };
      if (result.status === 'rejected') {
        const message = result.reason === 'mixed-media'
          ? '画像と動画を同時に添付できません'
          : result.reason === 'unsupported-video'
            ? 'Blueskyの動画投稿はMP4形式に対応しています'
          : networkId === 'x' ? '画像は最大4枚まで添付できます' : '画像は最大4枚まで';
        intents.toast?.(message);
      }
      const media = mediaDrafts[networkId]?.getSnapshot?.();
      if (media?.images?.length || media?.video) reattachMedia[networkId] = false;
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
      if (!getSnapshot(networkId).canSubmit) return;
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
      forgetAllDrafts,
      forgetXAccount,
      getSnapshot,
      open,
      setBusy,
    };
    view.connect?.({
      discard: networkId => {
        if (busy[networkId]) return;
        if (intents.confirm?.('この下書きを削除しますか？') === false) return;
        return close(networkId, { discard: true });
      },
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

  global.SocialDeckComposeModalRuntime = { createComposeModalRuntime };
})(window);
