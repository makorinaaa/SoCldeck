(function (global) {
  const FORMAT_LABELS = {
    TV: 'TV',
    TV_SHORT: '短編',
    ONA: '配信',
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function formatJstTime(airingAt, broadcastDate) {
    const startMs = Date.parse(`${broadcastDate || ''}T00:00:00+09:00`);
    const airingMs = Number(airingAt) * 1000;
    const broadcastMinutes = Math.floor((airingMs - startMs) / 60000);
    if (Number.isFinite(startMs) && Number.isFinite(broadcastMinutes)
      && broadcastMinutes >= 0 && broadcastMinutes <= 27 * 60) {
      const hour = Math.floor(broadcastMinutes / 60);
      const minute = broadcastMinutes % 60;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(Number(airingAt) * 1000));
  }

  function formatJstDate(dateValue) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue || '');
    if (!match) return '本日';
    const [, year, month, day] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00+09:00`);
    const weekday = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      weekday: 'short',
    }).format(date);
    return `${Number(month)}月${Number(day)}日（${weekday}）`;
  }

  function renderScheduleHtml(schedule, { nowMs = Date.now() } = {}) {
    const items = Array.isArray(schedule?.items) ? schedule.items : [];
    const nextIndex = items.findIndex(item => Number(item.airingAt) * 1000 >= nowMs);
    const dateLabel = formatJstDate(schedule?.date);
    const summary = `<div class="anime-day-summary"><span>${escapeHtml(dateLabel)}</span><span>${items.length}作品</span></div>`;
    if (items.length === 0) {
      return `${summary}<div class="feed-empty">本日の放送・配信予定はありません</div>`;
    }

    return summary + items.map((item, index) => {
      const aired = Number(item.airingAt) * 1000 < nowMs;
      const isNext = index === nextIndex;
      const classes = ['anime-item', aired ? 'aired' : 'upcoming', isNext ? 'next' : '']
        .filter(Boolean)
        .join(' ');
      const siteUrl = safeHttpUrl(item.siteUrl);
      const coverImage = safeHttpUrl(item.coverImage);
      const content = `
        <div class="anime-time">
          <time datetime="${new Date(Number(item.airingAt) * 1000).toISOString()}">${escapeHtml(formatJstTime(item.airingAt, schedule?.date))}</time>
          <span>${escapeHtml(FORMAT_LABELS[item.format] || item.format || '')}</span>
        </div>
        <div class="anime-cover">${coverImage ? `<img src="${escapeHtml(coverImage)}" alt="" loading="lazy">` : ''}</div>
        <div class="anime-info">
          <div class="anime-title">${escapeHtml(item.title)}</div>
          <div class="anime-meta"><span>第${escapeHtml(item.episode)}話</span>${isNext ? '<strong>次の予定</strong>' : ''}</div>
        </div>`;
      return siteUrl
        ? `<a class="${classes}" href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener noreferrer">${content}</a>`
        : `<div class="${classes}">${content}</div>`;
    }).join('');
  }

  function createAnimeScheduleRuntime({
    documentRef = global.document,
    fetchSchedule,
    now = () => Date.now(),
  } = {}) {
    const revisions = new Map();

    function getFeed(id) {
      return documentRef.getElementById(`feed-${id}`);
    }

    async function load(id, { force = false } = {}) {
      const feed = getFeed(id);
      if (!feed) return { status: 'deferred', detail: 'column-unavailable' };
      const revision = (revisions.get(id) || 0) + 1;
      revisions.set(id, revision);
      const hasRows = Boolean(feed.querySelector?.('.anime-item'));
      if (!hasRows) {
        feed.innerHTML = '<div class="feed-loading"><div class="spinner"></div>放送予定を取得中…</div>';
      }
      feed.classList?.add('is-refreshing');

      try {
        if (typeof fetchSchedule !== 'function') throw new Error('Schedule API is unavailable');
        const schedule = await fetchSchedule(force);
        if (revisions.get(id) !== revision || getFeed(id) !== feed) {
          return { status: 'deferred', detail: 'column-disposed' };
        }
        feed.innerHTML = renderScheduleHtml(schedule, { nowMs: now() });
        const sub = documentRef.getElementById(`anime-sub-${id}`);
        if (sub) sub.textContent = `${formatJstDate(schedule?.date)} · ${schedule?.items?.length || 0}作品`;
        return { status: 'succeeded', detail: 'schedule-updated' };
      } catch (error) {
        if (revisions.get(id) !== revision || getFeed(id) !== feed) {
          return { status: 'deferred', detail: 'column-disposed' };
        }
        feed.innerHTML = `<div class="feed-err">放送予定を取得できませんでした<br><span>${escapeHtml(error.message)}</span><br><button type="button" data-anime-retry>再試行</button></div>`;
        feed.querySelector?.('[data-anime-retry]')?.addEventListener('click', () => {
          load(id, { force: true }).catch(() => {});
        });
        throw error;
      } finally {
        feed.classList?.remove('is-refreshing');
      }
    }

    function dispose(id) {
      revisions.set(id, (revisions.get(id) || 0) + 1);
    }

    function scrollTop(id) {
      const feed = getFeed(id);
      if (!feed) return false;
      feed.scrollTo?.({ top: 0, behavior: 'smooth' });
      return true;
    }

    return { dispose, load, scrollTop };
  }

  global.SocialDeckAnimeScheduleRuntime = {
    createAnimeScheduleRuntime,
    formatJstDate,
    renderScheduleHtml,
  };
})(window);
