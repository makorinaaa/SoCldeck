const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ANILIST_ENDPOINT,
  createAnimeScheduleService,
  getJstBroadcastDayRange,
  normalizeSchedules,
} = require('../src/main/anime-schedule');

test('creates a Japanese broadcast-day range through 27:00', () => {
  const range = getJstBroadcastDayRange(new Date('2026-07-16T12:34:00+09:00'));

  assert.deepEqual(range, {
    date: '2026-07-16',
    start: Date.parse('2026-07-16T00:00:00+09:00') / 1000,
    end: Date.parse('2026-07-17T03:00:00+09:00') / 1000,
  });
});

test('normalizes safe Japanese TV and online schedules in airing order', () => {
  const entries = [
    {
      airingAt: 300,
      episode: 3,
      media: {
        id: 3,
        title: { native: '三番目' },
        coverImage: { medium: 'https://img/3.jpg' },
        siteUrl: 'https://anilist.co/anime/3/example',
        countryOfOrigin: 'JP',
        format: 'ONA',
        isAdult: false,
      },
    },
    {
      airingAt: 100,
      episode: 1,
      media: {
        id: 1,
        title: { native: '最初' },
        coverImage: { medium: 'https://img/1.jpg' },
        siteUrl: 'javascript:alert(1)',
        countryOfOrigin: 'JP',
        format: 'TV',
        isAdult: false,
      },
    },
    {
      airingAt: 200,
      episode: 2,
      media: {
        id: 2,
        title: { native: '対象外' },
        countryOfOrigin: 'KR',
        format: 'TV',
        isAdult: false,
      },
    },
    {
      airingAt: 400,
      episode: 4,
      media: {
        id: 4,
        title: { native: '成人向け' },
        countryOfOrigin: 'JP',
        format: 'TV',
        isAdult: true,
      },
    },
  ];

  assert.deepEqual(normalizeSchedules(entries), [
    {
      id: '1:1:100',
      mediaId: 1,
      title: '最初',
      episode: 1,
      airingAt: 100,
      format: 'TV',
      coverImage: 'https://img/1.jpg',
      siteUrl: 'https://anilist.co/anime/1',
    },
    {
      id: '3:3:300',
      mediaId: 3,
      title: '三番目',
      episode: 3,
      airingAt: 300,
      format: 'ONA',
      coverImage: 'https://img/3.jpg',
      siteUrl: 'https://anilist.co/anime/3/example',
    },
  ]);
});

test('caches today schedule and allows an explicit refresh', async () => {
  const calls = [];
  const clock = new Date('2026-07-16T09:00:00+09:00');
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({
        data: {
          Page: {
            pageInfo: { hasNextPage: false },
            airingSchedules: [],
          },
        },
      }),
    };
  };
  const service = createAnimeScheduleService({ fetchImpl, now: () => new Date(clock) });

  await service.listToday();
  await service.listToday();
  await service.listToday({ force: true });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, ANILIST_ENDPOINT);
  assert.equal(calls[0].body.variables.start, getJstBroadcastDayRange(clock).start - 1);
  assert.equal(calls[0].body.variables.end, getJstBroadcastDayRange(clock).end);
});

test('reports upstream failures without returning a partial schedule', async () => {
  const service = createAnimeScheduleService({
    fetchImpl: async () => ({ ok: false, status: 429 }),
    now: () => new Date('2026-07-16T09:00:00+09:00'),
  });

  await assert.rejects(service.listToday(), /AniList request failed \(429\)/);
});
