(function (global) {
  function createComposeQuote({
    documentRef = global.document,
    getAccount = () => null,
    buildFacets = () => [],
    resolveMentionDids = async facets => facets,
    createPostRecord,
    characterLimit = 300,
    avatarFallbackBackground = '',
    ui = {},
    intents = {},
  } = {}) {
    if (typeof createPostRecord !== 'function') {
      throw new Error('Compose Quote requires a post record boundary');
    }
    const escape = ui.escape || (value => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;'));
    const toast = intents.toast || (() => {});
    let target = null;

    function close() {
      documentRef.getElementById('quote-modal-ov')?.remove();
      target = null;
    }

    function open(uri, cid, handle) {
      target = { uri, cid, handle };
      documentRef.getElementById('quote-modal-ov')?.remove();

      const overlay = documentRef.createElement('div');
      overlay.className = 'ov on';
      overlay.id = 'quote-modal-ov';
      overlay.onclick = event => { if (event.target === overlay) close(); };

      const account = getAccount() || {};
      const avatarBackground = account.bg || avatarFallbackBackground;
      const avatarInner = account.avatar
        ? `<img src="${escape(account.avatar)}">`
        : (account.initials || '?');

      overlay.innerHTML = `
        <div class="cmodal">
          <div class="chead">
            <h2 class="quote-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
              引用リポスト
            </h2>
            <button data-action="close-quote" class="quote-close">✕</button>
          </div>
          <div class="quote-src">
            <div class="quote-src-handle">@${escape(handle)} の投稿を引用</div>
            <div class="quote-src-uri">${escape(String(uri || '').split('/').pop())}</div>
          </div>
          <div class="comp-wrap">
            <div class="comp-av" style="background:${avatarBackground}">${avatarInner}</div>
            <textarea class="comp-ta" id="quote-ta" placeholder="コメントを追加…" maxlength="${characterLimit}" data-input-action="update-quote-count"></textarea>
          </div>
          <div class="comp-foot">
            <span class="cc" id="quote-cct">0 / ${characterLimit}</span>
            <button class="send-btn" id="quote-sndb" data-action="submit-quote">引用して投稿</button>
          </div>
        </div>`;
      documentRef.body.appendChild(overlay);
      global.setTimeout(() => documentRef.getElementById('quote-ta')?.focus(), 50);
    }

    function updateCharacterCount() {
      const length = documentRef.getElementById('quote-ta')?.value.length || 0;
      const counter = documentRef.getElementById('quote-cct');
      if (counter) {
        counter.textContent = `${length} / ${characterLimit}`;
        counter.className = 'cc'
          + (length > characterLimit - 40 ? ' w' : '')
          + (length > characterLimit ? ' over' : '');
      }
      const button = documentRef.getElementById('quote-sndb');
      if (button) button.disabled = length > characterLimit;
    }

    async function submit() {
      if (!getAccount() || !target) return;
      const text = documentRef.getElementById('quote-ta')?.value.trim() || '';
      const button = documentRef.getElementById('quote-sndb');
      if (button) { button.disabled = true; button.textContent = '投稿中…'; }
      try {
        const rawFacets = buildFacets(text);
        const resolvedFacets = text ? await resolveMentionDids(rawFacets) : [];
        const record = {
          $type: 'app.bsky.feed.post',
          text,
          createdAt: new Date().toISOString(),
          embed: {
            $type: 'app.bsky.embed.record',
            record: { uri: target.uri, cid: target.cid },
          },
        };
        if (resolvedFacets.length) record.facets = resolvedFacets;
        await createPostRecord(record);
        close();
        toast('Quote posted');
        global.setTimeout(() => intents.refreshTimelines?.(), 1000);
      } catch (error) {
        toast(`エラー: ${error.message}`);
        if (button) { button.disabled = false; button.textContent = '引用して投稿'; }
      }
    }

    return { close, open, submit, updateCharacterCount };
  }

  global.SocialDeckComposeQuote = { createComposeQuote };
})(window);
