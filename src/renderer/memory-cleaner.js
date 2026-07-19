(function (global) {
  const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

  function createMemoryCleaner({
    storage = global.localStorage,
    key,
    clearMemory,
    getMemoryMetrics,
    getRuntimeMetrics,
    trimRuntime,
    setIntervalImpl = global.setInterval,
    clearIntervalImpl = global.clearInterval,
    defaultIntervalMs = DEFAULT_INTERVAL_MS,
  }) {
    let timer = null;

    function getInterval() {
      const value = parseInt(storage.getItem(key));
      return Number.isNaN(value) ? defaultIntervalMs : value;
    }

    function setIntervalMs(ms) {
      storage.setItem(key, ms);
      start();
    }

    async function measure() {
      const [host, runtime] = await Promise.all([
        getMemoryMetrics ? getMemoryMetrics() : null,
        getRuntimeMetrics ? getRuntimeMetrics() : null,
      ]);
      return { host: host || null, runtime: runtime || null };
    }

    async function clear({ includeCache = false } = {}) {
      const before = await measure();
      const runtimeCleanup = trimRuntime ? await trimRuntime() : {};
      let cacheCleared = false;
      if (includeCache && clearMemory) {
        cacheCleared = await clearMemory() !== false;
      }
      const after = await measure();
      return {
        before,
        after,
        runtimeCleanup: runtimeCleanup || {},
        cacheCleared,
      };
    }

    function start() {
      clearIntervalImpl(timer);
      const ms = getInterval();
      if (!ms || ms <= 0) {
        timer = null;
        return;
      }
      timer = setIntervalImpl(() => clear().catch(() => {}), ms);
    }

    function stop() {
      clearIntervalImpl(timer);
      timer = null;
    }

    return {
      getInterval,
      setIntervalMs,
      measure,
      clear,
      start,
      stop,
    };
  }

  global.SocialDeckMemoryCleaner = {
    DEFAULT_INTERVAL_MS,
    createMemoryCleaner,
  };
})(window);
