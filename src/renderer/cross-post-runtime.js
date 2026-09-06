(function (global) {
  function createCrossPostRuntime() {
    const targets = new Map();

    async function submit(entries, { retryUnknown = false, onProgress = () => {} } = {}) {
      entries.forEach(entry => {
        if (!targets.has(entry.id) || !targets.get(entry.id).deliver) {
          const restored = targets.get(entry.id);
          targets.set(entry.id, {
            id: entry.id,
            request: entry.request,
            deliver: entry.deliver,
            status: restored?.status || 'pending',
            error: null,
          });
        }
      });

      const runnable = Array.from(targets.values()).filter(target => (
        target.status === 'pending'
        || target.status === 'failed'
        || (retryUnknown && target.status === 'unknown')
      ));

      await Promise.all(runnable.map(async target => {
        target.status = 'sending';
        target.error = null;
        try {
          const value = await target.deliver(target.request);
          target.status = value?.status === 'unknown' ? 'unknown' : 'succeeded';
          target.value = value;
        } catch (error) {
          target.status = 'failed';
          target.error = error;
        }
        onProgress();
      }));

      const results = Array.from(targets.values()).map(target => ({
        id: target.id,
        status: target.status,
        error: target.error,
        request: target.request,
        value: target.value,
      }));
      const statuses = results.map(result => result.status);
      const status = statuses.every(value => value === 'succeeded')
        ? 'succeeded'
        : statuses.includes('unknown')
          ? 'unknown'
          : statuses.includes('succeeded')
            ? 'partial'
            : 'failed';
      return { status, results };
    }

    function reset() {
      targets.clear();
    }

    return {
      restore(results) {
        targets.clear();
        (results || []).filter(target => ['x', 'b'].includes(target.id)).forEach(target => {
          targets.set(target.id, { id: target.id, status: target.status === 'succeeded' ? 'succeeded'
            : target.status === 'failed' ? 'failed' : 'unknown', error: target.error || null });
        });
      },
      getSnapshot: () => ({
        targets: Array.from(targets.values()).map(target => ({
          id: target.id,
          status: target.status,
          error: target.error,
          request: target.request,
        })),
      }),
      reset,
      submit,
    };
  }

  global.SocialDeckCrossPostRuntime = { createCrossPostRuntime };
})(window);
