// Single-key shortcuts for moving between and acting on posts, TweetDeck style.
// Bluesky posts and notifications are rendered with tabindex, so the focused
// element is the selection; X columns are WebViews and keep X's own shortcuts.
const ITEM_SELECTOR = '.post, .notif';
const DETAIL_ID = 'bsky-post-detail';
const POST_ACTION_KEYS = { l: 'like', t: 'repost', r: 'reply' };

function createKeyboardNavigation({ documentRef, actions = {} }) {
  function isTyping(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(target.tagName || '').toUpperCase());
  }

  function isBlocked() {
    if (documentRef.getElementById('login-screen')?.classList.contains('hidden') === false) return true;
    if (documentRef.getElementById('lightbox')?.classList.contains('on')) return true;
    return Array.from(documentRef.querySelectorAll('.ov'))
      .some(overlay => overlay.classList.contains('on') && overlay.id !== DETAIL_ID);
  }

  function columns() {
    return Array.from(documentRef.querySelectorAll('.col'))
      .filter(column => !column.classList.contains('collapsed'));
  }

  function currentItem() {
    return documentRef.activeElement?.closest?.(ITEM_SELECTOR) || null;
  }

  function scopeOf(element) {
    return element?.closest?.(`#${DETAIL_ID}`) || element?.closest?.('.col') || null;
  }

  function itemsIn(scope) {
    return scope ? Array.from(scope.querySelectorAll(ITEM_SELECTOR)).filter(item => !item.hidden) : [];
  }

  function focusItem(item) {
    if (!item) return false;
    item.focus?.({ preventScroll: true });
    item.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  function moveWithin(delta) {
    const current = currentItem();
    if (!current) {
      const detail = documentRef.getElementById(DETAIL_ID);
      const scope = detail?.classList.contains('on') ? detail : columns().find(column => itemsIn(column).length);
      return focusItem(itemsIn(scope)[0]);
    }
    const items = itemsIn(scopeOf(current));
    const index = items.indexOf(current);
    return focusItem(items[index + delta]) || true;
  }

  function focusColumn(column) {
    if (!column) return false;
    column.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const target = itemsIn(column)[0] || column.querySelector('webview');
    target?.focus?.({ preventScroll: true });
    return true;
  }

  function moveAcross(delta) {
    const current = currentItem();
    const column = current?.closest?.('.col');
    if (!column || current.closest(`#${DETAIL_ID}`)) return false;
    const list = columns();
    return focusColumn(list[list.indexOf(column) + delta]) || true;
  }

  function runPostAction(name) {
    const current = currentItem();
    const button = current && Array.from(current.querySelectorAll('[data-bsky-action]'))
      .find(element => element.dataset.bskyAction === name);
    if (button && !button.disabled) button.click();
    return Boolean(current);
  }

  function composeNetwork() {
    const column = currentItem()?.closest?.('.col') || documentRef.activeElement?.closest?.('.col');
    if (!column) return null;
    return column.querySelector('webview') ? 'x' : 'bluesky';
  }

  function handle(key) {
    if (key === 'j') return moveWithin(1);
    if (key === 'k') return moveWithin(-1);
    if (key === 'ArrowRight' && currentItem()) return moveAcross(1);
    if (key === 'ArrowLeft' && currentItem()) return moveAcross(-1);
    if (POST_ACTION_KEYS[key]) return runPostAction(POST_ACTION_KEYS[key]);
    if (key === 'o' && currentItem()) { currentItem().click(); return true; }
    if (/^[1-9]$/.test(key)) return focusColumn(columns()[Number(key) - 1]);
    if (key === 'n') { actions['open-compose']?.({ network: composeNetwork() }); return true; }
    if (key === '?') { actions['open-shortcuts']?.(); return true; }
    if (key === 'Escape' && currentItem() && !currentItem().closest(`#${DETAIL_ID}`)) {
      documentRef.activeElement.blur?.();
      return true;
    }
    return false;
  }

  // Returns true when the key was consumed so the caller can preventDefault.
  function onKeydown(event) {
    if (event.defaultPrevented || event.isComposing) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (isTyping(event.target) || isTyping(documentRef.activeElement)) return false;
    if (isBlocked()) return false;
    if (!handle(event.key)) return false;
    event.preventDefault?.();
    return true;
  }

  return { onKeydown };
}

export { createKeyboardNavigation };
