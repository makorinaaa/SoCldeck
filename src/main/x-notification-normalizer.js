// Converts the notification responses X's web client fetches into items for SocialDeck's
// notification center. X has served two formats: a GraphQL timeline and the older
// "adaptive" REST response. Both are read defensively; unknown shapes yield null so the
// caller can fall back to reading the page.

const NOTIFICATION_REST_PATH = /^\/i\/api\/2\/notifications\/(?:all|mentions|verified)\.json$/;

function isNotificationOperation(name) {
  return /^Notifications[A-Za-z]*$/.test(name || '');
}

function notificationOperation(url) {
  try {
    const parsed = new URL(url);
    if (!['x.com', 'twitter.com', 'api.x.com'].includes(parsed.hostname)) return null;
    if (NOTIFICATION_REST_PATH.test(parsed.pathname)) return 'NotificationsRest';
    const name = parsed.pathname.match(/\/graphql\/[^/]+\/([A-Za-z]+)$/)?.[1];
    return isNotificationOperation(name) ? name : null;
  } catch {
    return null;
  }
}

function reasonFromIcon(icon = '', text = '') {
  const value = String(icon).toLowerCase();
  if (value.includes('heart') || value.includes('like')) return 'like';
  if (value.includes('retweet') || value.includes('repost')) return 'repost';
  if (value.includes('person') || value.includes('follow')) return 'follow';
  if (value.includes('reply')) return 'reply';
  if (value.includes('quote')) return 'quote';
  if (/liked|いいね/i.test(text)) return 'like';
  if (/reposted|retweeted|リポスト|リツイート/i.test(text)) return 'repost';
  if (/followed|フォロー/i.test(text)) return 'follow';
  return null;
}

function toIso(milliseconds) {
  const value = Number(milliseconds);
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : '';
}

function statusUrl(handle, id) {
  return id ? `https://x.com/${encodeURIComponent(handle || 'i')}/status/${encodeURIComponent(id)}` : '';
}

function profileUrl(handle) {
  return handle ? `https://x.com/${encodeURIComponent(handle)}` : '';
}

function textOf(segments = []) {
  return segments.map(segment => segment.text || '').join('').trim();
}

// A notification about a post (a mention, a reply or a quote) arrives as the post itself.
function postNotification(post, { id = '', sortIndex = '' } = {}) {
  if (!post?.id) return null;
  const reason = post.replyTo ? 'reply' : post.quoted ? 'quote' : 'mention';
  return {
    id: id || `post-${post.id}`,
    reason,
    text: textOf(post.segments),
    postText: textOf(post.segments),
    targetId: post.id,
    targetUrl: post.url,
    targetAuthorId: post.author?.id || '',
    targetAuthorHandle: post.author?.handle || '',
    profileUrl: profileUrl(post.author?.handle),
    actorName: post.author?.name || post.author?.handle || '',
    actorHandle: post.author?.handle || '',
    avatar: post.author?.avatar || '',
    indexedAt: post.createdAt || '',
    sortIndex: String(sortIndex || ''),
    // Native notification Columns draw the post itself, with its actions.
    post,
  };
}

function createGraphqlReader({ normalizeTweet, normalizeUser, unwrapTweet }) {
  function collectInstructions(value, found = [], depth = 0) {
    if (!value || typeof value !== 'object' || depth > 12) return found;
    if (Array.isArray(value.instructions)) found.push(...value.instructions);
    Object.values(value).forEach(child => {
      if (child && typeof child === 'object') collectInstructions(child, found, depth + 1);
    });
    return found;
  }

  function itemsOf(entry) {
    const content = entry?.content || {};
    if (content.itemContent) return [content.itemContent];
    return (content.items || []).map(item => item?.item?.itemContent).filter(Boolean);
  }

  function aggregate(item, sortIndex) {
    const template = item.template || {};
    const text = String(item.rich_message?.text || item.message?.text || '');
    const targets = (template.target_objects || template.targetObjects || [])
      .map(target => unwrapTweet(target?.tweet_results?.result || target?.tweet?.tweet_results?.result))
      .filter(Boolean);
    const target = targets[0] ? normalizeTweet(targets[0]) : null;
    const urlId = /\/status\/(\d+)/.exec(item.notification_url?.url || '')?.[1] || '';
    const users = (template.from_users || template.fromUsers || [])
      .map(entry => normalizeUser(entry?.user_results || entry?.user)).filter(Boolean);
    const actor = users[0] || null;
    const targetId = target?.id || targets[0]?.rest_id || urlId;
    return {
      id: String(item.id || `${item.notification_icon || 'notification'}-${item.timestamp_ms || sortIndex}`),
      reason: reasonFromIcon(item.notification_icon, text),
      text: target ? `${text}\n${textOf(target.segments)}`.trim() : text,
      postText: target ? textOf(target.segments) : '',
      targetId: String(targetId || ''),
      targetUrl: targetId ? statusUrl(target?.author?.handle, targetId) : profileUrl(actor?.handle),
      targetAuthorId: target?.author?.id || '',
      targetAuthorHandle: target?.author?.handle || '',
      profileUrl: profileUrl(actor?.handle),
      actorName: actor?.name || actor?.handle || '',
      actorHandle: actor?.handle || '',
      avatar: actor?.avatar || '',
      indexedAt: toIso(item.timestamp_ms),
      sortIndex: String(sortIndex || ''),
      target: target || null,
    };
  }

  return function read(json) {
    const instructions = collectInstructions(json?.data);
    if (!instructions.length) return null;
    const notifications = [];
    let recognized = false;
    for (const instruction of instructions) {
      const entries = instruction?.entries || (instruction?.entry ? [instruction.entry] : []);
      for (const entry of entries) {
        for (const item of itemsOf(entry)) {
          const type = item.itemType || item.__typename;
          if (type === 'TimelineNotification') {
            recognized = true;
            notifications.push(aggregate(item, entry.sortIndex));
          } else if (type === 'TimelineTweet') {
            recognized = true;
            const post = normalizeTweet(item.tweet_results?.result);
            const notification = postNotification(post, { sortIndex: entry.sortIndex });
            if (notification) notifications.push(notification);
          }
        }
      }
    }
    return recognized ? notifications : null;
  };
}

function readAdaptive(json) {
  const objects = json?.globalObjects;
  if (!objects?.notifications && !objects?.tweets) return null;
  const users = objects.users || {};
  const tweets = objects.tweets || {};
  const user = id => {
    const value = users[id];
    if (!value?.screen_name) return null;
    return {
      handle: value.screen_name,
      name: value.name || value.screen_name,
      avatar: String(value.profile_image_url_https || '').replace(/_normal(\.\w+)$/, '_bigger$1'),
    };
  };
  const entries = (json.timeline?.instructions || [])
    .flatMap(instruction => instruction.addEntries?.entries || []);
  const notifications = [];
  for (const entry of entries) {
    const content = entry?.content?.item?.content || {};
    if (content.notification?.id) {
      const value = objects.notifications?.[content.notification.id];
      if (!value) continue;
      const text = String(value.message?.text || '');
      const actions = value.template?.aggregateUserActionsV1 || {};
      const targetId = String(actions.targetObjects?.[0]?.tweet?.id || '');
      const target = targetId ? tweets[targetId] : null;
      const actor = user(actions.fromUsers?.[0]?.user?.id);
      const targetText = String(target?.full_text || '').trim();
      notifications.push({
        id: String(value.id || content.notification.id),
        reason: reasonFromIcon(value.icon?.id, text),
        text: targetText ? `${text}\n${targetText}` : text,
        postText: targetText,
        targetId,
        targetUrl: targetId ? statusUrl(user(target?.user_id_str)?.handle, targetId) : profileUrl(actor?.handle),
        targetAuthorId: String(target?.user_id_str || ''),
        targetAuthorHandle: user(target?.user_id_str)?.handle || '',
        profileUrl: profileUrl(actor?.handle),
        actorName: actor?.name || '',
        actorHandle: actor?.handle || '',
        avatar: actor?.avatar || '',
        indexedAt: toIso(value.timestampMs),
        sortIndex: String(entry.sortIndex || ''),
      });
    } else if (content.tweet?.id) {
      const tweet = tweets[content.tweet.id];
      const author = user(tweet?.user_id_str);
      if (!tweet || !author) continue;
      const postText = String(tweet.full_text || '').trim();
      notifications.push({
        id: `post-${content.tweet.id}`,
        reason: tweet.in_reply_to_status_id_str ? 'reply' : tweet.is_quote_status ? 'quote' : 'mention',
        text: postText,
        postText,
        targetId: String(content.tweet.id),
        targetUrl: statusUrl(author.handle, content.tweet.id),
        targetAuthorId: String(tweet.user_id_str || ''),
        targetAuthorHandle: author.handle,
        profileUrl: profileUrl(author.handle),
        actorName: author.name,
        actorHandle: author.handle,
        avatar: author.avatar,
        indexedAt: Number.isFinite(Date.parse(tweet.created_at)) ? new Date(tweet.created_at).toISOString() : '',
        sortIndex: String(entry.sortIndex || ''),
      });
    }
  }
  return notifications;
}

function createNotificationNormalizer(helpers) {
  const readGraphql = createGraphqlReader(helpers);
  return function normalizeNotificationsResponse(json) {
    const notifications = readAdaptive(json) || readGraphql(json);
    if (!notifications) return null;
    return {
      operation: 'Notifications',
      notifications: notifications.sort((a, b) => {
        const left = Date.parse(a.indexedAt) || 0;
        const right = Date.parse(b.indexedAt) || 0;
        return right - left;
      }),
    };
  };
}

module.exports = {
  createNotificationNormalizer,
  isNotificationOperation,
  notificationOperation,
  reasonFromIcon,
};
