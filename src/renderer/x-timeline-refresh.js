(function (global) {
  async function refreshXNavigation({
    documentLike,
    schedule,
    destination = 'home',
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

    function findNavigationLink(target) {
      const testId = target === 'notifications'
        ? 'AppTabBar_Notifications_Link'
        : 'AppTabBar_Home_Link';
      const direct = documentLike.querySelector(`[data-testid="${testId}"]`);
      if (direct) return direct;

      return Array.from(documentLike.querySelectorAll('a[href]')).find(link => {
        const href = link.getAttribute?.('href') || link.href || '';
        try {
          const path = new URL(href, 'https://x.com').pathname.replace(/\/$/, '');
          return target === 'notifications'
            ? path === '/notifications'
            : path === '/home';
        } catch {
          return false;
        }
      });
    }

    function hasOpenInteraction(target) {
      if (target !== 'home') return false;
      const replyComposer = documentLike.querySelector(
        '[role="dialog"] [data-testid^="tweetTextarea_"]',
      );
      if (replyComposer) return true;

      const pathname = String(documentLike.location?.pathname || '').replace(/\/$/, '');
      if (!pathname) return false;
      return pathname !== '/home';
    }

    if (hasOpenInteraction(destination)) return 'interaction-open';

    const scroller = documentLike.scrollingElement || documentLike.documentElement;
    const atTop = (scroller?.scrollTop || 0) < 60;
    if (!atTop) return 'deferred';

    if (destination === 'home') {
      const followingTab = findTab(/^(フォロー中|Following)$/i);
      const forYouTab = findTab(/^(おすすめ|For you)$/i);
      if (followingTab && followingTab.getAttribute('aria-selected') !== 'true') {
        return 'not-following';
      }
      if (!followingTab && forYouTab?.getAttribute('aria-selected') === 'true') {
        return 'not-following';
      }
    }

    const navigationLink = findNavigationLink(destination);
    if (navigationLink) {
      navigationLink.click();
      await wait(150);
      if (scroller) scroller.scrollTop = 0;
      return `${destination}-clicked`;
    }

    if (destination === 'home') {
      const banner = documentLike.querySelector('[data-testid$="-newTweetsButton"]')
        || Array.from(documentLike.querySelectorAll('[role="button"]')).find(button => (
          /新しいポスト|新しいツイート|Show .* posts?/i.test(normalizedText(button))
        ));
      if (banner) {
        banner.click();
        await wait(150);
        if (scroller) scroller.scrollTop = 0;
        return 'banner-clicked';
      }
    }

    return 'navigation-missing';
  }

  function createRefreshScript(destination = 'home') {
    return `(${refreshXNavigation.toString()})({
      documentLike: document,
      schedule: setTimeout,
      destination: ${JSON.stringify(destination)}
    })`;
  }

  global.SocialDeckXTimelineRefresh = {
    refreshXNavigation,
    createRefreshScript,
  };
})(window);
