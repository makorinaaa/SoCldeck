(function (global) {
  const { escapeHtml } = global.SocialDeckHtmlEscape;

  const DETAIL_WAIT_MS = 6000;

  // The post detail overlay: a post with the conversation around it, like Bluesky's. The
  // conversation comes from the status page X fetches in the account's hidden status page.
  function createXNativeDetail({
    documentRef = global.document,
    statusRuntime = null,
    renderPost,
    renderThread = null,
    postOptions = (post, partition) => ({ partition }),
    handleInteractive = () => false,
    isMenuOpen = () => false,
    updatePost = () => {},
    renderPartition = () => {},
    intents = {},
    log = () => {},
    setTimeoutFn = global.setTimeout,
    clearTimeoutFn = global.clearTimeout,
  } = {}) {
    let activeDetail = null;
    // A status page may be fetched before the detail view knows which post it shows.
    const recentDetails = new Map();

    function close() {
      if (!activeDetail) return;
      documentRef.removeEventListener?.('keydown', activeDetail.handleKeyDown);
      activeDetail.overlay.remove?.();
      activeDetail = null;
    }

    function render() {
      if (!activeDetail) return;
      const body = activeDetail.overlay.querySelector?.('.bsky-post-detail-body');
      if (!body) return;
      const html = detailHtml(activeDetail);
      if (activeDetail.renderedHtml === html) return;
      activeDetail.renderedHtml = html;
      body.innerHTML = html;
    }

    function detailHtml(detail) {
      const { data, fallback, error } = detail;
      if (data && renderThread) {
        return renderThread(data, {
          partition: detail.partition,
          postOptions: post => postOptions(post, detail.partition),
        });
      }
      if (!fallback) {
        const preview = detail.previewText
          ? `<div class="x-detail-preview">${escapeHtml(detail.previewText).replace(/\n/g, '<br>')}</div>`
          : '';
        return error
          ? `<div class="feed-err">${escapeHtml(error)}</div>`
          : `${preview}<div class="feed-loading"><div class="spinner"></div>ポストを探しています…</div>`;
      }
      return renderPost(fallback, { ...postOptions(fallback, detail.partition), focal: true })
        + (error
          ? `<div class="feed-err">${escapeHtml(error)}</div>`
          : '<div class="feed-loading"><div class="spinner"></div>返信を読み込み中…</div>');
    }

    // Opens a post: an overlay with the conversation around it.
    function open(post, partition) {
      if (!post?.id) return null;
      const detail = createDetail(partition, post);
      if (detail && statusRuntime) loadDetail(detail, post);
      return detail;
    }

    // Opens the detail view first and fills it once the post is known, for example when
    // a notification only reveals its post after X's notification page is followed.
    async function openFrom(partition, findPost, { previewText = '' } = {}) {
      const detail = createDetail(partition, null, { previewText });
      if (!detail) return null;
      let post = null;
      try {
        post = await findPost();
      } catch {}
      if (activeDetail !== detail) return null;
      if (!post?.id) {
        close();
        return null;
      }
      detail.focalId = post.id;
      detail.fallback = post;
      useCachedDetail(detail);
      render();
      if (statusRuntime) loadDetail(detail, post);
      return detail;
    }

    // A cached status page shows at once, but it may predate newer replies, so the view
    // still waits for X to fetch the page again (see loadDetail).
    // A page fetched for the post itself carries its replies; prefer it to the page of a
    // reply that only lists this post as an ancestor.
    function useCachedDetail(detail) {
      const shaped = (recentDetails.get(detail.partition) || [])
        .map(payload => shapeDetail(payload, detail.focalId))
        .filter(Boolean);
      detail.data = shaped.find(data => data.ownsReplies) || shaped[0] || detail.data;
    }

    function createDetail(partition, post, { previewText = '' } = {}) {
      if (!documentRef.body) return null;
      close();
      const overlay = documentRef.createElement('div');
      overlay.className = 'ov on';
      overlay.id = 'x-post-detail';
      overlay.innerHTML = `
        <div class="bsky-post-detail-modal">
          <div class="chead"><h2>ポスト</h2><button class="cbtn" type="button" data-x-detail-external title="X で開く">↗</button><button class="cbtn" type="button" data-x-detail-close title="閉じる">&times;</button></div>
          <div class="bsky-post-detail-body"></div>
        </div>`;
      const detail = { overlay, partition, focalId: post?.id || null, fallback: post, data: null, fresh: false, error: '', previewText };
      detail.handleKeyDown = event => {
        if (event.key === 'Escape' && !isMenuOpen()) close();
      };
      overlay.addEventListener('click', event => {
        if (event.target === overlay || event.target?.closest?.('[data-x-detail-close]')) {
          close();
          return;
        }
        if (event.target?.closest?.('[data-x-detail-external]')) {
          if (detail.fallback?.url) intents.openExternal?.({ url: detail.fallback.url });
          return;
        }
        const clicked = event.target?.closest?.('[data-x-id]');
        if (clicked?.dataset.xId === detail.focalId && !event.target?.closest?.('[data-x-action], img, video, a[href], .p-quote')) return;
        handleInteractive(event, partition);
      });
      documentRef.addEventListener?.('keydown', detail.handleKeyDown);
      documentRef.body.appendChild(overlay);
      activeDetail = detail;
      if (post) useCachedDetail(detail);
      render();
      return detail;
    }

    // Shapes a captured status page around the post the detail view asked for.
    function shapeDetail(payload, focalId) {
      const thread = payload.thread || [];
      const index = thread.findIndex(post => post.id === focalId);
      if (index < 0) return null;
      const ownsReplies = !payload.focalId || payload.focalId === focalId;
      return {
        focalId,
        ownsReplies,
        ancestors: thread.slice(0, index),
        focal: thread[index],
        replies: ownsReplies ? payload.replies || [] : [],
      };
    }

    // Waits for a status page captured after the view opened, not a cached one.
    function waitForDetail(detail, timeoutMs) {
      return new Promise(resolve => {
        if (detail.fresh) {
          resolve(true);
          return;
        }
        const timer = setTimeoutFn(() => {
          detail.onData = null;
          resolve(detail.fresh);
        }, timeoutMs);
        detail.onData = () => {
          clearTimeoutFn(timer);
          detail.onData = null;
          resolve(true);
        };
      });
    }

    // X can serve an already visited status from its cache without fetching the
    // conversation again; one full page load then makes it fetch TweetDetail.
    async function loadDetail(detail, post) {
      try {
        await statusRuntime.run(detail.partition, post);
        if (await waitForDetail(detail, DETAIL_WAIT_MS) || activeDetail !== detail) return;
        log('detail reload', post.id);
        await statusRuntime.run(detail.partition, post, undefined, { reload: true });
        if (await waitForDetail(detail, DETAIL_WAIT_MS) || activeDetail !== detail) return;
        // Keep showing a cached conversation rather than replacing it with an error.
        if (detail.data) return;
        detail.error = '返信を読み込めませんでした';
      } catch (error) {
        if (activeDetail !== detail) return;
        detail.error = error?.message || 'ポストを開けませんでした';
      }
      render();
    }

    function handleStatusCapture(partition, payload) {
      intents.postsSeen?.(partition, [...(payload.thread || []), ...(payload.posts || [])]);
      log('status captured', payload.operation, payload.focalId || '', activeDetail?.focalId || '');
      if (payload.operation === 'TweetDetail') {
        recentDetails.set(partition, [payload, ...(recentDetails.get(partition) || [])].slice(0, 5));
        (payload.thread || []).forEach(post => {
          updatePost(post.id, () => ({ counts: post.counts, viewer: post.viewer }), partition);
        });
        const detail = activeDetail?.partition === partition ? activeDetail : null;
        const shaped = detail && shapeDetail(payload, detail.focalId);
        if (shaped?.ownsReplies) {
          detail.data = shaped;
          detail.fresh = true;
          detail.error = '';
          detail.onData?.();
        } else if (shaped && !detail.data) {
          // Another post's page shows this one without its replies: a placeholder only.
          detail.data = shaped;
        }
        renderPartition(partition);
        return;
      }
      if (payload.operation === 'CreateTweet' && activeDetail?.data && activeDetail.partition === partition) {
        const [created] = payload.posts || [];
        if (!created) return;
        const data = activeDetail.data;
        if (created.replyTo && !data.replies.some(chain => chain.post.id === created.id)) {
          activeDetail.data = { ...data, replies: [{ post: created, replies: [] }, ...data.replies] };
          updatePost(data.focal.id, current => ({
            counts: { ...current.counts, reply: (Number(current.counts?.reply) || 0) + 1 },
          }), partition);
          renderPartition(partition);
        }
      }
    }

    // The posts the open detail view shows for this account (for clicks and updates).
    function postsOf(partition) {
      const detail = activeDetail?.partition === partition ? activeDetail : null;
      if (!detail) return [];
      const posts = [];
      if (detail.data) {
        const { ancestors = [], focal, replies = [] } = detail.data;
        posts.push(...ancestors, focal, ...replies.flatMap(chain => [chain.post, ...(chain.replies || [])]));
      }
      if (detail.fallback) posts.push(detail.fallback);
      return posts;
    }

    // Applies an immutable post update to the open detail view of this account.
    function applyUpdate(apply, partition) {
      if (activeDetail?.partition !== partition) return;
      if (activeDetail.data) {
        const data = activeDetail.data;
        activeDetail.data = {
          ...data,
          ancestors: (data.ancestors || []).map(apply),
          focal: apply(data.focal),
          replies: (data.replies || []).map(chain => ({ post: apply(chain.post), replies: (chain.replies || []).map(apply) })),
        };
      }
      if (activeDetail.fallback) activeDetail.fallback = apply(activeDetail.fallback);
    }

    // A deleted post leaves the open detail view and every cached status page.
    function removePost(id) {
      const keep = post => post?.id !== id;
      recentDetails.forEach((payloads, partition) => {
        recentDetails.set(partition, payloads.map(payload => ({
          ...payload,
          thread: (payload.thread || []).filter(keep),
          replies: (payload.replies || []).filter(chain => keep(chain.post))
            .map(chain => ({ ...chain, replies: (chain.replies || []).filter(keep) })),
        })));
      });
      if (!activeDetail) return;
      if (activeDetail.focalId === id) {
        close();
        return;
      }
      const data = activeDetail.data;
      if (data) {
        activeDetail.data = {
          ...data,
          ancestors: data.ancestors.filter(post => post.id !== id),
          replies: data.replies
            .filter(chain => chain.post.id !== id)
            .map(chain => ({ ...chain, replies: (chain.replies || []).filter(post => post.id !== id) })),
        };
      }
    }

    // An account's cached status pages (and its open detail, when its last Column goes).
    function forget(partition, { closeOpen = false } = {}) {
      recentDetails.delete(partition);
      if (closeOpen && activeDetail?.partition === partition) close();
    }

    return {
      applyUpdate,
      close,
      forget,
      handleStatusCapture,
      isOpenFor: partition => activeDetail?.partition === partition,
      open,
      openFrom,
      overlay: () => activeDetail?.overlay || null,
      postsOf,
      removePost,
      render,
    };
  }

  global.SocialDeckXNativeDetail = { createXNativeDetail };
})(window);
