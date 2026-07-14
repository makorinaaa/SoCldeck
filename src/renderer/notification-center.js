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
    const profilePath = String(raw?.profileUrl || '')
      .replace(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)/i, '')
      .split(/[?#]/)[0];
    const handle = decodeURIComponent(profilePath.replace(/^\//, '').split('/')[0] || '');
    const text = String(raw?.text || '').trim();
    return {
      id: `x:${accountIndex}:${raw?.targetUrl || raw?.profileUrl || text}`,
      networkId: 'x',
      accountIndex,
      account,
      reason: classifyXNotification(text),
      isRead: null,
      indexedAt: raw?.indexedAt || '',
      author: {
        handle,
        displayName: raw?.actorName || handle || 'Xユーザー',
        avatar: raw?.avatar || '',
      },
      targetUrl: raw?.targetUrl || raw?.profileUrl || 'https://x.com/notifications',
      text,
      raw,
    };
  }

  function extractXNotificationsFromDocument(documentLike, locationLike, limit = 40) {
    const cells = Array.from(documentLike.querySelectorAll('[data-testid="cellInnerDiv"]'));
    return cells.map(cell => {
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
      const extract = ${extractXNotificationsFromDocument.toString()};
      const poll = () => {
        const items = extract(document, location, ${safeLimit});
        if (items.length > 0 || Date.now() - startedAt > 8000) resolve(items);
        else setTimeout(poll, 250);
      };
      poll();
    }))()`;
  }

  function buildBskyNotificationUrl(notification, selfHandle = '') {
    const authorHandle = notification?.author?.handle || '';
    const profileHandle = ['like', 'repost'].includes(notification?.reason)
      ? selfHandle
      : authorHandle;
    const targetUri = String(notification?.targetUri || '');
    const postMatch = targetUri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)/);
    if (postMatch) {
      const actor = profileHandle || postMatch[1];
      return `https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(postMatch[2])}`;
    }
    if (authorHandle) return `https://bsky.app/profile/${encodeURIComponent(authorHandle)}`;
    return 'https://bsky.app/';
  }

  global.SocialDeckNotificationCenter = {
    buildBskyNotificationUrl,
    buildXNotificationExtractionScript,
    classifyXNotification,
    extractXNotificationsFromDocument,
    normalizeBskyNotification,
    normalizeXNotification,
    filterNotifications,
  };
})(window);
