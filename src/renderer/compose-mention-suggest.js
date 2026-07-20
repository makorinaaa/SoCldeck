(function (global) {
  function createComposeMentionSuggest({
    documentRef = global.document,
    windowRef = global,
    textareaId = 'cta',
    boxId = 'mention-suggest',
    searchActors,
    isAvailable = () => true,
    delayMs = 200,
    ui = {},
  } = {}) {
    if (typeof searchActors !== 'function') {
      throw new Error('Mention Suggest requires an actor search boundary');
    }
    const escape = ui.escape || (value => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;'));
    const avatarBackground = ui.avatarBackground || (() => 'var(--bg3)');
    let timer = null;
    let lastQuery = '';

    function hideBox() {
      const box = documentRef.getElementById(boxId);
      if (box) box.style.display = 'none';
    }

    function renderActors(textarea, actors) {
      let suggest = documentRef.getElementById(boxId);
      if (!suggest) {
        suggest = documentRef.createElement('div');
        suggest.id = boxId;
        suggest.className = 'mention-suggest-box';
        documentRef.body.appendChild(suggest);
      }

      const rect = textarea.getBoundingClientRect();
      suggest.style.left = Math.min(rect.left + 8, windowRef.innerWidth - 310) + 'px';
      suggest.style.top = (rect.bottom + 4) + 'px';

      suggest.innerHTML = actors.map(actor => {
        const avatar = actor.avatar
          ? `<img src="${escape(actor.avatar)}">`
          : (actor.handle || '?').slice(0, 2).toUpperCase();
        const background = avatarBackground(actor.handle);
        return `<div data-action="insert-mention" data-handle="${escape(actor.handle)}" class="mention-item hover-row">
          <div class="mention-av" style="background:${background}">${avatar}</div>
          <div style="min-width:0">
            <div class="mention-name">${escape(actor.displayName || actor.handle)}</div>
            <div class="mention-handle">@${escape(actor.handle)}</div>
          </div>
        </div>`;
      }).join('');

      suggest.style.display = 'block';
    }

    async function onInput(event) {
      const textarea = event.target;
      const value = textarea.value;
      const position = textarea.selectionStart;

      // カーソル前の @word を検出
      const match = value.slice(0, position).match(/@([a-zA-Z0-9._-]*)$/);
      if (!match || match[1].length < 1) {
        hideBox();
        return;
      }
      const query = match[1];
      if (query === lastQuery) return;
      lastQuery = query;

      global.clearTimeout(timer);
      timer = global.setTimeout(async () => {
        if (!isAvailable() || query.length < 1) return;
        try {
          const actors = await searchActors(query);
          if (!actors.length) { hideBox(); return; }
          renderActors(textarea, actors);
        } catch {}
      }, delayMs);
    }

    function insert(handle) {
      const textarea = documentRef.getElementById(textareaId);
      if (!textarea) return;
      const position = textarea.selectionStart;
      const before = textarea.value.slice(0, position);
      const after = textarea.value.slice(position);
      const replaced = before.replace(/@([a-zA-Z0-9._-]*)$/, `@${handle} `);
      textarea.value = replaced + after;
      textarea.selectionStart = textarea.selectionEnd = replaced.length;
      textarea.focus();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      hideBox();
      lastQuery = '';
    }

    function onDocumentClick(event) {
      const suggest = documentRef.getElementById(boxId);
      if (suggest
        && !event.target.closest(`#${boxId}`)
        && !event.target.closest(`#${textareaId}`)) {
        suggest.style.display = 'none';
      }
    }
    documentRef.addEventListener('click', onDocumentClick);

    return {
      insert,
      onInput,
      dispose() {
        documentRef.removeEventListener('click', onDocumentClick);
        global.clearTimeout(timer);
      },
    };
  }

  global.SocialDeckComposeMentionSuggest = { createComposeMentionSuggest };
})(window);
