(function (global) {
  const POST_REASONS = new Set(['like', 'repost', 'reply', 'mention', 'quote']);
  const X_REASON_PATTERNS = [
    ['quote', /quoted|引用/i],
    ['reply', /replied|返信/i],
    ['mention', /mentioned|mention|メンション/i],
    ['like', /liked|いいね/i],
    ['repost', /reposted|retweeted|リポスト|リツイート/i],
    ['follow', /followed|フォロー/i],
  ];

  function normalizeBskyNotification(notification) {
    const reason = String(notification?.reason || 'other');
    const uri = notification?.uri || null;
    const targetUri = ['like', 'repost'].includes(reason)
      ? (notification?.reasonSubject || null)
      : (POST_REASONS.has(reason) ? uri : null);
    return {
      id: `${reason}:${uri || notification?.indexedAt || ''}`,
      networkId: 'b',
      reason,
      isRead: notification?.isRead === true,
      indexedAt: notification?.indexedAt || '',
      author: notification?.author || {},
      targetUri,
      raw: notification,
    };
  }

  function filterNotifications(notifications, { reason = 'all', unreadOnly = false } = {}) {
    return notifications.filter(notification => {
      if (reason !== 'all' && notification.reason !== reason) return false;
      return !unreadOnly || notification.isRead === false;
    });
  }

  function classifyXNotification(text) {
    return X_REASON_PATTERNS.find(([, pattern]) => pattern.test(String(text || '')))?.[0] || 'other';
  }

  function normalizeXNotification(raw, { accountIndex = 0, account = {} } = {}) {
    const targetUrl = String(raw?.targetUrl || '');
    const profileUrl = String(raw?.profileUrl || '');
    const indexedAt = String(raw?.indexedAt || '');
    const profilePath = String(raw?.profileUrl || '')
      .replace(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)/i, '')
      .split(/[?#]/)[0];
    const handle = decodeURIComponent(profilePath.replace(/^\//, '').split('/')[0] || '');
    const text = String(raw?.text || '').trim();
    const reason = classifyXNotification(text);
    return {
      id: `x:${accountIndex}:${targetUrl || profileUrl || text}|${profileUrl}|${indexedAt}|${reason}`,
      networkId: 'x',
      accountIndex,
      account,
      reason,
      isRead: null,
      indexedAt,
      author: {
        handle,
        displayName: raw?.actorName || handle || 'Xユーザー',
        avatar: raw?.avatar || '',
      },
      targetUrl: targetUrl || profileUrl || 'https://x.com/notifications',
      text,
      raw,
    };
  }

  function extractXNotificationsFromDocument(documentLike, locationLike, limit = 40) {
    const cells = Array.from(documentLike.querySelectorAll('[data-testid="cellInnerDiv"]'));
    return cells.map((cell, sourceIndex) => {
      const text = String(cell.innerText || '').trim();
      if (!text || cell.querySelector('[data-testid="promotedIndicator"]')) return null;
      const links = Array.from(cell.querySelectorAll('a[href]'));
      const statusLink = links.find(link => /\/status\/\d+/.test(link.href || ''));
      const profileLinks = links.filter(link => {
        try {
          const path = new URL(link.href, locationLike.origin).pathname;
          return /^\/[^/]+\/?$/.test(path) && !['/home', '/explore', '/notifications', '/messages'].includes(path);
        } catch {
          return false;
        }
      });
      const profileLink = profileLinks.find(link => String(link.innerText || '').trim()) || profileLinks[0];
      if (!profileLink && !statusLink) return null;
      const time = cell.querySelector('time');
      const avatarCandidates = Array.from(cell.querySelectorAll('img')).flatMap(image => {
        const srcset = String(image.srcset || image.getAttribute?.('srcset') || '');
        const srcsetUrls = srcset.split(',').map(candidate => candidate.trim().split(/\s+/)[0]).filter(Boolean);
        return [image.currentSrc, image.src, ...srcsetUrls].filter(Boolean);
      });
      Array.from(cell.querySelectorAll('[style*="background-image"]')).forEach(element => {
        const background = String(element.style?.backgroundImage || element.getAttribute?.('style') || '');
        const match = background.match(/url\(["']?([^"')]+)["']?\)/i);
        if (match?.[1]) avatarCandidates.push(match[1]);
      });
      const avatarUrl = avatarCandidates.filter(url => /profile_images/.test(url)).at(-1) || '';
      return {
        sourceIndex,
        text: text.slice(0, 800),
        targetUrl: statusLink?.href || profileLink?.href || '',
        profileUrl: profileLink?.href || '',
        actorName: String(profileLink?.innerText || '').trim().split('\n')[0] || '',
        avatar: avatarUrl,
        indexedAt: time?.dateTime || time?.getAttribute?.('datetime') || '',
      };
    }).filter(Boolean).slice(0, limit);
  }

  function buildXNotificationExtractionScript(limit = 40) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 40));
    return `(() => new Promise(resolve => {
      const startedAt = Date.now();
      let firstItemsAt = 0;
      let bestItems = [];
      let bestAvatarCount = 0;
      const extract = ${extractXNotificationsFromDocument.toString()};
      const poll = () => {
        const items = extract(document, location, ${safeLimit});
        const avatarCount = items.filter(item => item.avatar).length;
        if (items.length > 0 && !firstItemsAt) firstItemsAt = Date.now();
        if (items.length > bestItems.length || avatarCount > bestAvatarCount) {
          bestItems = items;
          bestAvatarCount = avatarCount;
        }
        const allAvatarsReady = items.length > 0 && avatarCount === items.length;
        const avatarGraceExpired = firstItemsAt && Date.now() - firstItemsAt >= 2000;
        const extractionTimedOut = Date.now() - startedAt > 8000;
        if (allAvatarsReady || avatarGraceExpired || extractionTimedOut) {
          resolve(bestItems.length ? bestItems : items);
        } else {
          setTimeout(poll, 250);
        }
      };
      poll();
    }))()`;
  }

  function buildXNotificationActivationScript(raw = {}) {
    const sourceIndex = Number.isInteger(raw.sourceIndex) ? raw.sourceIndex : -1;
    const expectedText = JSON.stringify(String(raw.text || '').trim().slice(0, 800));
    const expectedTime = JSON.stringify(String(raw.indexedAt || ''));
    return `(() => new Promise(resolve => {
      const startedAt = Date.now();
      const activate = () => {
        const cells = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'));
        const matchingCell = cells.find(cell => {
          const textMatches = String(cell.innerText || '').trim().slice(0, 800) === ${expectedText};
          const time = cell.querySelector('time');
          const indexedAt = time?.dateTime || time?.getAttribute?.('datetime') || '';
          return textMatches && (!${expectedTime} || indexedAt === ${expectedTime});
        });
        const cell = matchingCell || cells[${sourceIndex}];
        if (!cell) {
          if (Date.now() - startedAt > 8000) resolve(false);
          else setTimeout(activate, 250);
          return;
        }
        const statusLink = Array.from(cell.querySelectorAll('a[href]'))
          .find(link => /\\/status\\/\\d+/.test(link.href || ''));
        const postText = cell.querySelector('[data-testid="tweetText"]');
        const target = statusLink || postText?.closest?.('[role="link"]') || postText || cell;
        target.click();
        resolve(true);
      };
      activate();
    }))()`;
  }

  function findXNotificationColumn(columns, partition) {
    return Array.from(columns || []).find(column => {
      const webview = column?.querySelector?.('webview');
      if (!webview || webview.partition !== partition) return false;
      return column.dataset?.definitionId === 'x-notif-new'
        || webview.src?.includes('/notifications');
    }) || null;
  }

  function findBlueskyProfileColumn(columns) {
    return Array.from(columns || []).find(column => {
      const webview = column?.querySelector?.('webview');
      if (!webview) return false;
      if (column.dataset?.definitionId === 'b-profile') return true;
      try {
        const url = new URL(webview.src);
        return url.hostname === 'bsky.app' && /^\/profile\/[^/]+\/?$/.test(url.pathname);
      } catch {
        return false;
      }
    }) || null;
  }

  global.SocialDeckNotificationCenter = {
    buildXNotificationActivationScript,
    buildXNotificationExtractionScript,
    classifyXNotification,
    extractXNotificationsFromDocument,
    findBlueskyProfileColumn,
    findXNotificationColumn,
    normalizeBskyNotification,
    normalizeXNotification,
    filterNotifications,
  };
})(window);
