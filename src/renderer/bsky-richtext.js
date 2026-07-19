(function (global) {
  const textEncoder = new TextEncoder();

  function createBskyRichText() {
    function byteLength(text) {
      return textEncoder.encode(text).length;
    }

    function buildFacets(text) {
      const facets = [];
      let match;

      const urlRe = /https?:\/\/[^\s<>"']+/g;
      while ((match = urlRe.exec(text)) !== null) {
        const uri = match[0].replace(/[.,!?;:)]+$/, '');
        const start = byteLength(text.slice(0, match.index));
        const end = start + byteLength(uri);
        facets.push({
          index: { byteStart: start, byteEnd: end },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
        });
      }

      const mentionRe = /@([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)/g;
      while ((match = mentionRe.exec(text)) !== null) {
        const start = byteLength(text.slice(0, match.index));
        const end = start + byteLength(match[0]);
        facets.push({
          index: { byteStart: start, byteEnd: end },
          features: [{ $type: 'app.bsky.richtext.facet#mention', did: '' }],
          _handle: match[1],
        });
      }

      const tagRe = /(^|\s)#([^\s#]+)/g;
      while ((match = tagRe.exec(text)) !== null) {
        const hashOffset = match[1].length;
        const rawTag = match[2].replace(/[.,!?;:)]+$/, '');
        if (!rawTag) continue;
        const startIndex = match.index + hashOffset;
        const start = byteLength(text.slice(0, startIndex));
        const end = start + byteLength(`#${rawTag}`);
        facets.push({
          index: { byteStart: start, byteEnd: end },
          features: [{ $type: 'app.bsky.richtext.facet#tag', tag: rawTag }],
        });
      }

      return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
    }

    async function resolveMentionDids(facets, resolveHandle) {
      const resolved = await Promise.all(facets.map(async facet => {
        if (!facet._handle) return facet;

        try {
          const did = await resolveHandle(facet._handle);
          if (!did) return null;
          const { _handle, ...clean } = facet;
          clean.features[0].did = did;
          return clean;
        } catch {
          return null;
        }
      }));

      return resolved.filter(Boolean);
    }

    return {
      buildFacets,
      resolveMentionDids,
    };
  }

  global.SocialDeckBskyRichText = {
    createBskyRichText,
  };
})(window);
