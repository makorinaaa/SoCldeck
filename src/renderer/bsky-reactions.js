(function (global) {
  function createBlueskyReactions({
    adapter,
    documentRef = global.document,
    icons = {},
    intents = {},
    onOutcome = () => {},
    getHosts = () => [],
  } = {}) {
    if (!adapter) throw new Error('Bluesky Reactions require an authenticated adapter');
    const pendingReactions = new Map();
    let activeRepostMenu = null;

    function getPendingReaction(kind, uri) {
      return pendingReactions.get(`${kind}:${uri}`) || null;
    }

    function setMetric(element, selector, value) {
      const metric = element.querySelector?.(selector);
      if (metric) metric.textContent = String(value || 0);
    }

    function syncReactionAcrossColumns({ uri, kind, active, recordUri = '', pending = false }) {
      getHosts().forEach(host => {
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

    function closeRepostMenu(ownerId = null) {
      if (!activeRepostMenu || (ownerId && activeRepostMenu.ownerId !== ownerId)) return;
      const { menu, pointerDownHandler, keyDownHandler } = activeRepostMenu;
      documentRef?.removeEventListener?.('pointerdown', pointerDownHandler, true);
      documentRef?.removeEventListener?.('keydown', keyDownHandler);
      menu.remove?.();
      activeRepostMenu = null;
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

    return {
      closeRepostMenu,
      getPendingReaction,
      openRepostMenu,
      reapplyPendingReactions,
      syncPostMetrics,
      toggleLike,
      toggleRepost,
    };
  }

  global.SocialDeckBlueskyReactions = { createBlueskyReactions };
})(window);
