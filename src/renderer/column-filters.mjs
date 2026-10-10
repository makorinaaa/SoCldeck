// カラムごとの表示フィルター。全体ミュートとは別に、カラムごとに
// 「画像・動画だけ」「リポストを非表示」「語句を含む投稿だけ」を設定する。
// Bluesky とネイティブ版 X の投稿を同じ形（本文・リポストか・画像や動画があるか）にしてから判定する。
const STORAGE_KEY = 'socialdeck_column_filters';
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 100;

function normalizeColumnFilter(value) {
  const keywords = [];
  for (const keyword of Array.isArray(value?.keywords) ? value.keywords : []) {
    if (typeof keyword !== 'string') continue;
    const clean = keyword.trim();
    if (!clean || clean.length > MAX_KEYWORD_LENGTH || keywords.includes(clean)) continue;
    keywords.push(clean);
    if (keywords.length >= MAX_KEYWORDS) break;
  }
  return { mediaOnly: Boolean(value?.mediaOnly), hideReposts: Boolean(value?.hideReposts), keywords };
}

function isActiveFilter(filter) {
  return Boolean(filter && (filter.mediaOnly || filter.hideReposts || filter.keywords?.length));
}

function describeColumnFilter(filter) {
  if (!isActiveFilter(filter)) return '';
  return [
    filter.mediaOnly && '画像・動画のみ',
    filter.hideReposts && 'リポスト非表示',
    filter.keywords.length && filter.keywords.map(keyword => `「${keyword}」`).join(''),
  ].filter(Boolean).join(' · ');
}

// 全角・半角や大文字・小文字の違いで取りこぼさないようにする
function foldText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function blueskyPostFacts(item) {
  const post = item?.post || item || {};
  const embed = post.embed || {};
  const quoted = embed.record?.value ? embed.record : embed.record?.record;
  return {
    text: [post.record?.text, quoted?.value?.text].filter(Boolean).join('\n'),
    isRepost: Boolean(item?.reason?.by) || item?.reason?.$type === 'app.bsky.feed.defs#reasonRepost',
    hasMedia: Boolean(embed.images?.length || embed.playlist || embed.media?.images?.length || embed.media?.playlist),
  };
}

function xPostFacts(post) {
  const text = segments => (segments || []).map(segment => segment.text || '').join('');
  return {
    text: [text(post?.segments), text(post?.quoted?.segments)].filter(Boolean).join('\n'),
    isRepost: Boolean(post?.repostedBy),
    hasMedia: Boolean(post?.media?.length),
  };
}

function matchesColumnFilter(filter, facts) {
  if (!isActiveFilter(normalizeColumnFilter(filter))) return true;
  const { mediaOnly, hideReposts, keywords } = normalizeColumnFilter(filter);
  if (mediaOnly && !facts.hasMedia) return false;
  if (hideReposts && facts.isRepost) return false;
  if (keywords.length) {
    const text = foldText(facts.text);
    if (!keywords.some(keyword => text.includes(foldText(keyword)))) return false;
  }
  return true;
}

function createColumnFilterStore({ storage }) {
  let filters = {};
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      Object.entries(saved).forEach(([id, filter]) => {
        const normalized = normalizeColumnFilter(filter);
        if (isActiveFilter(normalized)) filters[id] = normalized;
      });
    }
  } catch { /* 壊れた保存データは無視して、フィルターなしで表示する */ }

  function save() {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch { /* 保存できなくても表示は続ける */ }
  }

  return {
    get: id => (filters[id] ? { ...filters[id], keywords: [...filters[id].keywords] } : null),
    set(id, filter) {
      const normalized = normalizeColumnFilter(filter);
      if (isActiveFilter(normalized)) filters[id] = normalized;
      else delete filters[id];
      save();
    },
    remove(id) {
      if (!(id in filters)) return;
      delete filters[id];
      save();
    },
    // 削除済みのカラムの設定を残さない
    prune(ids) {
      const keep = new Set(ids);
      const next = Object.fromEntries(Object.entries(filters).filter(([id]) => keep.has(id)));
      if (Object.keys(next).length === Object.keys(filters).length) return;
      filters = next;
      save();
    },
  };
}

export {
  blueskyPostFacts,
  createColumnFilterStore,
  describeColumnFilter,
  isActiveFilter,
  matchesColumnFilter,
  normalizeColumnFilter,
  xPostFacts,
};
