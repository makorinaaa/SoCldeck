(function (global) {
  function createUiUtils({ avatarBackgrounds = [], bskyIcon = '' } = {}) {
    function esc(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function relTime(dateValue) {
      const seconds = (Date.now() - new Date(dateValue)) / 1000;
      if (seconds < 60) return `${Math.floor(seconds)}s`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
      return `${Math.floor(seconds / 86400)}d`;
    }

    function avBgFor(handle) {
      if (!avatarBackgrounds.length) return 'linear-gradient(135deg,#4e9af0,#6a5cf0)';
      return avatarBackgrounds[Math.abs((handle || '').charCodeAt(0) || 0) % avatarBackgrounds.length];
    }

    function renderAvatar(author, size = 34, { delegated = false } = {}) {
      const bg = avBgFor(author.handle);
      const init = esc((author.displayName || author.handle || '?').slice(0, 2).toUpperCase());
      const img = author.avatar
        ? `<img src="${esc(author.avatar)}" loading="lazy">`
        : '';
      const did = esc(author.did || '');
      const handle = esc(author.handle || '');
      return `<div class="av" style="width:${size}px;height:${size}px;background:${bg};font-size:${size < 32 ? 9 : 11}px;cursor:pointer"
        data-bsky-profile data-did="${did}" data-handle="${handle}"
      >${init}${img}<div class="pdot">${bskyIcon.replace('viewBox', 'width="7" height="7" viewBox')}</div></div>`;
    }

    function formatText(text, facets, { delegated = false } = {}) {
      if (!facets || !facets.length) return esc(text).replace(/\n/g, '<br>');
      const enc = new TextEncoder();
      const bytes = enc.encode(text);
      const dec = new TextDecoder();
      const sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);
      let result = '';
      let pos = 0;

      for (const facet of sorted) {
        if (facet.index.byteStart > pos) {
          result += esc(dec.decode(bytes.slice(pos, facet.index.byteStart))).replace(/\n/g, '<br>');
        }

        const seg = dec.decode(bytes.slice(facet.index.byteStart, facet.index.byteEnd));
        const feat = facet.features?.[0];
        if (feat?.$type === 'app.bsky.richtext.facet#link') {
          result += `<a href="${esc(feat.uri)}" target="_blank">${esc(seg)}</a>`;
        } else if (feat?.$type === 'app.bsky.richtext.facet#mention') {
          result += `<a href="#" data-bsky-profile data-did="${esc(feat.did)}">${esc(seg)}</a>`;
        } else if (feat?.$type === 'app.bsky.richtext.facet#tag') {
          result += `<a href="#" style="color:var(--accent)" data-bsky-tag>${esc(seg)}</a>`;
        } else {
          result += esc(seg);
        }
        pos = facet.index.byteEnd;
      }

      if (pos < bytes.length) result += esc(dec.decode(bytes.slice(pos))).replace(/\n/g, '<br>');
      return result;
    }

    return { esc, relTime, avBgFor, renderAvatar, formatText };
  }

  global.SocialDeckUiUtils = {
    createUiUtils,
  };
})(window);
