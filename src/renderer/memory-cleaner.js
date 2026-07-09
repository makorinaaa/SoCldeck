(function (global) {
  const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

  function createMemoryCleaner({
    storage = global.localStorage,
    key,
    clearMemory,
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

    async function clear() {
      if (clearMemory) await clearMemory();
    }

    function start() {
      clearIntervalImpl(timer);
      const ms = getInterval();
      if (!ms || ms <= 0) {
        timer = null;
        return;
      }
      timer = setIntervalImpl(() => {
        clear().catch(() => {});
      }, ms);
    }

    function stop() {
      clearIntervalImpl(timer);
      timer = null;
    }

    return {
      getInterval,
      setIntervalMs,
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
