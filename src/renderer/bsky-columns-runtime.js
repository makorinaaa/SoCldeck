(function (global) {
  const MAX_RENDERED_ITEMS = 300;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trimRenderedItems(host, { removeFrom = 'end', preserveScroll = false } = {}) {
    const items = Array.from(host?.querySelectorAll?.('.post, .notif') || []);
    const overflow = items.length - MAX_RENDERED_ITEMS;
    if (overflow <= 0) return 0;
    const removed = removeFrom === 'start'
      ? items.slice(0, overflow)
      : items.slice(items.length - overflow);
    const previousScrollTop = Number(host.scrollTop) || 0;
    const removedHeight = removed.reduce((height, item) => height + (item.offsetHeight || 0), 0);
    removed.forEach(item => item.remove?.());
    if (preserveScroll && removeFrom === 'start') {
      host.scrollTop = Math.max(0, previousScrollTop - removedHeight);
    }
    return removed.length;
  }

  function createBlueskyColumnsRuntime({
    adapter,
    muteRules,
    ui,
    icons = {},
    onOutcome = () => {},
    documentRef = global.document,
    intents = {},
    schedule = global.setTimeout || (callback => callback()),
    cancelSchedule = global.clearTimeout || (() => {}),
    requestFrame = global.requestAnimationFrame || (callback => callback()),
    now = () => new Date().toISOString(),
    hoverDelay = 300,
  } = {}) {
    if (!adapter) throw new Error('Bluesky Columns Runtime requires an authenticated adapter');
    const columns = new Map();
    const pendingReactions = new Map();
    let profileHoverTimer = null;
    let profileHoverTimerOwnerId = null;
    let profileCardOwnerId = null;
    let activeDetail = null;
    let activeRepostMenu = null;
    let detailSequence = 0;

    function closeRepostMenu(ownerId = null) {
      if (!activeRepostMenu || (ownerId && activeRepostMenu.ownerId !== ownerId)) return;
      const { menu, pointerDownHandler, keyDownHandler } = activeRepostMenu;
      documentRef?.removeEventListener?.('pointerdown', pointerDownHandler, true);
      documentRef?.removeEventListener?.('keydown', keyDownHandler);
      menu.remove?.();
      activeRepostMenu = null;
    }

    function clearProfileHoverTimer(ownerId = null) {
      if (ownerId && profileHoverTimerOwnerId !== ownerId) return;
      if (profileHoverTimer !== null) cancelSchedule(profileHoverTimer);
      profileHoverTimer = null;
      profileHoverTimerOwnerId = null;
    }

    function removeProfileCard() {
      documentRef?.getElementById?.('bsky-hover-card')?.remove?.();
      profileCardOwnerId = null;
    }

    function closeActiveDetail() {
      if (!activeDetail) return;
      const { overlay, ownerId } = activeDetail;
      closeRepostMenu(ownerId);
      clearProfileHoverTimer(ownerId);
      if (profileCardOwnerId === ownerId) removeProfileCard();
      overlay.remove?.();
      activeDetail = null;
    }

    function positionProfileCard(card, target) {
      const rect = target?.getBoundingClientRect?.() || { left: 10, top: 10, bottom: 10 };
      const viewportWidth = Number(global.innerWidth) || 1200;
      const viewportHeight = Number(global.innerHeight) || 800;
      let left = rect.left;
      let top = rect.bottom + 8;
      if (left + 280 > viewportWidth - 10) left = viewportWidth - 290;
      if (top + 220 > viewportHeight - 10) top = rect.top - 228;
      if (left < 10) left = 10;
      if (top < 10) top = 10;
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }

    async function toggleProfileFollow(button) {
      const followUri = button.dataset.followuri || '';
      const active = !followUri;
      const previousText = button.textContent;
      button.disabled = true;
      button.textContent = '...';
      try {
        if (active) {
          const result = await adapter.follow({ targetDid: button.dataset.did });
          button.dataset.followuri = result?.uri || '';
        } else {
          await adapter.unfollow({ followUri });
          button.dataset.followuri = '';
        }
        button.textContent = active ? 'フォロー中' : 'フォロー';
        button.disabled = false;
        onOutcome({
          kind: 'follow',
          status: 'succeeded',
          active,
          handle: button.dataset.handle || '',
        });
      } catch (error) {
        button.textContent = previousText;
        button.disabled = false;
        onOutcome({
          kind: 'follow',
          status: 'failed',
          active,
          handle: button.dataset.handle || '',
          error,
        });
      }
    }

    async function showProfileCard(columnId, target, profileElement) {
      const actor = profileElement.dataset.did || profileElement.dataset.handle || '';
      if (!actor || !documentRef?.createElement || !documentRef?.body) return;
      removeProfileCard();
      const card = documentRef.createElement('div');
      card.id = 'bsky-hover-card';
      card.style.cssText = 'position:fixed;z-index:1000;width:260px;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-size:12px;color:var(--text1)';
      card.textContent = 'Loading...';
      profileCardOwnerId = columnId;
      documentRef.body.appendChild(card);
      positionProfileCard(card, target);

      try {
        const profile = await adapter.getProfile({ actor });
        if (documentRef.getElementById?.('bsky-hover-card') !== card) return;
        const avatar = profile.avatar
          ? `<img src="${escapeHtml(profile.avatar)}" alt="" style="width:42px;height:42px;border-radius:50%;object-fit:cover">`
          : '<div style="width:42px;height:42px;border-radius:50%;background:var(--bg3)"></div>';
        const following = profile.viewer?.following || '';
        card.innerHTML = `<div style="display:flex;gap:10px;align-items:center">${avatar}<div style="min-width:0;flex:1"><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(profile.displayName || profile.handle || '')}</div><div style="color:var(--text3)">@${escapeHtml(profile.handle || '')}</div></div><button type="button" data-bsky-follow data-did="${escapeHtml(profile.did || '')}" data-handle="${escapeHtml(profile.handle || '')}" data-followuri="${escapeHtml(following)}">${following ? 'フォロー中' : 'フォロー'}</button></div>${profile.description ? `<div style="margin-top:8px;color:var(--text2);line-height:1.4">${escapeHtml(profile.description).slice(0, 180)}</div>` : ''}`;
        positionProfileCard(card, target);
      } catch (error) {
        if (documentRef.getElementById?.('bsky-hover-card') === card) card.textContent = 'Profile load failed';
        onOutcome({ kind: 'profile', status: 'failed', columnId, error });
      }

      card.addEventListener?.('click', async event => {
        const button = event.target?.closest?.('[data-bsky-follow]');
        if (!button) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        await toggleProfileFollow(button);
      });
      card.addEventListener?.('pointerenter', () => clearProfileHoverTimer(columnId));
      card.addEventListener?.('pointerleave', () => {
        clearProfileHoverTimer(columnId);
        profileHoverTimerOwnerId = columnId;
        profileHoverTimer = schedule(() => removeProfileCard(), 150);
      });
    }

    function setMetric(element, selector, value) {
      const metric = element.querySelector?.(selector);
      if (metric) metric.textContent = String(value || 0);
    }

    function syncReactionAcrossColumns({ uri, kind, active, recordUri = '', pending = false }) {
      const hosts = [...Array.from(columns.values(), column => column.host)];
      if (activeDetail?.overlay) hosts.push(activeDetail.overlay);
      hosts.forEach(host => {
        Array.from(host.querySelectorAll?.('.post[data-uri]') || [])
          .filter(post => post.dataset?.uri === uri)
          .forEach(post => {
            const selector = kind === 'like' ? '.pa.lk' : '.pa.rt';
            const activeClass = kind === 'like' ? 'liked' : 'rted';
            const button = post.querySelector?.(selector);
            if (!button) return;
            const wasActive = button.classList.contains(activeClass);
            if (wasActive !== active) {
              button.classList.toggle(activeClass, active);
              const count = button.querySelector?.('span');
              const currentCount = Number.parseInt(count?.textContent || '0', 10) || 0;
              if (count) count.textContent = String(active ? currentCount + 1 : Math.max(0, currentCount - 1));
            }
            if (kind === 'like') {
              button.querySelector?.('svg')?.setAttribute?.('fill', active ? 'currentColor' : 'none');
              post.dataset.likeuri = recordUri;
            } else {
              post.dataset.reposturi = recordUri;
            }
            button.disabled = pending;
          });
      });
    }

    function reapplyPendingReactions() {
      pendingReactions.forEach((mutation, key) => {
        const separator = key.indexOf(':');
        syncReactionAcrossColumns({
          kind: key.slice(0, separator),
          uri: key.slice(separator + 1),
          active: mutation.active,
          recordUri: mutation.active ? mutation.previousRecordUri : '',
          pending: true,
        });
      });
    }

    function syncPostMetrics(host, items) {
      const existing = new Map(
        Array.from(host.querySelectorAll?.('.post[data-uri]') || [])
          .map(element => [element.dataset?.uri, element]),
      );
      items.forEach(item => {
        const post = item.post || item;
        const element = existing.get(post.uri);
        if (!element) return;
        setMetric(element, '.pa.rep span', post.replyCount);
        setMetric(element, '.pa.rt span', post.repostCount);
        setMetric(element, '.pa.lk span', post.likeCount);
        element.querySelector?.('.pa.lk')?.classList?.toggle('liked', Boolean(post.viewer?.like));
        element.querySelector?.('.pa.lk')?.querySelector?.('svg')?.setAttribute?.('fill', post.viewer?.like ? 'currentColor' : 'none');
        element.querySelector?.('.pa.rt')?.classList?.toggle('rted', Boolean(post.viewer?.repost));
        element.dataset.likeuri = post.viewer?.like || '';
        element.dataset.reposturi = post.viewer?.repost || '';
      });
    }

    function renderPost(item) {
      const post = item.post || item;
      const record = post.record || {};
      const author = post.author || {};
      const reposter = item.reason?.by || null;
      const uri = post.uri || '';
      const cid = post.cid || '';
      const serverLiked = Boolean(post.viewer?.like);
      const serverReposted = Boolean(post.viewer?.repost);
      const pendingLike = pendingReactions.get(`like:${uri}`);
      const pendingRepost = pendingReactions.get(`repost:${uri}`);
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
        ? `<video class="p-video" controls playsinline preload="metadata" src="${escapeHtml(video.playlist)}"${video.thumbnail ? ` poster="${escapeHtml(video.thumbnail)}"` : ''} aria-label="${escapeHtml(video.alt || 'Video')}"></video>`
        : '';
      const repostLabel = reposter
        ? `<div class="repost-label">${icons.repost || ''} ${escapeHtml(reposter.displayName || reposter.handle || '')} reposted</div>`
        : '';

      return `<div class="post" role="link" tabindex="0" data-uri="${escapeHtml(uri)}" data-cid="${escapeHtml(cid)}" data-likeuri="${escapeHtml(post.viewer?.like || '')}" data-reposturi="${escapeHtml(post.viewer?.repost || '')}" data-author-did="${escapeHtml(author.did || '')}" data-author-handle="${escapeHtml(author.handle || '')}">
        ${repostLabel}
        <div class="post-top">${avatar}<div class="post-meta"><div class="meta-row"><span class="p-name" title="${escapeHtml(author.displayName || author.handle || '')}">${escapeHtml(author.displayName || author.handle || '')}</span><span class="p-handle">@${escapeHtml(author.handle || '')}</span><span class="p-time">${escapeHtml(time)}</span></div></div></div>
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
      const identity = notification.uri || [
        notification.indexedAt,
        reason,
        author.did,
        notification.reasonSubject,
      ].filter(Boolean).join('|');
      const avatar = ui?.renderAvatar ? ui.renderAvatar(author, 28, { delegated: true }) : '';
      const time = ui?.relTime ? ui.relTime(notification.indexedAt) : '';
      return `<div class="notif" role="button" tabindex="0" data-time="${escapeHtml(notification.indexedAt || '')}" data-notification-uri="${escapeHtml(identity)}" data-notification-reason="${escapeHtml(reason)}" data-author-did="${escapeHtml(author.did || '')}" data-author-handle="${escapeHtml(author.handle || '')}" data-target-uri="${escapeHtml(targetUri)}">
        <div class="ntype nt${escapeHtml(reason)}">${notificationIcons[reason] || icons.bell || ''} ${escapeHtml(labels[reason] || reason)}</div>
        <div class="nrow">${avatar}<div class="ninfo"><div class="nwho">${escapeHtml(author.displayName || author.handle || '')}</div><div class="nex">@${escapeHtml(author.handle || '')}</div><div class="nago">${escapeHtml(time)}</div></div></div>
      </div>`;
    }

    async function toggleLike(button, post) {
      const pendingKey = `like:${post.dataset.uri}`;
      if (button.disabled || pendingReactions.has(pendingKey)) return;
      button.disabled = true;
      const active = !button.classList.contains('liked');
      const count = button.querySelector('span');
      const icon = button.querySelector('svg');
      const currentCount = Number.parseInt(count?.textContent || '0', 10) || 0;
      const previousLikeUri = post.dataset.likeuri || '';
      const mutation = { active, previousRecordUri: previousLikeUri };
      pendingReactions.set(pendingKey, mutation);
      button.classList.toggle('liked', active);
      icon?.setAttribute('fill', active ? 'currentColor' : 'none');
      if (count) count.textContent = String(active ? currentCount + 1 : Math.max(0, currentCount - 1));
      syncReactionAcrossColumns({
        uri: post.dataset.uri,
        kind: 'like',
        active,
        recordUri: active ? previousLikeUri : '',
        pending: true,
      });

      try {
        if (active) {
          const result = await adapter.like({ uri: post.dataset.uri, cid: post.dataset.cid });
          post.dataset.likeuri = result?.uri || '';
        } else if (post.dataset.likeuri) {
          await adapter.unlike({ likeUri: post.dataset.likeuri });
          post.dataset.likeuri = '';
        }
        if (pendingReactions.get(pendingKey) === mutation) pendingReactions.delete(pendingKey);
        syncReactionAcrossColumns({
          uri: post.dataset.uri,
          kind: 'like',
          active,
          recordUri: post.dataset.likeuri || '',
        });
        onOutcome({ kind: 'like', status: 'succeeded', active });
      } catch (error) {
        button.classList.toggle('liked', !active);
        icon?.setAttribute('fill', !active ? 'currentColor' : 'none');
        if (count) count.textContent = String(currentCount);
        post.dataset.likeuri = previousLikeUri;
        if (pendingReactions.get(pendingKey) === mutation) pendingReactions.delete(pendingKey);
        syncReactionAcrossColumns({
          uri: post.dataset.uri,
          kind: 'like',
          active: !active,
          recordUri: previousLikeUri,
        });
        onOutcome({ kind: 'like', status: 'failed', active, error });
      } finally {
        button.disabled = false;
      }
    }

    async function toggleRepost(button, post) {
      const pendingKey = `repost:${post.dataset.uri}`;
      if (button.disabled || pendingReactions.has(pendingKey)) return;
      button.disabled = true;
      const active = !button.classList.contains('rted');
      const count = button.querySelector('span');
      const currentCount = Number.parseInt(count?.textContent || '0', 10) || 0;
      const previousRepostUri = post.dataset.reposturi || '';
      const mutation = { active, previousRecordUri: previousRepostUri };
      pendingReactions.set(pendingKey, mutation);
      button.classList.toggle('rted', active);
      if (count) count.textContent = String(active ? currentCount + 1 : Math.max(0, currentCount - 1));
      syncReactionAcrossColumns({
        uri: post.dataset.uri,
        kind: 'repost',
        active,
        recordUri: active ? previousRepostUri : '',
        pending: true,
      });

      try {
        if (active) {
          const result = await adapter.repost({ uri: post.dataset.uri, cid: post.dataset.cid });
          post.dataset.reposturi = result?.uri || '';
        } else if (post.dataset.reposturi) {
          await adapter.unrepost({ repostUri: post.dataset.reposturi });
          post.dataset.reposturi = '';
        }
        if (pendingReactions.get(pendingKey) === mutation) pendingReactions.delete(pendingKey);
        syncReactionAcrossColumns({
          uri: post.dataset.uri,
          kind: 'repost',
          active,
          recordUri: post.dataset.reposturi || '',
        });
        onOutcome({ kind: 'repost', status: 'succeeded', active });
      } catch (error) {
        button.classList.toggle('rted', !active);
        if (count) count.textContent = String(currentCount);
        post.dataset.reposturi = previousRepostUri;
        if (pendingReactions.get(pendingKey) === mutation) pendingReactions.delete(pendingKey);
        syncReactionAcrossColumns({
          uri: post.dataset.uri,
          kind: 'repost',
          active: !active,
          recordUri: previousRepostUri,
        });
        onOutcome({ kind: 'repost', status: 'failed', active, error });
      } finally {
        button.disabled = false;
      }
    }

    function openRepostMenu(button, post, ownerId) {
      if (!documentRef?.createElement || !documentRef?.body) return;
      closeRepostMenu();
      documentRef.getElementById?.('rt-ctx-menu')?.remove?.();
      const menu = documentRef.createElement('div');
      menu.id = 'rt-ctx-menu';
      menu.className = 'bsky-repost-menu';
      const rect = button.getBoundingClientRect?.() || { left: 0, bottom: 0 };
      if (menu.style) {
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 4}px`;
      }
      const active = button.classList.contains('rted');
      menu.innerHTML = `
        <button type="button" data-bsky-menu-action="confirm-repost">${icons.repost || ''} ${active ? 'Undo repost' : 'Repost'}</button>
        <button type="button" data-bsky-menu-action="quote">引用リポスト</button>`;
      menu.addEventListener?.('click', async event => {
        const action = event.target?.closest?.('[data-bsky-menu-action]');
        if (!action) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        if (action.dataset.bskyMenuAction === 'confirm-repost') {
          await toggleRepost(button, post);
        } else if (action.dataset.bskyMenuAction === 'quote') {
          intents.quote?.({
            uri: post.dataset.uri,
            cid: post.dataset.cid,
            handle: post.dataset.authorHandle || '',
          });
        }
        closeRepostMenu();
      });
      documentRef.body.appendChild(menu);
      const pointerDownHandler = event => {
        const clickedInside = menu.contains?.(event.target)
          || event.target?.closest?.('#rt-ctx-menu') === menu;
        if (!clickedInside) closeRepostMenu();
      };
      const keyDownHandler = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault?.();
        closeRepostMenu();
      };
      activeRepostMenu = { menu, ownerId, pointerDownHandler, keyDownHandler };
      documentRef.addEventListener?.('pointerdown', pointerDownHandler, true);
      documentRef.addEventListener?.('keydown', keyDownHandler);
    }

    async function openPostDetail(post, columnId = null) {
      if (!documentRef?.createElement || !documentRef?.body) return;
      closeActiveDetail();
      documentRef.getElementById?.('bsky-post-detail')?.remove?.();
      const overlay = documentRef.createElement('div');
      const detailOwnerId = `detail:${++detailSequence}`;
      overlay.className = 'ov on';
      overlay.id = 'bsky-post-detail';
      overlay.innerHTML = `
        <div class="bsky-post-detail-modal">
          <div class="chead"><h2>ポスト</h2><button class="cbtn" type="button" data-bsky-detail-close title="閉じる">&times;</button></div>
          <div class="bsky-post-detail-body"><div class="feed-loading"><div class="spinner"></div>読み込み中...</div></div>
        </div>`;
      const detailHandlers = createDelegatedHandlers(columnId, detailOwnerId);
      overlay.addEventListener?.('click', event => {
        if (event.target === overlay || event.target?.closest?.('[data-bsky-detail-close]')) {
          closeActiveDetail();
          return;
        }
        return detailHandlers.clickHandler(event);
      });
      overlay.addEventListener?.('keydown', detailHandlers.keyHandler);
      overlay.addEventListener?.('contextmenu', detailHandlers.contextMenuHandler);
      overlay.addEventListener?.('error', detailHandlers.imageErrorHandler, true);
      overlay.addEventListener?.('pointerover', detailHandlers.pointerOverHandler);
      overlay.addEventListener?.('pointerout', detailHandlers.pointerOutHandler);
      documentRef.body.appendChild(overlay);
      activeDetail = { overlay, ownerId: detailOwnerId };
      const body = overlay.querySelector?.('.bsky-post-detail-body');

      try {
        const data = await adapter.getThread({
          uri: post.dataset.uri,
          depth: 12,
          parentHeight: 12,
        });
        const thread = data?.thread;
        if (!thread?.post) throw new Error('ポストを取得できませんでした');
        const parents = collectThreadParents(thread)
          .map(parent => `<div class="bsky-thread-parent">${renderPost({ post: parent })}</div>`)
          .join('');
        const replies = renderThreadReplies(thread.replies);
        if (body) {
          body.innerHTML = `${parents ? `<div class="bsky-thread-label">会話</div>${parents}` : ''}
            <div class="bsky-thread-main">${renderPost({ post: thread.post })}</div>
            ${replies ? `<div class="bsky-thread-label">返信</div>${replies}` : '<div class="feed-empty">返信はありません</div>'}`;
        }
      } catch (error) {
        if (body) body.innerHTML = `<div class="feed-err">${escapeHtml(error.message)}</div>`;
        onOutcome({ kind: 'post-detail', status: 'failed', error });
      }
    }

    function openPost({ uri, cid = '', handle = '' }) {
      if (!uri) return Promise.resolve();
      return openPostDetail({
        dataset: { uri, cid, authorHandle: handle },
      }, null);
    }

    async function search(columnId) {
      const column = columns.get(columnId);
      const query = String(column?.searchInput?.value || '').trim();
      if (!column || !query) return { status: 'deferred', detail: 'query-unavailable' };
      const revision = ++column.revision;
      column.host.innerHTML = '<div class="feed-loading"><div class="spinner"></div>検索中…</div>';
      try {
        const data = await adapter.searchPosts({ query, limit: 40 });
        if (columns.get(columnId) !== column || column.revision !== revision) {
          return { status: 'deferred', detail: 'column-disposed' };
        }
        const posts = (data.posts || [])
          .map(post => ({ post }))
          .filter(item => !muteRules?.blocksPost?.(item))
          .map(renderPost)
          .join('');
        column.host.innerHTML = posts
          || `<div class="feed-empty">「${escapeHtml(query)}」の結果は0件です</div>`;
        return { status: 'succeeded', detail: posts ? 'search-results' : 'no-results' };
      } catch (error) {
        if (columns.get(columnId) === column && column.revision === revision) {
          column.host.innerHTML = `<div class="feed-err">検索エラー: ${escapeHtml(error.message)}<br><button type="button" data-bsky-action="search-retry">再試行</button></div>`;
        }
        onOutcome({ kind: 'search', status: 'failed', columnId, error });
        throw error;
      }
    }

    function createClickHandler(columnId, ownerId = columnId) {
      return async event => {
        const profile = event.target?.closest?.('[data-bsky-profile]');
        if (profile) {
          event.preventDefault?.();
          event.stopPropagation?.();
          intents.openProfile?.({
            did: profile.dataset.did || '',
            handle: profile.dataset.handle || '',
          });
          return;
        }
        if (event.target?.closest?.('[data-bsky-tag]')) {
          event.preventDefault?.();
          event.stopPropagation?.();
          return;
        }
        const image = event.target?.closest?.('[data-bsky-image-index]');
        if (image) {
          event.preventDefault?.();
          event.stopPropagation?.();
          const grid = image.closest?.('.p-imgs');
          try {
            const urls = JSON.parse(grid?.dataset?.urls || '[]');
            intents.openImages?.({
              urls,
              startIndex: Number.parseInt(image.dataset.bskyImageIndex || '0', 10) || 0,
            });
          } catch {}
          return;
        }
        const action = event.target?.closest?.('[data-bsky-action]');
        if (action) {
          const actionName = action.dataset?.bskyAction;
          if (actionName === 'load-more') {
            event.preventDefault?.();
            await refresh(columnId, { mode: 'append' });
            return;
          }
          if (actionName === 'retry') {
            event.preventDefault?.();
            await refresh(columnId, { mode: 'replace' });
            return;
          }
          if (actionName === 'search-retry') {
            event.preventDefault?.();
            await search(columnId);
            return;
          }
          const post = action.closest('.post');
          if (!post) return;
          event.preventDefault?.();
          event.stopPropagation?.();
          if (actionName === 'like') {
            await toggleLike(action, post);
          } else if (actionName === 'reply') {
            closeActiveDetail();
            intents.reply?.({
              uri: post.dataset.uri,
              cid: post.dataset.cid,
              handle: post.dataset.authorHandle || '',
            });
          } else if (actionName === 'repost') {
            openRepostMenu(action, post, ownerId);
          }
          return;
        }
        if (event.target?.closest?.('button,a,img,video,.p-imgs,input,textarea')) return;
        const notification = event.target?.closest?.('.notif');
        if (notification && columns.has(columnId)) {
          event.preventDefault?.();
          intents.activateNotification?.({
            reason: notification.dataset.notificationReason || '',
            authorDid: notification.dataset.authorDid || '',
            authorHandle: notification.dataset.authorHandle || '',
            targetUri: notification.dataset.targetUri || '',
          });
          return;
        }
        const post = event.target?.closest?.('.post');
        if (!post || (columnId && !columns.has(columnId))) return;
        if (global.getSelection?.()?.toString()) return;
        event.preventDefault?.();
        await openPostDetail(post, columnId);
      };
    }

    function createDelegatedHandlers(columnId, ownerId = columnId) {
      const delegatedClickHandler = createClickHandler(columnId, ownerId);
      const clickHandler = event => Promise.resolve(delegatedClickHandler(event)).catch(() => {});
      const keyHandler = event => {
        if (!['Enter', ' '].includes(event.key)) return;
        const isInteractive = event.target?.closest?.('.post')
          || event.target?.closest?.('.notif')
          || event.target?.closest?.('[data-bsky-profile]');
        if (!isInteractive) return;
        event.preventDefault?.();
        return clickHandler(event);
      };
      const contextMenuHandler = event => {
        const post = event.target?.closest?.('.post');
        if (!post) return;
        event.preventDefault?.();
        intents.openPostMenu?.({
          handle: post.dataset.authorHandle || '',
          x: Number(event.clientX) || 0,
          y: Number(event.clientY) || 0,
        });
      };
      const pointerOverHandler = event => {
        const profile = event.target?.closest?.('[data-bsky-profile]');
        if (!profile || profile.contains?.(event.relatedTarget)) return;
        clearProfileHoverTimer();
        profileHoverTimerOwnerId = ownerId;
        if (hoverDelay <= 0) return showProfileCard(ownerId, event.target, profile);
        profileHoverTimer = schedule(() => {
          showProfileCard(ownerId, event.target, profile).catch(() => {});
        }, hoverDelay);
      };
      const pointerOutHandler = event => {
        const profile = event.target?.closest?.('[data-bsky-profile]');
        if (!profile || profile.contains?.(event.relatedTarget)) return;
        clearProfileHoverTimer(ownerId);
        profileHoverTimerOwnerId = ownerId;
        profileHoverTimer = schedule(() => removeProfileCard(), 150);
      };
      const imageErrorHandler = event => {
        if (event.target?.matches?.('.av img')) event.target.style.display = 'none';
      };
      return {
        clickHandler,
        contextMenuHandler,
        imageErrorHandler,
        keyHandler,
        pointerOutHandler,
        pointerOverHandler,
      };
    }

    function mount({
      id,
      type,
      feedUri = null,
      host,
      badge = null,
      searchInput = null,
      searchButton = null,
    }) {
      if (!id || !host) throw new Error('Bluesky Column requires an id and host');
      const {
        clickHandler,
        contextMenuHandler,
        imageErrorHandler,
        keyHandler,
        pointerOutHandler,
        pointerOverHandler,
      } = createDelegatedHandlers(id);
      const scrollHandler = () => {
        if (badge) badge.style.display = 'none';
      };
      const searchHandler = () => search(id).catch(() => {});
      const searchKeyHandler = event => {
        if (event.key !== 'Enter') return;
        event.preventDefault?.();
        return search(id).catch(() => {});
      };
      host.addEventListener?.('click', clickHandler);
      host.addEventListener?.('keydown', keyHandler);
      host.addEventListener?.('contextmenu', contextMenuHandler);
      host.addEventListener?.('error', imageErrorHandler, true);
      host.addEventListener?.('pointerover', pointerOverHandler);
      host.addEventListener?.('pointerout', pointerOutHandler);
      host.addEventListener?.('scroll', scrollHandler);
      searchInput?.addEventListener?.('keydown', searchKeyHandler);
      searchButton?.addEventListener?.('click', searchHandler);
      columns.set(id, {
        id,
        type,
        feedUri,
        host,
        badge,
        cursor: null,
        revision: 0,
        clickHandler,
        keyHandler,
        contextMenuHandler,
        imageErrorHandler,
        pointerOverHandler,
        pointerOutHandler,
        scrollHandler,
        searchInput,
        searchButton,
        searchHandler,
        searchKeyHandler,
      });
    }

    async function refresh(id, { mode = 'replace' } = {}) {
      const column = columns.get(id);
      if (!column) return { status: 'deferred', detail: 'column-unavailable' };
      if (!['timeline', 'feed', 'notif'].includes(column.type)) {
        return { status: 'deferred', detail: 'unsupported-column-type' };
      }
      const revision = ++column.revision;
      const seenAt = column.type === 'notif' && mode === 'replace' ? now() : null;

      if (mode === 'replace') {
        column.cursor = null;
        column.host.innerHTML = '<div class="feed-loading"><div class="spinner"></div>読み込み中…</div>';
      }

      const isPrepend = mode === 'prepend';
      let data;
      try {
        const request = { limit: isPrepend ? 10 : 40, cursor: isPrepend ? null : column.cursor };
        if (column.type === 'feed') {
          data = await adapter.getFeed({ feedUri: column.feedUri, ...request });
        } else if (column.type === 'notif') {
          data = await adapter.listNotifications({ limit: request.limit });
        } else {
          data = await adapter.getTimeline(request);
        }
      } catch (error) {
        if (columns.get(id) === column && column.revision === revision && mode === 'replace') {
          column.host.innerHTML = `<div class="feed-err">取得エラー: ${escapeHtml(error.message)}<br><button type="button" data-bsky-action="retry">再試行</button></div>`;
        }
        onOutcome({ kind: 'refresh', status: 'failed', columnId: id, error });
        throw error;
      }
      if (columns.get(id) !== column || column.revision !== revision) {
        return { status: 'deferred', detail: 'column-disposed' };
      }
      let items = column.type === 'notif' ? (data.notifications || []) : (data.feed || []);
      if (isPrepend) {
        if (column.type === 'notif') {
          const existingNotificationUris = new Set(
            Array.from(column.host.querySelectorAll?.('.notif[data-notification-uri]') || [])
              .map(element => element.dataset?.notificationUri)
              .filter(Boolean),
          );
          items = items.filter(item => {
            const identity = item.uri || [
              item.indexedAt,
              item.reason,
              item.author?.did,
              item.reasonSubject,
            ].filter(Boolean).join('|');
            return !existingNotificationUris.has(identity);
          });
        } else {
          syncPostMetrics(column.host, items);
          reapplyPendingReactions();
          const existingUris = new Set(
            Array.from(column.host.querySelectorAll?.('.post[data-uri]') || [])
              .map(element => element.dataset?.uri)
              .filter(Boolean),
          );
          items = items.filter(item => {
            const uri = item.post?.uri || item.uri;
            return !uri || !existingUris.has(uri);
          });
        }
        if (items.length === 0) return { status: 'succeeded', detail: 'no-changes' };
      } else if (column.type !== 'notif') {
        column.cursor = data.cursor || null;
      }
      items = items.filter(item => column.type === 'notif'
        ? !muteRules?.blocksNotification?.(item)
        : !muteRules?.blocksPost?.(item));
      const renderedItems = items.map(item => column.type === 'notif'
        ? renderNotification(item)
        : renderPost(item)).join('');
      const loadMore = column.type !== 'notif' && column.cursor
        ? '<button class="load-more" type="button" data-bsky-action="load-more">もっと見る</button>'
        : '';
      if (mode === 'append') {
        column.host.querySelector?.('.load-more')?.remove();
        column.host.insertAdjacentHTML?.('beforeend', renderedItems + loadMore);
        trimRenderedItems(column.host, { removeFrom: 'start', preserveScroll: true });
        return { status: 'succeeded', detail: 'appended' };
      }
      if (isPrepend) {
        if (!renderedItems) return { status: 'succeeded', detail: 'filtered' };
        const previousScrollTop = Number(column.host.scrollTop) || 0;
        const wasAtTop = previousScrollTop < 50;
        const previousChildCount = column.host.children?.length || 0;
        column.host.insertAdjacentHTML?.('afterbegin', renderedItems);
        const addedCount = Math.max(0, (column.host.children?.length || 0) - previousChildCount);
        const addedElements = Array.from(column.host.children || []).slice(0, addedCount);
        addedElements.forEach(element => element.classList?.add?.('sd-new'));
        if (wasAtTop) {
          requestFrame?.(() => column.host.scrollTo?.({ top: 0, behavior: 'smooth' }));
        } else {
          requestFrame?.(() => {
            column.host.scrollTop = previousScrollTop
              + addedElements.reduce((height, element) => height + (element.offsetHeight || 0), 0);
          });
        }
        schedule?.(() => addedElements.forEach(element => element.classList?.remove?.('sd-new')), 600);
        trimRenderedItems(column.host, { removeFrom: 'end' });
        if (column.badge) {
          column.badge.textContent = `+${items.length}`;
          column.badge.style.display = '';
          schedule?.(() => { column.badge.style.display = 'none'; }, 5000);
        }
        return { status: 'succeeded', detail: 'new-items' };
      }
      column.host.innerHTML = renderedItems
        || `<div class="feed-empty">${column.type === 'notif' ? '通知がありません' : '投稿がありません'}</div>`;
      column.host.innerHTML += loadMore;
      trimRenderedItems(column.host, { removeFrom: 'end' });
      if (column.type === 'notif' && mode === 'replace') {
        try {
          await adapter.markNotificationsSeen({ seenAt });
          if (columns.get(id) === column && column.revision === revision) {
            intents.clearNotificationUnread?.();
          }
        } catch (error) {
          onOutcome({ kind: 'notification-seen', status: 'failed', columnId: id, error });
        }
      }
      return { status: 'succeeded', detail: 'replaced' };
    }

    function dispose(id) {
      const column = columns.get(id);
      if (!column) return false;
      column.revision += 1;
      column.host.removeEventListener?.('click', column.clickHandler);
      column.host.removeEventListener?.('keydown', column.keyHandler);
      column.host.removeEventListener?.('contextmenu', column.contextMenuHandler);
      column.host.removeEventListener?.('error', column.imageErrorHandler, true);
      column.host.removeEventListener?.('pointerover', column.pointerOverHandler);
      column.host.removeEventListener?.('pointerout', column.pointerOutHandler);
      column.host.removeEventListener?.('scroll', column.scrollHandler);
      column.searchInput?.removeEventListener?.('keydown', column.searchKeyHandler);
      column.searchButton?.removeEventListener?.('click', column.searchHandler);
      columns.delete(id);
      clearProfileHoverTimer(id);
      if (profileCardOwnerId === id) removeProfileCard();
      closeRepostMenu(id);
      return true;
    }

    function getMemoryStats() {
      let renderedItemCount = 0;
      columns.forEach(column => {
        renderedItemCount += column.host?.querySelectorAll?.('.post, .notif')?.length || 0;
      });
      return { columnCount: columns.size, renderedItemCount };
    }

    function trimAll() {
      let removed = 0;
      columns.forEach(column => {
        const items = Array.from(column.host?.querySelectorAll?.('.post, .notif') || []);
        const overflow = Math.max(0, items.length - MAX_RENDERED_ITEMS);
        const overflowHeight = items.slice(0, overflow)
          .reduce((height, item) => height + (Number(item.offsetHeight) || 0), 0);
        const preserveScroll = (Number(column.host?.scrollTop) || 0) > overflowHeight + 50;
        removed += trimRenderedItems(column.host, {
          removeFrom: preserveScroll ? 'start' : 'end',
          preserveScroll,
        });
      });
      return removed;
    }

    return { dispose, getMemoryStats, mount, openPost, refresh, trimAll };
  }

  global.SocialDeckBlueskyColumnsRuntime = { createBlueskyColumnsRuntime };
})(window);
