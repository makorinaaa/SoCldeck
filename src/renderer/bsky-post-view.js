(function (global) {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createBlueskyPostView({
    ui = {},
    icons = {},
    getPendingReaction = () => null,
  } = {}) {
    function renderPost(item) {
      const post = item.post || item;
      const record = post.record || {};
      const author = post.author || {};
      const reposter = item.reason?.by || null;
      const uri = post.uri || '';
      const cid = post.cid || '';
      const serverLiked = Boolean(post.viewer?.like);
      const serverReposted = Boolean(post.viewer?.repost);
      const pendingLike = getPendingReaction('like', uri);
      const pendingRepost = getPendingReaction('repost', uri);
      const liked = pendingLike ? pendingLike.active : serverLiked;
      const reposted = pendingRepost ? pendingRepost.active : serverReposted;
      const likeCount = (Number(post.likeCount) || 0)
        + (pendingLike && pendingLike.active !== serverLiked ? (pendingLike.active ? 1 : -1) : 0);
      const repostCount = (Number(post.repostCount) || 0)
        + (pendingRepost && pendingRepost.active !== serverReposted ? (pendingRepost.active ? 1 : -1) : 0);
      const body = ui?.formatText
        ? ui.formatText(record.text || '', record.facets, { delegated: true })
        : escapeHtml(record.text || '');
      const avatar = ui?.renderAvatar ? ui.renderAvatar(author, 34, { delegated: true }) : '';
      const time = ui?.relTime ? ui.relTime(record.createdAt) : '';
      const images = post.embed?.images || post.embed?.media?.images || [];
      const imageUrls = images.slice(0, 4).map(image => image.fullsize || image.thumb).filter(Boolean);
      const imageClass = ['', 'n1', 'n2', 'n3', 'n4'][Math.min(imageUrls.length, 4)];
      const imageHtml = imageUrls.length
        ? `<div class="p-imgs ${imageClass}" data-urls="${escapeHtml(JSON.stringify(imageUrls))}">${imageUrls.map((url, index) => (
            `<img src="${escapeHtml(images[index].thumb || images[index].fullsize || url)}" alt="${escapeHtml(images[index].alt || '')}" loading="lazy" style="cursor:zoom-in" data-bsky-image-index="${index}">`
          )).join('')}</div>`
        : '';
      const video = post.embed?.playlist
        ? post.embed
        : post.embed?.media?.playlist ? post.embed.media : null;
      const videoHtml = video
        ? `<video class="p-video" controls playsinline preload="none" src="${escapeHtml(video.playlist)}"${video.thumbnail ? ` poster="${escapeHtml(video.thumbnail)}"` : ''} aria-label="${escapeHtml(video.alt || 'Video')}"></video>`
        : '';
      const repostLabel = reposter
        ? `<div class="repost-label">${icons.repost || ''} ${escapeHtml(reposter.displayName || reposter.handle || '')} reposted</div>`
        : '';

      return `<div class="post" role="link" tabindex="0" data-uri="${escapeHtml(uri)}" data-cid="${escapeHtml(cid)}" data-likeuri="${escapeHtml(post.viewer?.like || '')}" data-reposturi="${escapeHtml(post.viewer?.repost || '')}" data-author-did="${escapeHtml(author.did || '')}" data-author-handle="${escapeHtml(author.handle || '')}">
        ${repostLabel}
        <div class="post-top">${avatar}<div class="post-meta"><div class="meta-row"><span class="p-name" title="${escapeHtml(author.displayName || author.handle || '')}">${escapeHtml(author.displayName || author.handle || '')}</span><span class="p-handle">@${escapeHtml(author.handle || '')}</span><span class="p-time" data-created-at="${escapeHtml(record.createdAt || '')}">${escapeHtml(time)}</span></div></div></div>
        <div class="p-body">${body}</div>${imageHtml}${videoHtml}
        <div class="p-acts">
          <button class="pa rep" data-bsky-action="reply">${icons.reply || ''} <span>${Number(post.replyCount) || 0}</span></button>
          <button class="pa rt ${reposted ? 'rted' : ''}" data-bsky-action="repost"${pendingRepost ? ' disabled' : ''}>${icons.repost || ''} <span>${Math.max(0, repostCount)}</span></button>
          <button class="pa lk ${liked ? 'liked' : ''}" data-bsky-action="like"${pendingLike ? ' disabled' : ''}>${icons.heart || ''} <span>${Math.max(0, likeCount)}</span></button>
        </div>
      </div>`;
    }

    function collectThreadParents(thread) {
      const parents = [];
      let current = thread?.parent;
      while (current?.post) {
        parents.unshift(current.post);
        current = current.parent;
      }
      return parents;
    }

    function renderThreadReplies(replies, depth = 0) {
      return (replies || [])
        .filter(reply => reply?.post)
        .map(reply => `<div class="bsky-thread-reply" data-thread-depth="${depth}">
          ${renderPost({ post: reply.post })}
          ${renderThreadReplies(reply.replies, depth + 1)}
        </div>`)
        .join('');
    }

    function getNotificationIdentity(notification) {
      return notification.uri || [
        notification.indexedAt,
        notification.reason,
        notification.author?.did,
        notification.reasonSubject,
      ].filter(Boolean).join('|');
    }

    function renderNotification(notification) {
      const author = notification.author || {};
      const reason = notification.reason || '';
      const labels = {
        like: 'Like',
        repost: 'Repost',
        follow: 'Follow',
        reply: 'Reply',
        mention: 'Mention',
        quote: 'Quote',
      };
      const notificationIcons = {
        like: icons.heart,
        repost: icons.repost,
        follow: icons.follow,
        reply: icons.reply,
        mention: icons.reply,
        quote: icons.reply,
      };
      const targetUri = notification.reasonSubject
        || (['reply', 'mention', 'quote'].includes(reason) ? notification.uri : '');
      const identity = getNotificationIdentity(notification);
      const avatar = ui?.renderAvatar ? ui.renderAvatar(author, 28, { delegated: true }) : '';
      const time = ui?.relTime ? ui.relTime(notification.indexedAt) : '';
      return `<div class="notif" role="button" tabindex="0" data-time="${escapeHtml(notification.indexedAt || '')}" data-notification-uri="${escapeHtml(identity)}" data-notification-reason="${escapeHtml(reason)}" data-author-did="${escapeHtml(author.did || '')}" data-author-handle="${escapeHtml(author.handle || '')}" data-target-uri="${escapeHtml(targetUri)}">
        <div class="ntype nt${escapeHtml(reason)}">${notificationIcons[reason] || icons.bell || ''} ${escapeHtml(labels[reason] || reason)}</div>
        <div class="nrow">${avatar}<div class="ninfo"><div class="nwho">${escapeHtml(author.displayName || author.handle || '')}</div><div class="nex">@${escapeHtml(author.handle || '')}</div><div class="nago" data-created-at="${escapeHtml(notification.indexedAt || '')}">${escapeHtml(time)}</div></div></div>
      </div>`;
    }

    return {
      collectThreadParents,
      getNotificationIdentity,
      renderNotification,
      renderPost,
      renderThreadReplies,
    };
  }

  global.SocialDeckBlueskyPostView = { createBlueskyPostView };
})(window);
