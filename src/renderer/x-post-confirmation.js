(function (global) {
  const ERROR_NOTICE = /something went wrong|try again|not sent|couldn['’]t send|failed|error|問題が発生|送信でき|再試行/i;
  // アカウントの回数制限・投稿の上限・自動化の疑い・本人確認・ロックの通知。見つけたら、そのアカウントの
  // X の自動操作を止める。「返信が制限されています」のような投稿ごとの制限は含めない
  const LIMIT_NOTICE = /rate limit|daily limit|over the limit|reached your limit|too many requests|unusual activity|might be automated|appears to be automated|automated behavior|verify your (?:account|identity)|account (?:is|has been) (?:temporarily )?locked|上限に達|上限を超え|一時的に制限|不審なアクティビティ|自動化され|自動化と思われ|本人確認|アカウントはロック|ロックされ/i;

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
      if (noticeText && LIMIT_NOTICE.test(noticeText)) {
        return { status: 'failed', message: noticeText, limited: true };
      }
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

  function observeXPost(documentLike, inspectXComposer) {
    const noticeText = Array.from(documentLike.querySelectorAll('[data-testid="toast"],[role="alert"]'))
      .map(element => String(element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
    const { composer, media } = inspectXComposer(documentLike);
    const pendingComposer = documentLike.querySelector('[data-sd-compose-submit="pending"]');

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
      const LIMIT_NOTICE = ${LIMIT_NOTICE.toString()};
      return (${confirmXPost.toString()})({
        hadText: ${JSON.stringify(!!hadText)},
        hadMedia: ${JSON.stringify(!!hadMedia)},
        observe: function() { return (${observeXPost.toString()})(document, ${global.SocialDeckXComposerDom.inspectXComposer.toString()}); },
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
