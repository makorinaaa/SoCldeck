import { xPartitionOf } from './x-accounts.mjs';

const MAX_AGE_MS = 5 * 60 * 1000;

// Every reader of an account's X notifications (the notification center, its 30-second
// background check, native notification Columns) shares one hidden notification page.
// With a native Home Column, X's own notification badge on its hidden page says when
// something new arrived; the notification page is then loaded only for that, and closed
// right after. Without a badge, or while a native notification Column shows the account,
// the page is kept and refreshed in place, instead of being created for every check.
// Notifications are reused while the badge shows nothing new, but fetched again at least
// every `maxAgeMs` in case the badge cannot be read.
function createXNotificationLoader({
  readBadge = () => null,
  hasNotificationColumn = () => false,
  fetchNotifications,
  maxAgeMs = MAX_AGE_MS,
  now = Date.now,
}) {
  const cache = new Map();
  const loads = new Map();

  function load(account, accountIndex, { force = false } = {}) {
    const partition = xPartitionOf(account, accountIndex);
    const running = loads.get(partition);
    if (running && !force) return running;
    const current = (async () => {
      // A forced load must not reuse one that started earlier: it runs after it instead.
      if (running) await running.catch(() => {});
      const cached = cache.get(partition);
      const badge = (await readBadge(partition)) ?? null;
      const recent = cached && now() - cached.at < maxAgeMs;
      if (!force && badge !== null && recent && (badge === 0 || badge === cached.badge)) return cached.items;
      const items = await fetchNotifications({
        accountId: account.username || partition,
        retainReader: badge === null || hasNotificationColumn(partition) === true,
      });
      cache.set(partition, { items, badge, at: now() });
      return items;
    })();
    loads.set(partition, current);
    current.finally(() => {
      if (loads.get(partition) === current) loads.delete(partition);
    }).catch(() => {});
    return current;
  }

  // Without a partition, every account is forgotten.
  function forget(partition = null) {
    if (partition) cache.delete(partition);
    else cache.clear();
  }

  return { forget, load };
}

export { createXNotificationLoader };
