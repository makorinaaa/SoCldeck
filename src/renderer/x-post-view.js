(function (global) {
  const { escapeHtml } = global.SocialDeckHtmlEscape;

  function safeHttpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function formatCount(value) {
    const count = Number(value) || 0;
    if (count >= 100_000_000) return `${Math.floor(count / 100_000_000)}億`;
    if (count >= 10_000) return `${(count / 10_000).toFixed(count >= 100_000 ? 0 : 1).replace(/\.0$/, '')}万`;
    return String(count);
  }

  function renderSegments(segments = []) {
    return segments.map(segment => {
      const text = escapeHtml(segment.text || '').replace(/\n/g, '<br>');
      if (segment.type === 'link') {
        const href = safeHttpsUrl(segment.url);
        return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
      }
      if (segment.type === 'mention' && segment.handle) {
        return `<a href="https://x.com/${encodeURIComponent(segment.handle)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
      if (segment.type === 'hashtag' && segment.tag) {
        return `<a href="https://x.com/hashtag/${encodeURIComponent(segment.tag)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
      return text;
    }).join('');
  }

  function renderAvatar(author, size = 34) {
    const initials = escapeHtml((author.name || author.handle || '?').slice(0, 2).toUpperCase());
    const avatar = safeHttpsUrl(author.avatar);
    return `<div class="av" style="width:${size}px;height:${size}px">${initials}${avatar ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy">` : ''}</div>`;
  }

  function renderMedia(media = []) {
    const photos = media.filter(item => item.type === 'photo');
    const motion = media.find(item => item.type !== 'photo' && safeHttpsUrl(item.videoUrl));
    let html = '';
    if (photos.length) {
      const urls = photos.map(item => safeHttpsUrl(item.url)).filter(Boolean);
      html += `<div class="p-imgs n${Math.min(photos.length, 4)}" data-urls="${escapeHtml(JSON.stringify(urls))}">${photos.map((item, index) => (
        `<img src="${escapeHtml(safeHttpsUrl(item.thumb) || safeHttpsUrl(item.url))}" alt="${escapeHtml(item.alt || '')}" loading="lazy" style="cursor:zoom-in" data-x-image-index="${index}">`
      )).join('')}</div>`;
    }
    if (motion) {
      const poster = safeHttpsUrl(motion.thumb);
      const gif = motion.type === 'gif';
      html += `<video class="p-video" ${gif ? 'autoplay loop muted' : 'controls'} playsinline preload="none" src="${escapeHtml(safeHttpsUrl(motion.videoUrl))}"${poster ? ` poster="${escapeHtml(poster)}"` : ''} aria-label="${escapeHtml(motion.alt || 'Video')}"></video>`;
    }
    return html;
  }

  function createXPostView({ icons = {}, relTime = () => '', getPendingReaction = () => null } = {}) {
    function renderLock(author) {
      return author.protected ? `<span class="x-lock" title="非公開アカウント" aria-label="非公開アカウント">${icons.lock || '🔒'}</span>` : '';
    }

    function renderQuote(quoted) {
      if (!quoted) return '';
      const author = quoted.author || {};
      return `<div class="p-quote" data-x-url="${escapeHtml(safeHttpsUrl(quoted.url))}">
        <div class="p-quote-author">${escapeHtml(author.name || author.handle || '')}${renderLock(author)} <span class="p-handle">@${escapeHtml(author.handle || '')}</span></div>
        <div class="p-quote-text">${renderSegments(quoted.segments)}</div>${renderMedia(quoted.media)}
      </div>`;
    }

    function reactionState(post, kind, partition) {
      const field = kind === 'like' ? 'liked' : 'reposted';
      const countField = kind === 'like' ? 'like' : 'repost';
      const server = Boolean(post.viewer?.[field]);
      const pending = getPendingReaction(kind, post.id, partition);
      const active = pending ? pending.active : server;
      // X's counts can lag behind: a post this account reacted to, or that is shown as
      // someone's repost, has at least one such reaction.
      const floor = (active ? 1 : 0) + (kind === 'repost' && post.repostedBy && !active ? 1 : 0);
      const count = (Number(post.counts?.[countField]) || 0)
        + (pending && pending.active !== server ? (pending.active ? 1 : -1) : 0);
      return { active, count: Math.max(floor, count), pending: Boolean(pending) };
    }

    function renderPost(post, { focal = false, partition = '', own = false, deleting = false } = {}) {
      const author = post.author || {};
      const counts = post.counts || {};
      const url = safeHttpsUrl(post.url);
      const like = reactionState(post, 'like', partition);
      const repost = reactionState(post, 'repost', partition);
      // X does not let anyone repost or quote a protected account's post; an existing
      // repost can still be undone.
      const repostBlocked = Boolean(author.protected) && !repost.active;
      const repostLabel = post.repostedBy
        ? `<div class="repost-label">${icons.repost || ''} ${escapeHtml(post.repostedBy.name || post.repostedBy.handle || '')} がリポスト</div>`
        : '';
      const replyLabel = post.replyTo
        ? `<div class="x-reply-to">返信先: @${escapeHtml(post.replyTo)}</div>`
        : '';
      return `<div class="post x-native-post${focal ? ' x-focal' : ''}${deleting ? ' x-deleting' : ''}" role="link" tabindex="0" data-x-id="${escapeHtml(post.id || '')}" data-x-url="${escapeHtml(url)}" data-author-handle="${escapeHtml(author.handle || '')}">
        ${repostLabel}
        <div class="post-top">${renderAvatar(author)}<div class="post-meta"><div class="meta-row"><span class="p-name" title="${escapeHtml(author.name || author.handle || '')}">${escapeHtml(author.name || author.handle || '')}</span>${renderLock(author)}<span class="p-handle">@${escapeHtml(author.handle || '')}</span><span class="p-time" data-created-at="${escapeHtml(post.createdAt || '')}">${escapeHtml(relTime(post.createdAt))}</span></div></div></div>
        ${replyLabel}<div class="p-body">${renderSegments(post.segments)}</div>${renderMedia(post.media)}${renderQuote(post.quoted)}
        <div class="p-acts x-native-acts">
          <button type="button" class="pa rep" data-x-action="reply" title="返信">${icons.reply || ''} <span>${formatCount(counts.reply)}</span></button>
          <button type="button" class="pa rt ${repost.active ? 'rted' : ''}${repostBlocked ? ' x-blocked' : ''}" data-x-action="repost" title="${repostBlocked ? '非公開アカウントのポストはリポストできません' : 'リポスト'}"${repost.pending || repostBlocked ? ' disabled' : ''}>${icons.repost || ''} <span>${formatCount(repost.count)}</span></button>
          <button type="button" class="pa lk ${like.active ? 'liked' : ''}" data-x-action="like" title="いいね"${like.pending ? ' disabled' : ''}>${icons.heart || ''} <span>${formatCount(like.count)}</span></button>
          ${own ? `<button type="button" class="pa x-more" data-x-action="more" title="その他"${deleting ? ' disabled' : ''}>${icons.more || '…'}</button>` : ''}
        </div>
      </div>`;
    }

    function renderThread(detail, { partition = '', postOptions = () => ({}) } = {}) {
      const render = post => renderPost(post, { partition, ...postOptions(post) });
      const ancestors = (detail.ancestors || [])
        .map(post => `<div class="bsky-thread-parent">${render(post)}</div>`)
        .join('');
      const replies = (detail.replies || []).map(chain => `<div class="bsky-thread-reply" data-thread-depth="0">
          ${render(chain.post)}
          ${(chain.replies || []).map(reply => `<div class="bsky-thread-reply" data-thread-depth="1">${render(reply)}</div>`).join('')}
        </div>`).join('');
      return `${ancestors ? `<div class="bsky-thread-label">会話</div>${ancestors}` : ''}
        <div class="bsky-thread-main">${renderPost(detail.focal, { focal: true, partition, ...postOptions(detail.focal) })}</div>
        ${replies ? `<div class="bsky-thread-label">返信</div>${replies}` : '<div class="feed-empty">返信はありません</div>'}`;
    }

    return { renderPost, renderSegments, renderThread };
  }

  global.SocialDeckXPostView = { createXPostView, formatCount };
})(window);
