function createAppShellRuntime({ documentRef, windowRef, api, actions, cancelAppearance, closeOverlay, closeQuote, keyboardNavigation }) {
  let attached = false;
  let toastTimer;
  const subscriptions = [];

  function closeMenus() {
    documentRef.querySelectorAll('.am-item.open').forEach(element => element.classList.remove('open'));
  }

  function onClick(event) {
    closeMenus();
    if (!event.target?.closest?.('.sb')) documentRef.getElementById('amenu')?.classList.remove('open');
  }

  function toggleMenu(id, event) {
    event.stopPropagation();
    const item = documentRef.getElementById(id)?.closest('.am-item');
    const wasOpen = item?.classList.contains('open');
    closeMenus();
    if (!wasOpen) item?.classList.add('open');
  }

  function toast(message) {
    const element = documentRef.getElementById('toast');
    element.textContent = message;
    element.classList.add('sh');
    windowRef.clearTimeout(toastTimer);
    toastTimer = windowRef.setTimeout(() => element.classList.remove('sh'), 2800);
  }

  function run(action, input = {}) {
    const result = actions[action]?.(input);
    result?.catch?.(error => windowRef.console?.error?.('App shell action failed:', error));
  }

  function onKeydown(event) {
    if (keyboardNavigation?.onKeydown(event)) return;
    const visible = id => documentRef.getElementById(id)?.classList.contains('on');
    if (visible('lightbox')) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        run('move-lightbox', { dataset: { direction: event.key === 'ArrowLeft' ? '-1' : '1' } });
        return;
      }
      if (event.key === 'Escape') { run('close-lightbox'); return; }
    }

    if (event.key === 'Enter' && !documentRef.getElementById('login-screen').classList.contains('hidden')) {
      const buttonId = documentRef.querySelector('.ltab.xt.active') ? 'x-login-btn' : 'b-login-btn';
      documentRef.getElementById(buttonId)?.click();
    }
    if (event.key === 'Escape') {
      if (visible('appearanceMod')) cancelAppearance();
      documentRef.querySelectorAll('.ov.on').forEach(overlay => {
        if (overlay.id === 'xPostMod' || overlay.id === 'compMod') closeOverlay(overlay.id);
        else overlay.classList.remove('on');
      });
      closeQuote();
    }
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key === 'n') { event.preventDefault(); run('open-add-column'); }
    if (event.key === 'r') { event.preventDefault(); run('refresh-all'); }
    if (event.key === 'Enter') {
      event.preventDefault();
      const buttonId = documentRef.getElementById('quote-modal-ov') ? 'quote-sndb'
        : visible('xPostMod') ? 'x-sndb' : visible('compMod') ? 'sndb' : null;
      const button = buttonId && documentRef.getElementById(buttonId);
      if (button && !button.disabled) button.click();
    }
  }

  function onResize() {
    const button = documentRef.getElementById('win-max-btn');
    if (!button) return;
    const maximized = windowRef.outerWidth >= windowRef.screen.availWidth && windowRef.outerHeight >= windowRef.screen.availHeight;
    button.innerHTML = maximized
      ? '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M2 0h8v8M0 2h8v8" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
      : '<svg viewBox="0 0 10 10" width="10" height="10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
  }

  function attach() {
    if (attached) return;
    attached = true;
    documentRef.addEventListener('click', onClick);
    documentRef.addEventListener('keydown', onKeydown);
    if (!api) return;
    windowRef.addEventListener('resize', onResize);
    for (const [channel, action] of Object.entries({
      'add-column': 'open-add-column', 'refresh-all': 'refresh-all', 'show-about': 'open-about',
      'scroll-left': 'scroll-columns-left', 'scroll-right': 'scroll-columns-right',
    })) subscriptions.push(api.on(channel, () => run(action)));
    subscriptions.push(api.onUpdateStatus?.(status => run('update-status', { status })));
  }

  function dispose() {
    attached = false;
    documentRef.removeEventListener('click', onClick);
    documentRef.removeEventListener('keydown', onKeydown);
    windowRef.removeEventListener('resize', onResize);
    windowRef.clearTimeout(toastTimer);
    subscriptions.splice(0).forEach(unsubscribe => unsubscribe?.());
  }

  return { attach, dispose, toggleMenu, toast };
}

export { createAppShellRuntime };
