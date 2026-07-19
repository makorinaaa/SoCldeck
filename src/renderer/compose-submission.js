(function (global) {
  function createComposeSubmission({
    modalRuntime,
    coordinator,
    createRequest,
    adapters,
    createCrossPostPlan,
    mediaDrafts = {},
    executeXDelivery,
    getBlueskyAccount = () => null,
    getReplyTarget = () => null,
    maxVideoSeconds = { x: 140, b: 180 },
    formatSeconds = value => String(value),
    ui = {},
  } = {}) {
    if (!modalRuntime || !coordinator || typeof createRequest !== 'function'
      || !adapters || typeof createCrossPostPlan !== 'function'
      || typeof executeXDelivery !== 'function') {
      throw new Error('Compose Submission requires modal, coordinator, and adapter boundaries');
    }
    const toast = ui.toast || (() => {});
    const confirmDialog = ui.confirm || (() => true);
    const clearTrimStatus = ui.clearTrimStatus || (() => {});

    function crossPostVideoError(networkId) {
      const validation = mediaDrafts[networkId]?.validateVideo?.({
        allowedMimeTypes: ['video/mp4'],
        maxDurationSeconds: maxVideoSeconds.x,
        requirePath: true,
      }) || { valid: true };
      if (validation.valid) return null;
      if (validation.reason === 'unsupported-video') {
        return '動画の同時投稿はMP4形式に対応しています';
      }
      if (validation.reason === 'missing-path') {
        return '動画ファイルのパスを取得できないため同時投稿できません';
      }
      if (validation.reason === 'duration-limit') {
        return `動画が長すぎます（${formatSeconds(validation.durationSeconds)}）。同時投稿は2分20秒以内にしてください`;
      }
      return '動画を同時投稿できません';
    }

    function createSharedPlan({ text, media, xAccountId }) {
      return createCrossPostPlan({
        text,
        media,
        xAccountId,
        blueskyAccountId: getBlueskyAccount().did,
        createRequest,
        prepareDelivery: request => adapters.prepareComposeDelivery(request),
        prepareCompletion: request => adapters.prepareComposeCompletion(request),
      });
    }

    function describeCrossPostFailure(result) {
      const failures = result.results.filter(target => target.status !== 'succeeded');
      const networks = failures.map(target => target.id === 'x' ? 'X' : 'Bluesky').join(' / ');
      const reason = String(failures.find(target => target.error)?.error?.message || '').slice(0, 120);
      return {
        networks,
        message: `${networks}への投稿に失敗しました${reason ? `: ${reason}` : ''}`,
      };
    }

    async function submitShared(ownerNetworkId, plan) {
      const hasUnknown = coordinator.getStatus(ownerNetworkId).hasUnknownCross;
      let retryUnknown = false;
      if (hasUnknown) {
        retryUnknown = confirmDialog(
          '投稿先で未投稿であることを確認しましたか？\n再試行すると重複投稿になる可能性があります。'
        );
        if (!retryUnknown) return;
      }

      modalRuntime.setBusy(ownerNetworkId, true, 'X + Blueskyへ送信中...');
      const result = await coordinator.submitCrossPost([
        {
          id: 'x',
          request: plan.x.request,
          deliver: () => executeXDelivery(plan.x.delivery, plan.x.executionContext),
          completionPlan: plan.x.completionPlan,
        },
        {
          id: 'b',
          request: plan.bluesky.request,
          deliver: () => adapters.executeComposeDelivery(plan.bluesky.delivery),
          completionPlan: plan.bluesky.completionPlan,
        },
      ], { retryUnknown });
      modalRuntime.setBusy(ownerNetworkId, false, null);

      if (result.status === 'succeeded') {
        modalRuntime.close(ownerNetworkId);
        toast('XとBlueskyへ投稿しました');
        return;
      }

      modalRuntime.setBusy(
        ownerNetworkId,
        false,
        result.status === 'unknown' ? '確認後に再試行' : '失敗分を再試行',
        { locked: true },
      );
      const failure = describeCrossPostFailure(result);
      toast(result.status === 'unknown'
        ? `${failure.networks}の投稿結果を確認できませんでした`
        : failure.message);
    }

    async function submitXOriginCrossPost(text) {
      const compose = modalRuntime.getSnapshot('x');
      const account = compose.selectedAccount;
      if (!account) { toast('Xアカウントを選択してください'); return; }
      if (!getBlueskyAccount()) { toast('Bluesky にログインしていません'); return; }
      const videoError = crossPostVideoError('x');
      if (videoError) { toast(videoError); return; }
      const plan = createSharedPlan({
        text,
        media: compose.media,
        xAccountId: account.username || account.partition,
      });
      await submitShared('x', plan);
    }

    async function submitBlueskyOriginCrossPost(text) {
      const compose = modalRuntime.getSnapshot('b');
      const account = compose.crossPostXAccount;
      if (!account) { toast('Xアカウントを選択してください'); return; }
      const videoError = crossPostVideoError('b');
      if (videoError) { toast(videoError); return; }
      const plan = createSharedPlan({
        text,
        media: compose.media,
        xAccountId: account.username || account.partition,
      });
      await submitShared('b', plan);
    }

    async function submitX() {
      const compose = modalRuntime.getSnapshot('x');
      const media = compose.media;
      const crossPosting = compose.crossPost;
      const composeStatus = coordinator.getStatus('x');
      if (composeStatus.isSending) return;
      if (!crossPosting && composeStatus.hasUnknownSingle) {
        const confirmedMissing = confirmDialog(
          'X上で投稿されていないことを確認しましたか？\n再試行すると重複投稿になる可能性があります。'
        );
        if (!confirmedMissing) return;
      }
      const text = compose.text.trim();
      if (!text && media.images.length === 0 && !media.video) return;
      if (crossPosting) {
        await submitXOriginCrossPost(text);
        return;
      }

      const account = compose.selectedAccount;
      if (!account) { toast('Xアカウントを選択してください'); return; }

      if (media.video && media.video.trimDurationSeconds > maxVideoSeconds.x) {
        toast(`動画が長すぎます（${formatSeconds(media.video.trimDurationSeconds)}）。2分20秒以内にトリミングしてください`);
        return;
      }

      const request = createRequest({
        networkId: 'x',
        accountId: account.username || account.partition,
        text,
        images: media.images.map(image => ({ file: image.file })),
        video: media.video
          ? {
              file: media.video.file,
              trim: media.video.trim,
            }
          : null,
      });
      const delivery = adapters.prepareComposeDelivery(request);
      const completionPlan = adapters.prepareComposeCompletion(request);

      modalRuntime.setBusy('x', true, '送信中…');
      const result = await coordinator.submitSingle({
        networkId: 'x',
        request,
        deliver: () => executeXDelivery(delivery, {
          videoPath: media.video?.path || null,
          videoDuration: media.video?.durationSeconds || 0,
        }),
        completionPlan,
      });

      modalRuntime.setBusy('x', false, null);
      if (result.status === 'succeeded') {
        modalRuntime.close('x');
        return;
      }

      if (result.status === 'unknown') {
        modalRuntime.setBusy('x', false, '確認後に再試行');
        toast('投稿結果を確認できませんでした。X上で投稿状況を確認してください');
        return;
      }

      clearTrimStatus();
      modalRuntime.setBusy('x', false, '再試行');
      toast('X post error: ' + result.error.message);
    }

    async function submitBluesky() {
      const compose = modalRuntime.getSnapshot('b');
      const media = compose.media;
      if (coordinator.getStatus('b').isSending) return;
      const text = compose.text.trim();
      if (!text && media.images.length === 0 && !media.video) return;
      const blueskyAccount = getBlueskyAccount();
      if (!blueskyAccount) { toast('Bluesky にログインしていません'); return; }
      const replyTarget = getReplyTarget();
      if (!replyTarget && compose.crossPost) {
        await submitBlueskyOriginCrossPost(text);
        return;
      }

      if (media.video?.trimDurationSeconds > maxVideoSeconds.b) {
        toast(`動画が長すぎます（${formatSeconds(media.video.trimDurationSeconds)}）。3分以内にトリミングしてください`);
        return;
      }

      const request = createRequest({
        networkId: 'b',
        accountId: blueskyAccount.did,
        text,
        images: media.images,
        video: media.video
          ? {
              file: media.video.file,
              sourcePath: media.video.path,
              durationSeconds: media.video.durationSeconds,
              trim: media.video.trim,
            }
          : null,
        replyTo: replyTarget
          ? {
              root: {
                uri: replyTarget.rootUri || replyTarget.uri,
                cid: replyTarget.rootCid || replyTarget.cid,
              },
              parent: { uri: replyTarget.uri, cid: replyTarget.cid },
            }
          : null,
      });
      const delivery = adapters.prepareComposeDelivery(request);
      const completionPlan = adapters.prepareComposeCompletion(request);

      modalRuntime.setBusy('b', true, '送信中…');
      const result = await coordinator.submitSingle({
        networkId: 'b',
        request,
        deliver: () => adapters.executeComposeDelivery(delivery),
        completionPlan,
      });

      modalRuntime.setBusy('b', false, null);
      if (result.status === 'succeeded') {
        modalRuntime.close('b');
        return;
      }

      modalRuntime.setBusy('b', false, '再試行');
      toast(`Post error: ${result.error.message}`);
    }

    return {
      submit(networkId) {
        return networkId === 'x' ? submitX() : submitBluesky();
      },
      submitBluesky,
      submitX,
    };
  }

  global.SocialDeckComposeSubmission = { createComposeSubmission };
})(window);
