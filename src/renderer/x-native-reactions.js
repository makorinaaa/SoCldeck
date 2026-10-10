(function (global) {

  // Likes, reposts and deletion for native X posts, through X's own buttons: on the hidden
  // home page when the post is still there, otherwise on the account's status page.
  // Pending state is kept per account, since liked / reposted differs between accounts.
  function createXNativeReactions({
    documentRef = global.document,
    statusRuntime = null,
    icons = {},
    intents = {},
    log = () => {},
    confirmAction = () => true,
    isBusy = () => false,
    createToggleScript = null,
    getReader = () => null,
    updatePost = () => {},
    removePost = () => {},
    renderPartition = () => {},
    rerenderEverything = () => {},
  } = {}) {
    const { placeOnTop } = global.SocialDeckXNativePosts;
    const pendingReactions = new Map();
    const deleting = new Set();
    let activeMenu = null;

    function reactionKey(kind, id, partition) {
      return `${partition}|${kind}:${id}`;
    }

    function getPendingReaction(kind, id, partition) {
      return pendingReactions.get(reactionKey(kind, id, partition)) || null;
    }

    function isDeleting(partition, id) {
      return deleting.has(`${partition}|${id}`);
    }

    async function toggle(kind, post, partition) {
      const key = reactionKey(kind, post.id, partition);
      if (pendingReactions.has(key) || !statusRuntime) return;
      const field = kind === 'like' ? 'liked' : 'reposted';
      const countField = kind === 'like' ? 'like' : 'repost';
      const active = !post.viewer?.[field];
      pendingReactions.set(key, { active });
      renderPartition(partition);
      try {
        let result = await toggleInReader(partition, post, kind, active);
        log('reaction (home)', kind, post.id, result);
        // 投稿ページで押し直すのは、ホームで X のボタンを押していないと分かるときだけ。
        // 押した後に確認できなかった（unconfirmed）・途中で失敗した（failed）ときに押し直すと、
        // 同じいいね・リポストが2回送られることがある
        if (result === 'skipped' || result === 'missing') {
          result = await statusRuntime.toggle(partition, post, kind, active);
          log('reaction (status page)', kind, post.id, result);
        }
        if (result !== 'done' && result !== 'already') {
          throw new Error(['unconfirmed', 'failed'].includes(result)
            ? 'X で反映を確認できませんでした。X で状態を確かめてから操作してください'
            : 'X で操作できませんでした');
        }
        updatePost(post.id, current => ({
          viewer: { ...current.viewer, [field]: active },
          counts: {
            ...current.counts,
            [countField]: Math.max(0, (Number(current.counts?.[countField]) || 0)
              + (result === 'done' && Boolean(current.viewer?.[field]) !== active ? (active ? 1 : -1) : 0)),
          },
        }), partition);
        if (kind === 'repost') showOwnRepost(post.id, partition, active);
        intents.onOutcome?.({ kind, status: 'succeeded', active });
      } catch (error) {
        intents.onOutcome?.({ kind, status: 'failed', active, error });
      } finally {
        pendingReactions.delete(key);
        renderPartition(partition);
      }
    }

    // X does not put the account's own repost on top of its home right away: SocialDeck does,
    // like it does for the account's new posts.
    function showOwnRepost(id, partition, active) {
      const reader = getReader(partition);
      const shown = reader?.posts.find(post => post.id === id);
      if (!reader || !shown) return;
      if (active) {
        const others = reader.posts.filter(post => post.id !== id);
        const [moved] = placeOnTop([{ ...shown, repostedBy: { handle: '', name: 'あなた', self: true } }], others);
        reader.posts = [moved, ...others];
      } else if (shown.repostedBy?.self) {
        reader.posts = reader.posts.map(post => (post.id === id ? { ...post, repostedBy: null } : post));
      }
    }

    // The hidden home page usually still holds recent posts: pressing X's button there needs
    // no navigation, so a like lands in a fraction of the time a status page takes.
    async function toggleInReader(partition, post, kind, active) {
      const reader = getReader(partition);
      if (!createToggleScript || !reader || reader.status !== 'ready' || reader.webContentsId === null
        || reader.switching || isBusy()) return 'skipped';
      try {
        return await reader.webview.executeJavaScript(createToggleScript({ statusId: post.id, action: kind, active }));
      } catch {
        return 'failed';
      }
    }

    async function deletePost(post, partition) {
      const key = `${partition}|${post.id}`;
      if (deleting.has(key) || !statusRuntime?.remove) return;
      if (!confirmAction('このポストを削除しますか？この操作は取り消せません。')) return;
      deleting.add(key);
      renderPartition(partition);
      try {
        let result = await statusRuntime.remove(partition, post);
        log('delete', post.id, result);
        // Failures before X's confirm button was pressed leave the post untouched: one retry
        // covers a status page that was still starting up.
        if (['missing', 'menu-missing', 'delete-missing', 'confirm-missing'].includes(result)) {
          result = await statusRuntime.remove(partition, post);
          log('delete retry', post.id, result);
        }
        if (result !== 'done') {
          throw new Error(result === 'delete-missing' ? 'X で削除メニューが見つかりませんでした' : 'X で削除を確認できませんでした');
        }
        removePost(post.id);
        intents.onOutcome?.({ kind: 'delete', status: 'succeeded' });
      } catch (error) {
        intents.onOutcome?.({ kind: 'delete', status: 'failed', error });
      } finally {
        deleting.delete(key);
        rerenderEverything();
      }
    }

    function closeMenu() {
      if (!activeMenu) return;
      documentRef.removeEventListener?.('pointerdown', activeMenu.handlePointerDown, true);
      documentRef.removeEventListener?.('keydown', activeMenu.handleKeyDown);
      activeMenu.menu.remove?.();
      activeMenu = null;
    }

    function showMenu(button, html, onAction) {
      closeMenu();
      if (!documentRef.body) return;
      const menu = documentRef.createElement('div');
      menu.className = 'bsky-repost-menu';
      const rect = button.getBoundingClientRect?.() || { left: 0, bottom: 0 };
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 4}px`;
      menu.innerHTML = html;
      menu.addEventListener('click', event => {
        const action = event.target?.closest?.('[data-x-menu-action]')?.dataset.xMenuAction;
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        onAction(action);
      });
      const handlePointerDown = event => {
        if (!menu.contains?.(event.target)) closeMenu();
      };
      const handleKeyDown = event => {
        if (event.key === 'Escape') closeMenu();
      };
      documentRef.body.appendChild(menu);
      documentRef.addEventListener?.('pointerdown', handlePointerDown, true);
      documentRef.addEventListener?.('keydown', handleKeyDown);
      activeMenu = { menu, handlePointerDown, handleKeyDown };
    }

    function openMoreMenu(button, post, partition) {
      showMenu(button, `<button type="button" class="x-menu-danger" data-x-menu-action="delete">${icons.trash || ''} 削除</button>`, action => {
        if (action === 'delete') deletePost(post, partition);
      });
    }

    function openRepostMenu(button, post, partition, { own = false } = {}) {
      const reposted = Boolean(post.viewer?.reposted);
      // Someone else's protected post can be neither reposted nor quoted, only un-reposted.
      const blocked = Boolean(post.author?.protected) && !own;
      if (blocked && !reposted) return;
      showMenu(button, `
        <button type="button" data-x-menu-action="repost">${icons.repost || ''} ${reposted ? 'リポストを取り消す' : 'リポスト'}</button>
        ${blocked ? '' : '<button type="button" data-x-menu-action="quote">引用</button>'}`, action => {
        if (action === 'repost') toggle('repost', post, partition);
        else intents.quote?.({ id: post.id, url: post.url, handle: post.author?.handle || '', partition });
      });
    }

    return {
      closeMenu,
      getPendingReaction,
      isDeleting,
      isMenuOpen: () => Boolean(activeMenu),
      openMoreMenu,
      openRepostMenu,
      toggle,
    };
  }

  global.SocialDeckXNativeReactions = { createXNativeReactions };
})(window);
