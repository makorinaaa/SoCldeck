const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10000;
const ALLOWED_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);

const TODAY_SCHEDULE_QUERY = `
  query TodaySchedule($page: Int, $start: Int, $end: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(
        airingAt_greater: $start
        airingAt_lesser: $end
        sort: TIME
      ) {
        airingAt
        episode
        media {
          id
          title { native romaji english }
          coverImage { medium large }
          siteUrl
          countryOfOrigin
          format
          isAdult
        }
      }
    }
  }
`;

function getJstDayRange(now = new Date()) {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const startMs = Date.UTC(year, month, day) - JST_OFFSET_MS;
  const date = [year, month + 1, day]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('-');
  return {
    date,
    start: Math.floor(startMs / 1000),
    end: Math.floor((startMs + DAY_MS) / 1000),
  };
}

function normalizeAnimeUrl(value, mediaId) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'anilist.co' && /^\/anime\/\d+/.test(url.pathname)) {
      return url.toString();
    }
  } catch {}
  return Number.isInteger(mediaId) ? `https://anilist.co/anime/${mediaId}` : '';
}

function normalizeSchedules(entries = []) {
  const seen = new Set();
  return entries
    .map(entry => {
      const media = entry?.media;
      const airingAt = Number(entry?.airingAt);
      const episode = Number(entry?.episode);
      if (!media || media.countryOfOrigin !== 'JP' || media.isAdult) return null;
      if (!ALLOWED_FORMATS.has(media.format)) return null;
      if (!Number.isFinite(airingAt) || !Number.isFinite(episode)) return null;

      const title = media.title?.native || media.title?.romaji || media.title?.english;
      const mediaId = Number(media.id);
      if (!title || !Number.isInteger(mediaId)) return null;
      const key = `${mediaId}:${episode}:${airingAt}`;
      if (seen.has(key)) return null;
      seen.add(key);

      return {
        id: key,
        mediaId,
        title,
        episode,
        airingAt,
        format: media.format,
        coverImage: media.coverImage?.medium || media.coverImage?.large || '',
        siteUrl: normalizeAnimeUrl(media.siteUrl, mediaId),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.airingAt - right.airingAt || left.title.localeCompare(right.title, 'ja'));
}

function createAnimeScheduleService({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  cacheMs = DEFAULT_CACHE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let cache = null;
  let inFlight = null;

  async function fetchPage(page, range) {
    if (typeof fetchImpl !== 'function') throw new Error('Anime schedule network access is unavailable');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(ANILIST_ENDPOINT, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: TODAY_SCHEDULE_QUERY,
          variables: { page, start: range.start - 1, end: range.end },
        }),
        signal: controller.signal,
      });
      if (!response?.ok) {
        throw new Error(`AniList request failed (${response?.status || 'network'})`);
      }
      const payload = await response.json();
      if (payload?.errors?.length) {
        throw new Error(payload.errors[0]?.message || 'AniList returned an error');
      }
      const result = payload?.data?.Page;
      if (!result || !Array.isArray(result.airingSchedules)) {
        throw new Error('AniList returned an invalid schedule');
      }
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('AniList request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function requestToday() {
    const requestedAt = now();
    const range = getJstDayRange(requestedAt);
    const entries = [];
    let page = 1;
    let hasNextPage = false;
    do {
      const result = await fetchPage(page, range);
      entries.push(...result.airingSchedules);
      hasNextPage = result.pageInfo?.hasNextPage === true;
      page += 1;
    } while (hasNextPage && page <= 3);

    return {
      date: range.date,
      timezone: 'Asia/Tokyo',
      fetchedAt: requestedAt.toISOString(),
      items: normalizeSchedules(entries),
    };
  }

  async function listToday({ force = false } = {}) {
    const currentTime = now().getTime();
    const today = getJstDayRange(new Date(currentTime)).date;
    if (!force && cache && cache.value.date === today && currentTime - cache.storedAt < cacheMs) {
      return cache.value;
    }
    if (!force && inFlight) return inFlight;

    const request = requestToday().then(value => {
      cache = { value, storedAt: now().getTime() };
      return value;
    });
    inFlight = request;
    try {
      return await request;
    } finally {
      if (inFlight === request) inFlight = null;
    }
  }

  return { listToday };
}

module.exports = {
  ANILIST_ENDPOINT,
  TODAY_SCHEDULE_QUERY,
  createAnimeScheduleService,
  getJstDayRange,
  normalizeSchedules,
};
