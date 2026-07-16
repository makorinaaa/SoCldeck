const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadModule(windowOverrides = {}) {
  const context = {
    URL,
    Intl,
    window: { ...windowOverrides },
  };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'anime-schedule-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckAnimeScheduleRuntime;
}

function scheduleFixture() {
  return {
    date: '2026-07-16',
    timezone: 'Asia/Tokyo',
    items: [
      {
        id: '1:1:1',
        title: '朝の<アニメ>',
        episode: 1,
        airingAt: Date.parse('2026-07-16T11:00:00+09:00') / 1000,
        format: 'TV',
        coverImage: 'https://s4.anilist.co/file/a.jpg',
        siteUrl: 'https://anilist.co/anime/1',
      },
      {
        id: '2:2:2',
        title: '午後のアニメ',
        episode: 2,
        airingAt: Date.parse('2026-07-16T13:00:00+09:00') / 1000,
        format: 'ONA',
        coverImage: '',
        siteUrl: 'https://anilist.co/anime/2',
      },
      {
        id: '3:3:3',
        title: '深夜のアニメ',
        episode: 3,
        airingAt: Date.parse('2026-07-17T02:30:00+09:00') / 1000,
        format: 'TV',
        coverImage: '',
        siteUrl: 'https://anilist.co/anime/3',
      },
    ],
  };
}

test('renders aired items and highlights the next Japanese schedule safely', () => {
  const module = loadModule();
  const html = module.renderScheduleHtml(scheduleFixture(), {
    nowMs: Date.parse('2026-07-16T12:00:00+09:00'),
  });

  assert.match(html, /7月16日（木）/);
  assert.match(html, /anime-item aired/);
  assert.match(html, /anime-item upcoming next/);
  assert.match(html, /朝の&lt;アニメ&gt;/);
  assert.match(html, /第2話/);
  assert.match(html, /次の予定/);
  assert.match(html, /26:30/);
  assert.match(html, /深夜のアニメ/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /朝の<アニメ>/);
});

test('loads a schedule into its Column and updates the subtitle', async () => {
  const feed = {
    innerHTML: '',
    classList: { add: () => {}, remove: () => {} },
    querySelector: () => null,
    scrollTo: () => {},
  };
  const sub = { textContent: '' };
  const elements = new Map([
    ['feed-anime-1', feed],
    ['anime-sub-anime-1', sub],
  ]);
  const documentRef = { getElementById: id => elements.get(id) || null };
  const module = loadModule({ document: documentRef });
  const runtime = module.createAnimeScheduleRuntime({
    documentRef,
    fetchSchedule: async () => scheduleFixture(),
    now: () => Date.parse('2026-07-16T12:00:00+09:00'),
  });

  const result = await runtime.load('anime-1');

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'succeeded',
    detail: 'schedule-updated',
  });
  assert.match(feed.innerHTML, /午後のアニメ/);
  assert.equal(sub.textContent, '7月16日（木） · 3作品');
  assert.equal(runtime.scrollTop('anime-1'), true);
});

test('renders an empty state for a day without schedules', () => {
  const module = loadModule();
  const html = module.renderScheduleHtml({ date: '2026-07-16', items: [] });

  assert.match(html, /0作品/);
  assert.match(html, /本日の放送・配信予定はありません/);
});
