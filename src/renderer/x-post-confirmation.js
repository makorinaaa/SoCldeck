(function (global) {
  const ERROR_NOTICE = /something went wrong|try again|not sent|couldn['’]t send|failed|error|問題が発生|送信でき|再試行/i;

  async function confirmXPost({
    hadText,
    hadMedia,
    observe,
    schedule = setTimeout,
    intervalMs = 400,
    maxChecks = 1,
  }) {
    let mediaWasObserved = false;
    for (let check = 0; check < maxChecks; check += 1) {
      const observation = observe();
      const noticeText = String(observation.noticeText || '').trim();
      if (noticeText && ERROR_NOTICE.test(noticeText)) {
        return { status: 'failed', message: noticeText };
      }
      if (observation.mediaPresent) mediaWasObserved = true;
      const textCleared = !hadText || observation.composerEmpty;
      const mediaCleared = !hadMedia
        || observation.composerReplaced
        || (mediaWasObserved && !observation.mediaPresent);
      if (textCleared && mediaCleared) {
        return { status: 'succeeded', reason: 'content-cleared' };
      }
      if (check < maxChecks - 1) {
        await new Promise(resolve => schedule(resolve, intervalMs));
      }
    }
    return { status: 'unknown', reason: 'confirmation-timeout' };
  }

  function observeXPost(documentLike) {
    const noticeText = Array.from(documentLike.querySelectorAll('[data-testid="toast"],[role="alert"]'))
      .map(element => String(element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
    const composer = documentLike.querySelector('[data-testid="tweetTextarea_0"]');
    const pendingComposer = documentLike.querySelector('[data-sd-compose-submit="pending"]');
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
      noticeText,
      composerEmpty: !composer || !String(composer.textContent || '').trim(),
      composerReplaced: !pendingComposer,
      mediaPresent: !!media,
    };
  }

  function createConfirmationScript({
    hadText,
    hadMedia,
    intervalMs = 400,
    maxChecks = 25,
  }) {
    return `(function() {
      const ERROR_NOTICE = ${ERROR_NOTICE.toString()};
      return (${confirmXPost.toString()})({
        hadText: ${JSON.stringify(!!hadText)},
        hadMedia: ${JSON.stringify(!!hadMedia)},
        observe: function() { return (${observeXPost.toString()})(document); },
        schedule: setTimeout,
        intervalMs: ${JSON.stringify(intervalMs)},
        maxChecks: ${JSON.stringify(maxChecks)}
      });
    })()`;
  }

  global.SocialDeckXPostConfirmation = {
    confirmXPost,
    observeXPost,
    createConfirmationScript,
  };
})(window);
