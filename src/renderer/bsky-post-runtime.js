(function (global) {
  function setCount(element, selector, value) {
    const count = element.querySelector(selector);
    if (count) count.textContent = String(value || 0);
  }

  function updatePostElement(element, post) {
    setCount(element, '.pa.rep span', post.replyCount);
    setCount(element, '.pa.rt span', post.repostCount);
    setCount(element, '.pa.lk span', post.likeCount);

    const likeButton = element.querySelector('.pa.lk');
    const liked = Boolean(post.viewer?.like);
    likeButton?.classList.toggle('liked', liked);
    likeButton?.querySelector('svg')?.setAttribute('fill', liked ? 'currentColor' : 'none');

    const repostButton = element.querySelector('.pa.rt');
    repostButton?.classList.toggle('rted', Boolean(post.viewer?.repost));
    element.dataset.likeuri = post.viewer?.like || '';
    element.dataset.reposturi = post.viewer?.repost || '';
  }

  function syncPostMetrics(feedElement, items) {
    const existing = new Map(
      Array.from(feedElement.querySelectorAll('.post[data-uri]'))
        .map(element => [element.dataset.uri, element]),
    );
    let updatedCount = 0;

    items.forEach(item => {
      const post = item.post || item;
      const element = existing.get(post.uri);
      if (!element) return;
      updatePostElement(element, post);
      updatedCount += 1;
    });
    return updatedCount;
  }

  global.SocialDeckBskyPostRuntime = {
    syncPostMetrics,
    updatePostElement,
  };
})(window);
