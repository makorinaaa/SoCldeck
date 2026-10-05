(function (global) {
  const COMPOSER_WAIT_SCRIPT = `(async () => {
    for (let check = 0; check < 40; check += 1) {
      if (document.querySelector('[data-testid="tweetTextarea_0"]')) return true;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
  })()`;

  function createXComposeDelivery({
    createSubmissionScript,
    createPreparationScript,
    createConfirmationScript,
    readFileAsDataUrl,
    trimVideo = null,
    readFileBase64 = null,
    deleteTempFile = async () => {},
    setStatus = () => {},
  }) {
    async function execute(delivery, {
      webview,
      videoPath = null,
      videoDuration = 0,
    } = {}) {
      if (!webview) throw new Error('X compose delivery requires a WebView');
      // The page may still be loading (a refresh or a reset of the hidden page): wait for
      // X's composer instead of failing at once.
      const composerShown = await webview.executeJavaScript(COMPOSER_WAIT_SCRIPT).catch(() => false);
      if (composerShown === false) {
        throw new Error('Xの投稿欄が表示されませんでした。Xのページを確認して再試行してください');
      }
      const preparation = await webview.executeJavaScript(createPreparationScript());
      if (preparation.status !== 'ready') {
        throw new Error('Xの投稿欄を初期化できませんでした。Xカラムを確認して再試行してください');
      }

      if (delivery.video) {
        const trimStart = delivery.video.trim.startSeconds || 0;
        const trimEnd = delivery.video.trim.endSeconds || videoDuration;
        const needsTrim = Boolean(
          videoPath
          && trimVideo
          && readFileBase64
          && (trimStart > 0.001 || (videoDuration > 0 && trimEnd < videoDuration - 0.001))
        );
        let videoDataUrl;
        if (needsTrim) {
          setStatus('トリミング中…');
          const trimmedPath = await trimVideo(videoPath, trimStart, trimEnd, videoDuration);
          setStatus('読み込み中…');
          videoDataUrl = await readFileBase64(trimmedPath);
          await Promise.resolve(deleteTempFile(trimmedPath)).catch(() => {});
          setStatus('');
        } else {
          videoDataUrl = await readFileAsDataUrl(delivery.video.file);
        }
        await webview.executeJavaScript(createSubmissionScript({
          text: delivery.text,
          videoDataUrl,
        }));
      } else {
        const images = await Promise.all(delivery.imageFiles.map(async file => ({
          dataUrl: await readFileAsDataUrl(file),
          type: file.type,
          name: file.name,
        })));
        await webview.executeJavaScript(createSubmissionScript({
          text: delivery.text,
          images,
        }));
      }

      const confirmation = await webview.executeJavaScript(createConfirmationScript({
        hadText: Boolean(delivery.text),
        hadMedia: Boolean(delivery.video) || delivery.imageFiles.length > 0,
      }));
      if (confirmation.status === 'failed') {
        throw new Error(confirmation.message || 'X rejected the post');
      }
      return confirmation;
    }

    return { execute };
  }

  global.SocialDeckXComposeDelivery = {
    createXComposeDelivery,
  };
})(window);
