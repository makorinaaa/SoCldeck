(function (global) {
  // Locates X's composer and any media attached to it. This function is
  // serialized into scripts injected into the X WebView, so it must stay
  // self-contained (no references to outer variables).
  function inspectXComposer(documentLike) {
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
    return { composer, media };
  }

  global.SocialDeckXComposerDom = { inspectXComposer };
})(window);
