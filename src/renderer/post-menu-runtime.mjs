function createPostMenuRuntime({ documentRef, esc, muteRules, toast, refilterBskyCols, clipboard = globalThis.navigator?.clipboard, schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout }) {
  let menu = null;
  let closeTimer = null;
  function close() {
    if (closeTimer !== null) cancel(closeTimer);
    closeTimer = null;
    documentRef.removeEventListener('click', close);
    menu?.remove();
    menu = null;
  }
  function showPostMenu({ handle, x, y }) {
    close();
    menu = documentRef.createElement('div');
    menu.id = 'post-ctx-menu';
    menu.className = 'ctx-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.innerHTML = `
      <div data-action="add-ng-user" data-handle="${esc(handle)}" class="ctx-item hover-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        @${esc(handle)} をミュート
      </div>
      <div data-action="copy-handle" data-handle="${esc(handle)}" class="ctx-item hover-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        ハンドルをコピー
      </div>
    `;
    documentRef.body.appendChild(menu);
    closeTimer = schedule(() => {
      closeTimer = null;
      documentRef.addEventListener('click', close);
    }, 50);
  }
  function addNgUser(handle) {
    const { value: clean } = muteRules.add('user', handle);
    if (!clean) return;
    toast(`@${clean} をミュートしました`);
    close();
    refilterBskyCols(); // 即時反映
  }
  async function copyHandle(handle) {
    close();
    try {
      if (!clipboard?.writeText) throw new Error('Clipboard is unavailable');
      await clipboard.writeText('@' + handle);
      toast('コピーしました');
    } catch {
      toast('コピーできませんでした');
    }
  }
  return { showPostMenu, addNgUser, copyHandle, dispose: close };
}

export { createPostMenuRuntime };
