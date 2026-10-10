// 投稿できる長さは SNS ごとに数え方が違う。
// X: 重み付き文字数 280（https://docs.x.com/fundamentals/counting-characters）。
//    下の範囲の文字は 1、それ以外（日本語など）と絵文字は 2、URL は長さに関係なく 23。
// Bluesky: 書記素（見た目の 1 文字）で 300、かつ UTF-8 で 3000 バイト
//    （app.bsky.feed.post の lexicon の maxGraphemes / maxLength）。
const X_LIMIT = 280;
const X_URL_LENGTH = 23;
const X_LIGHT_RANGES = [[0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037]];
const BLUESKY_LIMIT = 300;
const BLUESKY_MAX_BYTES = 3000;

// X が URL とみなすものの近似。プロトコル付きの URL と、よく使われる TLD の裸のドメイン。
// URL の本体は ASCII に限り、末尾の句読点は含めない（X と同じ扱い）。
const URL_BODY = "[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%|]";
const BARE_DOMAIN_TLDS = 'com|net|org|jp|io|co|me|dev|app|ly|tv|info|xyz|ai|gg|fm|to|be|so|us|uk|tokyo|link|blog|news|page|site|online|tech';
const URL_PATTERN = new RegExp(
  `https?://${URL_BODY}+`
  + `|(?<![A-Za-z0-9@$#.\\-/])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+(?:${BARE_DOMAIN_TLDS})(?![A-Za-z0-9-])(?:/${URL_BODY}*)?`,
  'giu',
);
const URL_TRAILING_PUNCTUATION = /[.,!?:;'")\]]+$/u;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text) {
  return Array.from(segmenter.segment(text), segment => segment.segment);
}

function isXEmoji(grapheme) {
  // © ® は単独では普通の文字として数えられる
  return EMOJI.test(grapheme) && !/^[©®]$/u.test(grapheme);
}

function xCodePointWeight(codePoint) {
  return X_LIGHT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end) ? 1 : 2;
}

function countXPlainText(text) {
  return graphemes(text).reduce((total, grapheme) => total + (isXEmoji(grapheme)
    ? 2
    : Array.from(grapheme).reduce((sum, character) => sum + xCodePointWeight(character.codePointAt(0)), 0)), 0);
}

function countXPostLength(text) {
  const normalized = String(text || '').normalize('NFC');
  let total = 0;
  let last = 0;
  for (const match of normalized.matchAll(URL_PATTERN)) {
    const url = match[0].replace(URL_TRAILING_PUNCTUATION, '');
    if (!url) continue;
    total += countXPlainText(normalized.slice(last, match.index)) + X_URL_LENGTH;
    last = match.index + url.length;
  }
  return total + countXPlainText(normalized.slice(last));
}

function countBlueskyPostLength(text) {
  return graphemes(String(text || '')).length;
}

function measureNetwork(text, networkId) {
  if (networkId === 'x') {
    const count = countXPostLength(text);
    return { count, limit: X_LIMIT, valid: count <= X_LIMIT };
  }
  const count = countBlueskyPostLength(text);
  const bytes = new TextEncoder().encode(text).length;
  return { count, limit: BLUESKY_LIMIT, valid: count <= BLUESKY_LIMIT && bytes <= BLUESKY_MAX_BYTES };
}

// 送る本文（前後の空白を除いたもの）を、投稿先すべての数え方で測る。
// 表示には上限に一番近い投稿先の数を使う。
function measurePost(text, networkIds) {
  const sent = String(text || '').trim();
  const measures = networkIds.map(networkId => measureNetwork(sent, networkId));
  const tightest = measures.reduce((current, next) => (
    next.count / next.limit > current.count / current.limit ? next : current
  ));
  return {
    count: tightest.count,
    limit: tightest.limit,
    valid: measures.every(measure => measure.valid),
  };
}

export { countBlueskyPostLength, countXPostLength, measurePost };
