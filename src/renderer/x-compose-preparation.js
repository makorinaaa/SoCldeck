(function (global) {
  async function prepareXComposer({
    observe,
    clearText,
    removeMedia,
    schedule = setTimeout,
    intervalMs = 200,
    maxChecks = 1,
  }) {
    let observation = observe();
    if (!observation.composerFound) {
      return { status: 'blocked', reason: 'composer-missing' };
    }

    if (!observation.textEmpty) clearText();
    if (observation.mediaPresent) removeMedia();

    for (let check = 0; check < maxChecks; check += 1) {
      if (observation.textEmpty && !observation.mediaPresent) {
        return { status: 'ready' };
      }
      if (check < maxChecks - 1) {
        await new Promise(resolve => schedule(resolve, intervalMs));
        observation = observe();
      }
    }

    return { status: 'blocked', reason: 'cleanup-timeout' };
  }

  function observeXComposer(documentLike) {
    const composer = documentLike.querySelector('[data-testid="tweetTextarea_0"]');
    // タイムライン上の動画ポストを添付と誤検知しないよう、
    // 投稿欄とツールバーを含む最近接祖先だけをメディア検査の対象にする
    let scope = composer ? composer.parentElement : null;
    while (scope && !scope.querySelector?.('[data-testid="toolBar"]')) {
      scope = scope.parentElement;
    }
    if (!scope && composer) scope = composer.parentElement;
    const media = scope
      ? scope.querySelector([
        '[data-testid="attachments"]',
        '[data-testid="videoPlayer"]',
        'button[aria-label*="Remove media"]',
        'button[aria-label*="メディアを削除"]',
      ].join(','))
      : null;
    return {
      composerFound: !!composer,
      textEmpty: !composer || !String(composer.textContent || '').trim(),
      mediaPresent: !!media,
    };
  }

  function clearXComposerText(documentLike, windowLike) {
    const composer = documentLike.querySelector('[data-testid="tweetTextarea_0"]');
    if (!composer) return;
    composer.style?.setProperty('display', 'block', 'important');
    let parent = composer.parentElement;
    while (parent) {
      parent.style?.removeProperty('display');
      if (parent.dataset?.testid === 'primaryColumn') break;
      parent = parent.parentElement;
    }
    composer.focus();
    const selection = windowLike.getSelection();
    const range = documentLike.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
    if (typeof documentLike.execCommand === 'function') {
      documentLike.execCommand('delete', false, null);
    }
    composer.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward',
    }));
  }

  function removeXComposerMedia(documentLike) {
    const selector = [
      'button[aria-label*="Remove media"]',
      'button[aria-label*="メディアを削除"]',
    ].join(',');
    Array.from(documentLike.querySelectorAll(selector)).forEach(button => button.click());
  }

  function createPreparationScript({ intervalMs = 200, maxChecks = 10 } = {}) {
    return `(async function() {
      const result = await (${prepareXComposer.toString()})({
        observe: function() { return (${observeXComposer.toString()})(document); },
        clearText: function() { return (${clearXComposerText.toString()})(document, window); },
        removeMedia: function() { return (${removeXComposerMedia.toString()})(document); },
        schedule: setTimeout,
        intervalMs: ${JSON.stringify(intervalMs)},
        maxChecks: ${JSON.stringify(maxChecks)}
      });
      if (result.status === 'ready') {
        document.querySelector('[data-testid="tweetTextarea_0"]')
          ?.removeAttribute('data-sd-compose-submit');
      }
      return result;
    })()`;
  }

  global.SocialDeckXComposePreparation = {
    prepareXComposer,
    observeXComposer,
    createPreparationScript,
  };
})(window);
