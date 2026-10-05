(function (global) {
  const { escapeHtml } = global.SocialDeckHtmlEscape;

  const TIMELINE_LABELS = { 'for-you': 'おすすめ', following: 'フォロー中' };

  // Draws a native X Column from a reader's state. It owns only DOM work: rendered HTML is
  // cached per post and the Column is patched in place.
  function createXNativeColumnView({
    documentRef = global.document,
    renderPost,
    relTime = () => '',
    getPendingReaction = () => null,
    createElementFromHtml = html => {
      const template = documentRef.createElement('template');
      template.innerHTML = html.trim();
      return template.content.firstElementChild;
    },
  } = {}) {
    if (typeof renderPost !== 'function') throw new Error('X native column view requires a post renderer');

    // Posts are immutable objects (an update makes a new one), so a post's HTML is kept until
    // the post, its account view, or a pending reaction on it changes.
    const postHtmlCache = new WeakMap();
    function postHtml(post, options) {
      const like = getPendingReaction('like', post.id, options.partition);
      const repost = getPendingReaction('repost', post.id, options.partition);
      const key = [options.partition, options.own ? 1 : 0, options.deleting ? 1 : 0,
        like ? like.active : '-', repost ? repost.active : '-'].join('|');
      let variants = postHtmlCache.get(post);
      if (!variants) {
        variants = new Map();
        postHtmlCache.set(post, variants);
      }
      let html = variants.get(key);
      if (html === undefined) {
        if (variants.size >= 4) variants.clear();
        html = renderPost(post, options);
        variants.set(key, html);
      }
      return html;
    }

    function keyOf(element) {
      if (element.dataset?.xId) return `post:${element.dataset.xId}`;
      if (element.hasAttribute?.('data-x-native-more')) return 'more';
      if (element.hasAttribute?.('data-x-native-tabs')) return 'tabs';
      if (element.hasAttribute?.('data-x-native-login')) return 'login';
      if (element.classList?.contains('x-native-notice')) return 'notice';
      return null;
    }

    // Updates a column in place: unchanged posts keep their DOM nodes (a playing video keeps
    // playing, images are not decoded again) and only new or changed posts are built.
    // Chromium's scroll anchoring keeps the reading position when posts are added above.
    function patchColumn(column, entries) {
      const { host } = column;
      if (typeof host.insertBefore !== 'function') {
        host.innerHTML = entries.map(entry => entry.html).join('');
        return;
      }
      const existing = new Map();
      Array.from(host.children || []).forEach(element => {
        const key = keyOf(element);
        if (key && !existing.has(key) && column.rendered.has(element)) existing.set(key, element);
        else element.remove();
      });
      let cursor = host.firstElementChild;
      for (const entry of entries) {
        let element = existing.get(entry.key);
        existing.delete(entry.key);
        if (element && column.rendered.get(element) !== entry.html) {
          const fresh = createElementFromHtml(entry.html);
          if (cursor === element) cursor = fresh;
          element.replaceWith(fresh);
          element = fresh;
        }
        if (!element) element = createElementFromHtml(entry.html);
        column.rendered.set(element, entry.html);
        if (element === cursor) cursor = cursor.nextElementSibling;
        else host.insertBefore(element, cursor);
      }
      existing.forEach(element => element.remove());
    }

    function tabsHtml(reader) {
      const current = reader.switching || reader.timeline;
      const button = (timeline, label) => `<button type="button" data-x-timeline="${timeline}" class="${current === timeline ? 'on' : ''}"${reader.switching ? ' disabled' : ''} aria-pressed="${current === timeline}">${label}</button>`;
      return `<div class="x-native-tabs" data-x-native-tabs role="group" aria-label="タイムライン">${button('for-you', 'おすすめ')}${button('following', 'フォロー中')}</div>`;
    }

    function loginHtml(reader) {
      return `<div class="x-native-login" data-x-native-login>
        <div>${escapeHtml(reader.message || 'このアカウントで X にログインしてください')}</div>
        <button type="button" data-x-native-open-login>X にログイン</button>
      </div>`;
    }

    function refreshTimes(host) {
      host?.querySelectorAll?.('.p-time[data-created-at]').forEach(element => {
        const label = relTime(element.dataset.createdAt);
        if (element.textContent !== label) element.textContent = label;
      });
    }

    // `visible` are the reader's posts this Column shows; `optionsFor` gives each post's
    // per-account rendering options (own post, deletion in progress).
    function render(column, { reader, visible, optionsFor }) {
      const { host } = column;
      if (column.login) return;
      if (column.subtitle) {
        const label = TIMELINE_LABELS[reader.timeline];
        column.subtitle.textContent = label ? `${column.baseSubtitle} · ${label}` : column.baseSubtitle;
      }
      if (reader.status === 'login' && !visible.length) {
        const html = loginHtml(reader);
        if (column.signature !== html) host.innerHTML = html;
        column.signature = html;
        return;
      }
      if (!visible.length) {
        const tabs = reader.timeline || reader.switching ? tabsHtml(reader) : '';
        const html = tabs + (reader.status === 'loading' || reader.switching
          ? '<div class="feed-loading"><div class="spinner"></div>X のタイムラインを読み込み中…</div>'
          : reader.status === 'ready'
            ? '<div class="feed-empty">表示できるポストがありません</div>'
            : `<div class="feed-empty">${escapeHtml(reader.message || '読み込めませんでした')}</div>`);
        if (column.signature !== html) host.innerHTML = html;
        column.signature = html;
        return;
      }
      const entries = [{ key: 'tabs', html: tabsHtml(reader) }];
      if (reader.status === 'login') entries.push({ key: 'login', html: loginHtml(reader) });
      else if (reader.status === 'error') {
        entries.push({ key: 'notice', html: `<div class="x-native-notice">${escapeHtml(reader.message)}</div>` });
      }
      visible.forEach(post => entries.push({ key: `post:${post.id}`, html: postHtml(post, optionsFor(post)) }));
      entries.push({
        key: 'more',
        html: `<button type="button" class="x-native-more" data-x-native-more${reader.loadingMore ? ' disabled' : ''}>${reader.loadingMore ? '読み込み中…' : 'さらに読み込む'}</button>`,
      });
      // Most captures (a refresh with no new posts) change nothing: skip the DOM entirely.
      const signature = entries.map(entry => entry.html).join('');
      if (column.signature === signature) return;
      column.signature = signature;
      patchColumn(column, entries);
      // Cached HTML may carry an older relative time: refresh the visible labels.
      refreshTimes(column.host);
    }

    return { refreshTimes, render };
  }

  // The parts of a subtitle that name the tab are added by render(); a restored subtitle
  // may already end with one.
  function baseSubtitleOf(text) {
    return String(text || '').replace(/(?:\s*·\s*(?:おすすめ|フォロー中))+\s*$/, '');
  }

  global.SocialDeckXNativeColumnView = { baseSubtitleOf, createXNativeColumnView };
})(window);
