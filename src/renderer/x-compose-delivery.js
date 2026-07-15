(function (global) {
  function createImageSubmissionScript({ text, images }) {
    return `
      (async () => {
        document.querySelectorAll('[data-testid="tweetTextarea_0"],[data-testid="tweetButtonInline"],[data-testid="toolBar"],[data-testid="tweetTextarea_0RichTextInputContainer"],[data-testid="tweetTextarea_0_label"]').forEach(el => {
          el.style.setProperty('display','block','important');
        });
        var ta0 = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (ta0) {
          var p = ta0.parentElement;
          while (p) { p.style.removeProperty('display'); p = p.parentElement; if (p && p.dataset && p.dataset.testid === 'primaryColumn') break; }
        }
        const box = document.querySelector('[data-testid="tweetTextarea_0"]')
                 || document.querySelector('[role="textbox"]');
        if (!box) throw new Error('投稿欄が見つかりません');
        box.style.setProperty('display','block','important');
        box.click(); box.focus();
        await new Promise(r => setTimeout(r, 300));

        ${text ? `
        const dt = new DataTransfer();
        dt.setData('text/plain', ${JSON.stringify(text)});
        box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        ` : ''}

        const imgs = ${JSON.stringify(images)};
        if (imgs.length > 0) {
          function b64toBlob(dataUrl, type) {
            const b64 = dataUrl.split(',')[1];
            const bytes = atob(b64);
            const arr = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
            return new Blob([arr], { type });
          }
          const files = imgs.map(img =>
            new File([b64toBlob(img.dataUrl, img.type)], img.name, { type: img.type })
          );
          const fileInput = document.querySelector('input[data-testid="fileInput"]')
                         || document.querySelector('input[accept*="image"][type="file"]');
          if (fileInput) {
            const transfer = new DataTransfer();
            files.forEach(file => transfer.items.add(file));
            Object.defineProperty(fileInput, 'files', { value: transfer.files, configurable: true });
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 2000));
          } else {
            const transfer = new DataTransfer();
            files.forEach(file => transfer.items.add(file));
            box.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
            box.dispatchEvent(new DragEvent('dragover',  { bubbles: true, dataTransfer: transfer }));
            box.dispatchEvent(new DragEvent('drop',      { bubbles: true, dataTransfer: transfer }));
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        const postBtn = document.querySelector('[data-testid="tweetButton"]')
                     || document.querySelector('[data-testid="tweetButtonInline"]');
        if (!postBtn) throw new Error('送信ボタンが見つかりません');
        let retries = 15;
        while (postBtn.disabled && retries-- > 0) await new Promise(r => setTimeout(r, 300));
        if (postBtn.disabled) throw new Error('送信ボタンを有効化できませんでした');
        box.setAttribute('data-sd-compose-submit', 'pending');
        postBtn.click();
        return 'ok';
      })()
    `;
  }

  function createVideoSubmissionScript({ text, videoDataUrl }) {
    return `
      (async () => {
        document.querySelectorAll('[data-testid="tweetTextarea_0"],[data-testid="tweetButtonInline"],[data-testid="toolBar"],[data-testid="tweetTextarea_0RichTextInputContainer"],[data-testid="tweetTextarea_0_label"]').forEach(el => {
          el.style.setProperty('display','block','important');
        });
        var ta0 = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (ta0) {
          var p = ta0.parentElement;
          while (p) { p.style.removeProperty('display'); p = p.parentElement; if (p && p.dataset && p.dataset.testid === 'primaryColumn') break; }
        }
        const box = document.querySelector('[data-testid="tweetTextarea_0"]')
                 || document.querySelector('[role="textbox"]');
        if (!box) throw new Error('投稿欄が見つかりません');
        box.style.setProperty('display','block','important');
        box.click(); box.focus();
        await new Promise(r => setTimeout(r, 300));

        ${text ? `
        const dt = new DataTransfer();
        dt.setData('text/plain', ${JSON.stringify(text)});
        box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        ` : ''}

        function b64toBlob(dataUrl, type) {
          const b64 = dataUrl.split(',')[1];
          const bytes = atob(b64);
          const arr = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
          return new Blob([arr], { type });
        }
        const videoFile = new File(
          [b64toBlob(${JSON.stringify(videoDataUrl)}, 'video/mp4')],
          'video.mp4', { type: 'video/mp4' }
        );
        const fileInput = document.querySelector('input[data-testid="fileInput"]')
                       || document.querySelector('input[accept*="video"][type="file"]')
                       || document.querySelector('input[accept*="image"][type="file"]');
        if (!fileInput) throw new Error('ファイル入力欄が見つかりません');
        const transfer = new DataTransfer();
        transfer.items.add(videoFile);
        Object.defineProperty(fileInput, 'files', { value: transfer.files, configurable: true });
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 3000));

        const postBtn = document.querySelector('[data-testid="tweetButton"]')
                     || document.querySelector('[data-testid="tweetButtonInline"]');
        if (!postBtn) throw new Error('送信ボタンが見つかりません');
        let retries = 20;
        while (postBtn.disabled && retries-- > 0) await new Promise(r => setTimeout(r, 500));
        if (postBtn.disabled) throw new Error('送信ボタンを有効化できませんでした');
        box.setAttribute('data-sd-compose-submit', 'pending');
        postBtn.click();
        return 'ok';
      })()
    `;
  }

  function createXComposeDelivery({
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
          && (trimStart > 0.5 || (videoDuration > 0 && trimEnd < videoDuration - 0.5))
        );
        let videoDataUrl;
        if (needsTrim) {
          setStatus('トリミング中…');
          const trimmedPath = await trimVideo(videoPath, trimStart, trimEnd);
          setStatus('読み込み中…');
          videoDataUrl = await readFileBase64(trimmedPath);
          await Promise.resolve(deleteTempFile(trimmedPath)).catch(() => {});
          setStatus('');
        } else {
          videoDataUrl = await readFileAsDataUrl(delivery.video.file);
        }
        await webview.executeJavaScript(createVideoSubmissionScript({
          text: delivery.text,
          videoDataUrl,
        }));
      } else {
        const images = await Promise.all(delivery.imageFiles.map(async file => ({
          dataUrl: await readFileAsDataUrl(file),
          type: file.type,
          name: file.name,
        })));
        await webview.executeJavaScript(createImageSubmissionScript({
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
