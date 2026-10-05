// Converts X web client GraphQL timeline responses into the small post shape the
// renderer draws. Only fields needed for display leave the main process.

// CreateTweet is read so the account's own new post appears at once: X's client marks it
// as seen and leaves it out of later timeline responses.
// TweetDetail is fetched when a status page opens; it feeds the post detail view.
const { createNotificationNormalizer, isNotificationOperation, notificationOperation } = require('./x-notification-normalizer');

const TIMELINE_OPERATIONS = new Set(['HomeTimeline', 'HomeLatestTimeline', 'CreateTweet', 'TweetDetail']);
const MAX_SEGMENTS = 400;

function timelineOperation(url) {
  const notifications = notificationOperation(url);
  if (notifications) return notifications;
  try {
    const parsed = new URL(url);
    if (!['x.com', 'twitter.com', 'api.x.com'].includes(parsed.hostname)) return null;
    const name = parsed.pathname.match(/\/graphql\/[^/]+\/([A-Za-z]+)$/)?.[1];
    // X can serve the home tabs (and the Following sort orders) through other Home*Timeline
    // operations; the renderer decides which tab a response belongs to from the page itself.
    return TIMELINE_OPERATIONS.has(name) || /^Home[A-Za-z]*Timeline$/.test(name || '') ? name : null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
}

function unescapeHtml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function unwrapTweet(result) {
  if (!result) return null;
  if (result.__typename === 'TweetWithVisibilityResults') return result.tweet || null;
  if (result.__typename && result.__typename !== 'Tweet') return null;
  return result.legacy ? result : null;
}

function normalizeUser(userResult) {
  const user = userResult?.result || userResult;
  if (!user) return null;
  const legacy = user.legacy || {};
  const core = user.core || {};
  const handle = core.screen_name || legacy.screen_name || '';
  if (!handle) return null;
  const avatar = safeHttpsUrl(user.avatar?.image_url || legacy.profile_image_url_https || '')
    .replace(/_normal(\.\w+)$/, '_bigger$1');
  return {
    id: String(user.rest_id || ''),
    handle,
    name: core.name || legacy.name || handle,
    avatar,
    verified: Boolean(user.is_blue_verified || legacy.verified),
  };
}

function pickVideoUrl(media) {
  const variants = (media.video_info?.variants || [])
    .filter(variant => variant.content_type === 'video/mp4' && safeHttpsUrl(variant.url));
  variants.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
  // Prefer a mid bitrate: the highest one is often far larger than a column needs.
  const chosen = variants.find(variant => (Number(variant.bitrate) || 0) <= 2_200_000) || variants[0];
  return chosen ? safeHttpsUrl(chosen.url) : '';
}

function normalizeMedia(legacy) {
  const list = legacy.extended_entities?.media || legacy.entities?.media || [];
  return list.slice(0, 4).map(media => {
    const thumb = safeHttpsUrl(media.media_url_https || '');
    if (!thumb) return null;
    const type = media.type === 'video' ? 'video' : media.type === 'animated_gif' ? 'gif' : 'photo';
    return {
      type,
      thumb: type === 'photo' ? `${thumb}?name=small` : thumb,
      url: type === 'photo' ? `${thumb}?name=large` : thumb,
      videoUrl: type === 'photo' ? '' : pickVideoUrl(media),
      alt: String(media.ext_alt_text || ''),
    };
  }).filter(Boolean);
}

// Splits the text into display segments. Entities are located by their literal text
// rather than by index, which keeps working when HTML escaping shifts offsets.
function buildSegments(rawText, entities = {}, { mediaUrls = [] } = {}) {
  const text = String(rawText || '');
  const lowered = text.toLowerCase();
  const found = [];
  const add = (needle, entity) => {
    if (!needle) return;
    let from = 0;
    while (from <= text.length) {
      const index = lowered.indexOf(needle.toLowerCase(), from);
      if (index < 0) return;
      const end = index + needle.length;
      if (!found.some(item => index < item.end && end > item.start)) {
        found.push({ start: index, end, ...entity });
        return;
      }
      from = end;
    }
  };
  (entities.urls || []).forEach(url => {
    const href = safeHttpsUrl(url.expanded_url || url.url);
    add(url.url, href
      ? { type: 'link', url: href, text: url.display_url || url.expanded_url || url.url }
      : { type: 'text', text: url.url });
  });
  mediaUrls.forEach(url => add(url, { type: 'drop' }));
  (entities.user_mentions || []).forEach(mention => {
    if (mention.screen_name) add(`@${mention.screen_name}`, { type: 'mention', handle: mention.screen_name });
  });
  (entities.hashtags || []).forEach(tag => {
    if (tag.text) add(`#${tag.text}`, { type: 'hashtag', tag: tag.text });
  });
  found.sort((a, b) => a.start - b.start);

  const segments = [];
  const pushText = value => {
    const plain = unescapeHtml(value);
    if (!plain) return;
    const last = segments[segments.length - 1];
    if (last?.type === 'text') last.text += plain;
    else segments.push({ type: 'text', text: plain });
  };
  let cursor = 0;
  for (const item of found) {
    pushText(text.slice(cursor, item.start));
    const literal = unescapeHtml(text.slice(item.start, item.end));
    if (item.type === 'link') segments.push({ type: 'link', url: item.url, text: item.text });
    else if (item.type === 'mention') segments.push({ type: 'mention', handle: item.handle, text: literal });
    else if (item.type === 'hashtag') segments.push({ type: 'hashtag', tag: item.tag, text: literal });
    else if (item.type === 'text') pushText(item.text);
    cursor = item.end;
  }
  pushText(text.slice(cursor));
  const last = segments[segments.length - 1];
  if (last?.type === 'text') {
    last.text = last.text.replace(/\s+$/, '');
    if (!last.text) segments.pop();
  }
  return segments.slice(0, MAX_SEGMENTS);
}

function toIsoDate(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

function normalizeTweetBody(tweet) {
  const legacy = tweet.legacy || {};
  const author = normalizeUser(tweet.core?.user_results);
  if (!author || !tweet.rest_id) return null;
  const media = normalizeMedia(legacy);
  const mediaUrls = (legacy.extended_entities?.media || legacy.entities?.media || []).map(item => item.url);
  const note = tweet.note_tweet?.note_tweet_results?.result;
  const segments = note?.text
    ? buildSegments(note.text, note.entity_set || {}, { mediaUrls })
    : buildSegments(legacy.full_text, legacy.entities || {}, { mediaUrls });
  return {
    id: String(tweet.rest_id),
    url: `https://x.com/${encodeURIComponent(author.handle)}/status/${encodeURIComponent(tweet.rest_id)}`,
    createdAt: toIsoDate(legacy.created_at),
    author,
    segments,
    media,
    replyTo: legacy.in_reply_to_screen_name || null,
    replyToId: legacy.in_reply_to_user_id_str ? String(legacy.in_reply_to_user_id_str) : null,
  };
}

function normalizeTweet(result) {
  const tweet = unwrapTweet(result);
  if (!tweet) return null;
  const retweeted = unwrapTweet(tweet.legacy?.retweeted_status_result?.result);
  if (retweeted) {
    const inner = normalizeTweet(retweeted);
    const by = normalizeUser(tweet.core?.user_results);
    if (!inner || !by) return null;
    return { ...inner, repostedBy: { handle: by.handle, name: by.name } };
  }

  const body = normalizeTweetBody(tweet);
  if (!body) return null;
  const legacy = tweet.legacy;
  const quotedTweet = unwrapTweet(tweet.quoted_status_result?.result);
  const quoted = quotedTweet ? normalizeTweetBody(quotedTweet) : null;
  return {
    ...body,
    counts: {
      reply: Number(legacy.reply_count) || 0,
      repost: Number(legacy.retweet_count) || 0,
      like: Number(legacy.favorite_count) || 0,
      quote: Number(legacy.quote_count) || 0,
      view: Number(tweet.views?.count) || 0,
    },
    viewer: {
      liked: Boolean(legacy.favorited),
      reposted: Boolean(legacy.retweeted),
    },
    repostedBy: null,
    quoted,
  };
}

function collectItemContents(entry) {
  const content = entry?.content || {};
  if (content.entryType === 'TimelineTimelineItem' || content.__typename === 'TimelineTimelineItem') {
    return [{ itemContent: content.itemContent, promoted: Boolean(content.itemContent?.promotedMetadata) }];
  }
  if (content.entryType === 'TimelineTimelineModule' || content.__typename === 'TimelineTimelineModule') {
    return (content.items || []).map(item => ({
      itemContent: item?.item?.itemContent,
      promoted: Boolean(item?.item?.itemContent?.promotedMetadata),
    }));
  }
  return [];
}

function normalizeTimelineResponse(json, operation = 'HomeTimeline') {
  const instructions = json?.data?.home?.home_timeline_urt?.instructions;
  if (!Array.isArray(instructions)) return null;
  const posts = [];
  const cursors = {};
  const seen = new Set();
  for (const instruction of instructions) {
    const entries = instruction?.type === 'TimelineAddEntries'
      ? instruction.entries || []
      : instruction?.type === 'TimelineReplaceEntry' && instruction.entry ? [instruction.entry] : [];
    for (const entry of entries) {
      const cursorType = entry?.content?.cursorType;
      if (cursorType === 'Top' || cursorType === 'Bottom') {
        cursors[cursorType.toLowerCase()] = String(entry.content.value || '');
        continue;
      }
      if (/^promoted-/i.test(entry?.entryId || '')) continue;
      for (const { itemContent, promoted } of collectItemContents(entry)) {
        if (promoted || itemContent?.itemType !== 'TimelineTweet') continue;
        const post = normalizeTweet(itemContent.tweet_results?.result);
        if (!post || seen.has(post.id)) continue;
        seen.add(post.id);
        posts.push({ ...post, sortIndex: String(entry.sortIndex || '') });
      }
    }
  }
  return {
    operation,
    timeline: { HomeLatestTimeline: 'following', HomeTimeline: 'for-you' }[operation] || null,
    posts,
    cursors,
  };
}

function normalizeCreateTweetResponse(json) {
  const post = normalizeTweet(json?.data?.create_tweet?.tweet_results?.result);
  if (!post) return null;
  return { operation: 'CreateTweet', timeline: null, posts: [post], cursors: {} };
}

function focalIdFromUrl(url) {
  try {
    const variables = JSON.parse(new URL(url).searchParams.get('variables') || '{}');
    return /^\d+$/.test(String(variables.focalTweetId || '')) ? String(variables.focalTweetId) : '';
  } catch {
    return '';
  }
}

// Shapes a status page conversation as ancestors, the focal post and reply chains.
function normalizeTweetDetailResponse(json, url = '') {
  const instructions = json?.data?.threaded_conversation_with_injections_v2?.instructions;
  if (!Array.isArray(instructions)) return null;
  const focalId = focalIdFromUrl(url);
  const thread = [];
  const replies = [];
  for (const instruction of instructions) {
    if (instruction?.type !== 'TimelineAddEntries') continue;
    for (const entry of instruction.entries || []) {
      if (/^promoted-/i.test(entry?.entryId || '')) continue;
      const items = collectItemContents(entry)
        .filter(({ itemContent, promoted }) => !promoted && itemContent?.itemType === 'TimelineTweet')
        .map(({ itemContent }) => normalizeTweet(itemContent.tweet_results?.result))
        .filter(Boolean);
      if (!items.length) continue;
      if (/^conversationthread-/.test(entry.entryId || '')) {
        const [first, ...rest] = items;
        replies.push({ post: first, replies: rest });
      } else {
        thread.push(...items);
      }
    }
  }
  // The renderer picks the focal post by the id it opened: a status page can also list
  // unrelated posts (for example "discover more") after the conversation.
  if (focalId && !thread.some(post => post.id === focalId)) return null;
  if (!thread.length) return null;
  return { operation: 'TweetDetail', focalId, thread, replies };
}

let normalizeNotificationsResponse = null;

function normalizeCapturedResponse(json, operation, url = '') {
  if (isNotificationOperation(operation)) {
    normalizeNotificationsResponse ||= createNotificationNormalizer({ normalizeTweet, normalizeUser, unwrapTweet });
    return normalizeNotificationsResponse(json);
  }
  if (operation === 'CreateTweet') return normalizeCreateTweetResponse(json);
  if (operation === 'TweetDetail') return normalizeTweetDetailResponse(json, url);
  return normalizeTimelineResponse(json, operation);
}

module.exports = {
  buildSegments,
  normalizeCapturedResponse,
  normalizeCreateTweetResponse,
  normalizeTimelineResponse,
  normalizeTweet,
  normalizeTweetDetailResponse,
  normalizeUser,
  timelineOperation,
  unwrapTweet,
};
