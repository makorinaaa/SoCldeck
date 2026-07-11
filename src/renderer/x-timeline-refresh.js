(function (global) {
  async function refreshFollowingTimeline({
    documentLike,
    schedule,
  }) {
    function wait(ms) {
      return new Promise(resolve => schedule(resolve, ms));
    }

    function normalizedText(element) {
      return (element?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function findTab(pattern) {
      return Array.from(documentLike.querySelectorAll('[role="tab"]'))
        .find(tab => pattern.test(normalizedText(tab)));
    }

    const scroller = documentLike.scrollingElement || documentLike.documentElement;
    const atTop = (scroller?.scrollTop || 0) < 60;
    const followingTab = findTab(/^(フォロー中|Following)$/i);
    const forYouTab = findTab(/^(おすすめ|For you)$/i);

    if (atTop && followingTab && forYouTab && followingTab.getAttribute('aria-selected') === 'true') {
      forYouTab.click();
      await wait(300);

      const refreshedFollowingTab = findTab(/^(フォロー中|Following)$/i);
      if (!refreshedFollowingTab) return 'tabs-missing';
      refreshedFollowingTab.click();
      await wait(500);
      return 'tab-toggled';
    }

    const banner = documentLike.querySelector('[data-testid$="-newTweetsButton"]')
      || Array.from(documentLike.querySelectorAll('[role="button"]')).find(button => (
        /新しいポスト|新しいツイート|Show .* posts?/i.test(normalizedText(button))
      ));
    if (banner) {
      banner.click();
      return 'clicked';
    }

    if (!atTop) return 'deferred';
    if (!followingTab || !forYouTab) return 'tabs-missing';
    return 'not-following';
  }

  function createRefreshScript() {
    return `(${refreshFollowingTimeline.toString()})({
      documentLike: document,
      schedule: setTimeout
    })`;
  }

  global.SocialDeckXTimelineRefresh = {
    refreshFollowingTimeline,
    createRefreshScript,
  };
})(window);
