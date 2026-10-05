(function (global) {
  // Scripts that run inside X's hidden home page. Each function is serialized into the page,
  // so it must stay self-contained (no references to outer variables).

  // Selects the For you / Following tab. X's narrow layout hides its header while scrolled,
  // so the tabs may need a moment to come back.
  async function selectHomeTab(documentLike, timeline, schedule = null, attempts = 1) {
    const pattern = timeline === 'following' ? /フォロー中|Following/i : /おすすめ|For you/i;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const tab = Array.from(documentLike.querySelectorAll('[role="tab"]'))
        .find(element => pattern.test(String(element.textContent || '')));
      if (tab) {
        if (tab.getAttribute('aria-selected') === 'true') return 'already';
        tab.click();
        return 'clicked';
      }
      if (schedule) await new Promise(resolve => schedule(resolve, 150));
    }
    return 'missing';
  }

  function createSelectTabScript(timeline) {
    return `(window.scrollTo(0, 0), (${selectHomeTab.toString()})(document, ${JSON.stringify(timeline)}, setTimeout, 20))`;
  }

  // X's Following tab can sort by "Popular" or "Recent". Pressing the selected Following
  // tab opens that menu; SocialDeck picks Recent.
  async function selectFollowingRecent(documentLike, schedule) {
    const wait = ms => new Promise(resolve => schedule(resolve, ms));
    const close = () => {
      if (typeof KeyboardEvent === 'function') {
        documentLike.dispatchEvent?.(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    };
    const following = Array.from(documentLike.querySelectorAll('[role="tab"]'))
      .find(tab => /フォロー中|Following/i.test(String(tab.textContent || '')));
    if (!following || following.getAttribute('aria-selected') !== 'true') return 'not-following';
    following.click();
    let items = [];
    for (let check = 0; check < 20 && !items.length; check += 1) {
      await wait(100);
      items = Array.from(documentLike.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'));
    }
    if (!items.length) return 'no-menu';
    const recent = items.find(item => /最新|Recent|Latest/i.test(String(item.textContent || '')));
    if (!recent) {
      close();
      return 'no-recent';
    }
    const checked = recent.getAttribute('aria-checked') === 'true'
      || Boolean(recent.querySelector('[data-testid="check"], svg[aria-label*="選択"], svg[aria-label*="Selected"]'));
    if (checked) {
      close();
      return 'already';
    }
    recent.click();
    return 'selected';
  }

  function createFollowingRecentScript() {
    return `(window.scrollTo(0, 0), (${selectFollowingRecent.toString()})(document, setTimeout))`;
  }

  // The unread count on X's own Notifications tab. Returns null when the tab is not on the
  // page, 0 when it shows no count.
  function readNotificationBadge(documentLike) {
    const link = documentLike.querySelector('[data-testid="AppTabBar_Notifications_Link"]')
      || documentLike.querySelector('a[href="/notifications"]');
    if (!link) return null;
    const label = /(\d+)/.exec(String(link.getAttribute('aria-label') || ''));
    if (label) return Number(label[1]);
    const text = String(link.textContent || '').replace(/\s+/g, '');
    const count = /(\d+)\+?$/.exec(text);
    return count ? Number(count[1]) : 0;
  }

  function createNotificationBadgeScript() {
    return `(${readNotificationBadge.toString()})(document)`;
  }

  // Which tab is selected right now.
  function readSelectedTab(documentLike) {
    const selected = Array.from(documentLike.querySelectorAll('[role="tab"]'))
      .find(tab => tab.getAttribute('aria-selected') === 'true');
    const text = String(selected?.textContent || '');
    if (/フォロー中|Following/i.test(text)) return 'following';
    if (/おすすめ|For you/i.test(text)) return 'for-you';
    return null;
  }

  function createReadTabScript() {
    return `(${readSelectedTab.toString()})(document)`;
  }

  // Runs in SocialDeck, not in X: whether a hidden page was sent to X's sign-in.
  function isLoginUrl(value) {
    if (/\/i\/flow\/(?:login|signup)|\/login(?:[/?#]|$)|\/logout(?:[/?#]|$)/.test(value || '')) return true;
    // A signed-out session is sent from /home to X's landing page.
    return /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/?(?:[?#]|$)/.test(value || '');
  }

  global.SocialDeckXNativePageScripts = {
    createFollowingRecentScript,
    createNotificationBadgeScript,
    createReadTabScript,
    createSelectTabScript,
    isLoginUrl,
    readNotificationBadge,
    readSelectedTab,
    selectFollowingRecent,
    selectHomeTab,
  };
})(window);
