(function (global) {
  async function refreshFollowingTimeline({
    documentLike,
    schedule,
    scrollTo,
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

    const banner = documentLike.querySelector('[data-testid$="-newTweetsButton"]')
      || Array.from(documentLike.querySelectorAll('[role="button"]')).find(button => (
        /新しいポスト|新しいツイート|Show .* posts?/i.test(normalizedText(button))
      ));
    const scroller = documentLike.scrollingElement || documentLike.documentElement;
    const atTop = (scroller?.scrollTop || 0) < 60;

    if (banner) {
      banner.click();
      if (atTop) {
        await wait(150);
        scrollTo({ top: 0, behavior: 'auto' });
      }
      return 'clicked';
    }

    if (!atTop) return 'deferred';

    const followingTab = findTab(/^(フォロー中|Following)$/i);
    const forYouTab = findTab(/^(おすすめ|For you)$/i);
    if (!followingTab || !forYouTab) return 'tabs-missing';
    if (followingTab.getAttribute('aria-selected') !== 'true') return 'not-following';

    forYouTab.click();
    await wait(300);

    const refreshedFollowingTab = findTab(/^(フォロー中|Following)$/i);
    if (!refreshedFollowingTab) return 'tabs-missing';
    refreshedFollowingTab.click();
    await wait(500);
    scrollTo({ top: 0, behavior: 'auto' });
    return 'tab-toggled';
  }

  function createRefreshScript() {
    return `(${refreshFollowingTimeline.toString()})({
      documentLike: document,
      schedule: setTimeout,
      scrollTo: function(options) { window.scrollTo(options); }
    })`;
  }

  global.SocialDeckXTimelineRefresh = {
    refreshFollowingTimeline,
    createRefreshScript,
  };
})(window);
