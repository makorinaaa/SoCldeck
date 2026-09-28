// Serialized into the guest page: this function must be self-contained.
async function submitXComposer({ text, images = [], videoDataUrl = null, timeoutMs = 120000, intervalMs = 200 }) {
  const boxSelector = '[data-testid="tweetTextarea_0"]';
  const buttonSelector = '[data-testid="tweetButton"],[data-testid="tweetButtonInline"]';
  const box = document.querySelector(boxSelector);
  if (!box) throw new Error('投稿欄が見つかりません');
  let scope = box.parentElement;
  while (scope && !scope.querySelector('[data-testid="toolBar"]')) scope = scope.parentElement;
  if (!scope || scope === document.body || scope === document.documentElement) {
    throw new Error('投稿欄の範囲を確認できませんでした');
  }
  scope.querySelectorAll(`${boxSelector},${buttonSelector},[data-testid="toolBar"],[data-testid="tweetTextarea_0RichTextInputContainer"],[data-testid="tweetTextarea_0_label"]`).forEach(el => {
    el.style.setProperty('display', 'block', 'important');
  });
  let parent = box;
  while (parent && parent !== scope.parentElement) {
    // Override SocialDeck's home-composer hiding stylesheet, including wrappers.
    parent.style.setProperty('display', 'block', 'important');
    parent = parent.parentElement;
  }
  box.click();
  box.focus();
  const deadline = Date.now() + timeoutMs;
  async function waitFor(check, message) {
    while (true) {
      if (!box.isConnected || !scope.isConnected) throw new Error('投稿欄が閉じられました');
      const error = scope.querySelector('[role="alert"]');
      if (error?.textContent?.trim()) throw new Error(error.textContent.trim());
      if (check()) return;
      if (Date.now() >= deadline) throw new Error(message);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  if (text) {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', text);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
    await waitFor(() => box.textContent.replace(/\r\n/g, '\n').trim() === text.replace(/\r\n/g, '\n').trim(),
      '投稿本文の反映を確認できませんでした');
  }
  const attachments = videoDataUrl
    ? [{ dataUrl: videoDataUrl, type: 'video/mp4', name: 'video.mp4' }]
    : images;
  if (attachments.length) {
    const transfer = new DataTransfer();
    attachments.forEach(attachment => {
      const bytes = Uint8Array.from(atob(attachment.dataUrl.split(',')[1]), char => char.charCodeAt(0));
      transfer.items.add(new File([bytes], attachment.name, { type: attachment.type }));
    });
    const input = scope.querySelector('input[data-testid="fileInput"],input[type="file"][accept*="image"],input[type="file"][accept*="video"]');
    if (input) {
      Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (!videoDataUrl) {
      for (const type of ['dragenter', 'dragover', 'drop']) {
        box.dispatchEvent(new DragEvent(type, { bubbles: true, dataTransfer: transfer }));
      }
    } else {
      throw new Error('ファイル入力欄が見つかりません');
    }
  }
  function isReady() {
    // Only media within this composer counts, never timeline media.
    const attached = videoDataUrl
      ? Boolean(scope.querySelector('[data-testid="attachments"] [data-testid="videoPlayer"], [data-testid="attachments"] video'))
      : scope.querySelectorAll('[data-testid="attachments"] [data-testid="tweetPhoto"]').length === images.length;
    const busy = scope.querySelector('[role="progressbar"], [aria-busy="true"]');
    const button = scope.querySelector(buttonSelector);
    return (!attachments.length || attached) && !busy && button
      && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  }
  await waitFor(isReady, '添付の完了または送信可能な状態を確認できませんでした。Xの投稿欄を確認してください');
  box.setAttribute('data-sd-compose-submit', 'pending');
  scope.querySelector(buttonSelector).click();
  return 'ok';
}

function createSubmissionScript(input) {
  return `(${submitXComposer.toString()})(${JSON.stringify(input)})`;
}


export { createSubmissionScript };
