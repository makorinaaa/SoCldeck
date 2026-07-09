(function (global) {
  const DEFAULT_INTERVAL_MS = 60000;

  function createRefreshScheduler({ setIntervalImpl = global.setInterval, clearIntervalImpl = global.clearInterval } = {}) {
    const timers = {};
    const intervals = {};

    function set(id, ms, callback) {
      clear(id);
      intervals[id] = ms;
      if (!ms || ms <= 0) return;
      timers[id] = setIntervalImpl(callback, ms);
    }

    function clear(id) {
      if (!timers[id]) return;
      clearIntervalImpl(timers[id]);
      delete timers[id];
    }

    function clearAll() {
      Object.keys(timers).forEach(clear);
    }

    function getInterval(id, fallback = DEFAULT_INTERVAL_MS) {
      return intervals[id] ?? fallback;
    }

    return {
      DEFAULT_INTERVAL_MS,
      timers,
      intervals,
      set,
      clear,
      clearAll,
      getInterval,
    };
  }

  global.SocialDeckRefreshScheduler = {
    DEFAULT_INTERVAL_MS,
    createRefreshScheduler,
  };
})(window);
