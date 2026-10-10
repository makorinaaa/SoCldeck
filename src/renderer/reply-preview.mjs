// 返信先の投稿を、投稿画面のカードに出す分だけ読み取る。
// Bluesky とネイティブ版 X の投稿は同じクラス名で描いているので、表示中の要素から読む。
// 下書きと一緒に保存するので、本文と画像の数は抑える。
const MAX_TEXT_LENGTH = 500;
const MAX_IMAGES = 4;

function text(node) {
  return String(node?.textContent || '').trim();
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function truncate(value) {
  const characters = [...value];
  return characters.length > MAX_TEXT_LENGTH
    ? `${characters.slice(0, MAX_TEXT_LENGTH - 1).join('')}…`
    : value;
}

function readReplyPreview(postElement) {
  if (!postElement) return null;
  return {
    name: text(postElement.querySelector('.p-name')),
    handle: text(postElement.querySelector('.p-handle')).replace(/^@/, ''),
    text: truncate(text(postElement.querySelector('.p-body'))),
    images: [...postElement.querySelectorAll('.p-imgs img')]
      .map(image => httpsUrl(image.src))
      .filter(Boolean)
      .slice(0, MAX_IMAGES),
    hasVideo: Boolean(postElement.querySelector('.p-video')),
  };
}

export { readReplyPreview };
