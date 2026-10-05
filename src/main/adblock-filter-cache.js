const fs = require('node:fs');

const ADBLOCK_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Starts from the cached filter lists right away. A missing or unreadable cache is
// downloaded before use; an old one is used now and replaced in the background, so
// the lists do not stay frozen at the first download.
async function loadAdBlocker({
  cachePath,
  deserialize,
  download,
  onRefresh = () => {},
  maxAgeMs = ADBLOCK_CACHE_MAX_AGE_MS,
  now = Date.now,
  fsImpl = fs.promises,
  logger = console,
}) {
  async function downloadAndCache() {
    const blocker = await download();
    await fsImpl.writeFile(cachePath, Buffer.from(blocker.serialize()));
    return blocker;
  }

  let cached = null;
  let stale = true;
  try {
    const [bytes, stat] = await Promise.all([fsImpl.readFile(cachePath), fsImpl.stat(cachePath)]);
    cached = deserialize(new Uint8Array(bytes));
    stale = now() - stat.mtimeMs > maxAgeMs;
  } catch (error) {
    if (error?.code !== 'ENOENT') logger.warn('[AdBlock] Cached filter lists are unreadable', error?.message || error);
  }

  if (!cached) return { blocker: await downloadAndCache(), source: 'download' };
  if (stale) {
    downloadAndCache()
      .then(onRefresh)
      .catch(error => logger.warn('[AdBlock] Filter list refresh failed', error?.message || error));
  }
  return { blocker: cached, source: stale ? 'stale-cache' : 'cache' };
}

module.exports = { ADBLOCK_CACHE_MAX_AGE_MS, loadAdBlocker };
