(function (global) {
  // Pure list operations on native X posts: ordering, merging captures, and reconciling a
  // timeline's first page. Posts are immutable; every change makes a new object.
  const MAX_POSTS = 200;

  function compareSortIndex(left, right) {
    const a = String(left.sortIndex || '');
    const b = String(right.sortIndex || '');
    if (a.length !== b.length) return b.length - a.length;
    return b < a ? -1 : b > a ? 1 : 0;
  }

  // Newly captured posts replace older copies so counts and viewer state stay fresh.
  function mergePosts(existing, incoming, limit = MAX_POSTS) {
    const byId = new Map(existing.map(post => [post.id, post]));
    incoming.forEach(post => {
      if (!post?.id) return;
      const previous = byId.get(post.id);
      // Keep the original position for posts already shown; re-ranking would make them jump.
      if (!previous) {
        byId.set(post.id, post);
        return;
      }
      const next = { ...post, sortIndex: previous.sortIndex, local: previous.local && !post.sortIndex };
      // Unchanged posts keep their object, so their rendered HTML is reused.
      byId.set(post.id, JSON.stringify(next) === JSON.stringify(previous) ? previous : next);
    });
    return [...byId.values()].sort(compareSortIndex).slice(0, limit);
  }

  function sortValue(post) {
    try {
      return BigInt(post?.sortIndex || 0);
    } catch {
      return 0n;
    }
  }

  // A timeline's first page is the truth for the range it covers: posts shown in that range
  // but missing from it were deleted (or hidden) and go away. Older posts loaded with
  // "load more" stay. A ranked feed (for you) is replaced, since its order changes anyway.
  // Posts this account just sent stay: X can leave them out of its own refreshes.
  function reconcileFirstPage(existing, firstPage, timeline) {
    if (!firstPage.length) return existing;
    const ids = new Set(firstPage.map(post => post.id));
    if (timeline === 'for-you') return existing.filter(post => ids.has(post.id) || post.local);
    const oldest = firstPage.reduce((min, post) => {
      const value = sortValue(post);
      return value < min ? value : min;
    }, sortValue(firstPage[0]));
    return existing.filter(post => ids.has(post.id) || post.local || sortValue(post) < oldest);
  }

  // A new post has no timeline sortIndex: place it just above the newest shown post.
  function placeOnTop(posts, existing) {
    const top = existing.reduce((max, post) => {
      try {
        const value = BigInt(post.sortIndex || 0);
        return value > max ? value : max;
      } catch {
        return max;
      }
    }, 0n);
    return posts.map((post, index) => ({ ...post, local: true, sortIndex: String(top + BigInt(posts.length - index)) }));
  }

  // The shape SocialDeck's mute rules read (shared with Bluesky).
  function toMuteShape(post) {
    const quoted = post.quoted;
    const text = segments => (segments || []).map(segment => segment.text || '').join('');
    return {
      post: {
        record: { text: text(post.segments) },
        author: { handle: post.author?.handle, displayName: post.author?.name },
        embed: quoted ? {
          record: {
            value: { text: text(quoted.segments) },
            author: { handle: quoted.author?.handle, displayName: quoted.author?.name },
          },
        } : null,
      },
      reason: post.repostedBy
        ? { by: { handle: post.repostedBy.handle, displayName: post.repostedBy.name } }
        : null,
    };
  }

  global.SocialDeckXNativePosts = {
    MAX_POSTS,
    compareSortIndex,
    mergePosts,
    placeOnTop,
    reconcileFirstPage,
    sortValue,
    toMuteShape,
  };
})(window);
