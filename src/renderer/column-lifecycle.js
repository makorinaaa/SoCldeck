(function (global) {
  function createColumnLifecycle({
    createPlan,
    insertPlan,
    scheduleRefresh = () => {},
    clearRefreshSchedule = () => {},
    executeRefresh = () => {},
    applyWidth,
    applyCollapsed,
    reportRestoreError = () => {},
    cleanupRuntimeState = () => {},
    removeElement = () => false,
    persistWorkspace = () => {},
  }) {
    const refreshPlans = new Map();
    const refreshIntervals = {};

    function setRefreshInterval(id, interval) {
      refreshIntervals[id] = interval;
      clearRefreshSchedule(id);
      if (!interval || interval <= 0) return;
      scheduleRefresh(id, interval, () => executeRefresh(id, refreshPlans.get(id)));
    }

    function cleanupRefresh(id) {
      clearRefreshSchedule(id);
      delete refreshIntervals[id];
      refreshPlans.delete(id);
    }

    function materialize(plan) {
      if (!plan || !plan.config || !plan.refresh) {
        throw new Error('Column Definition could not be resolved');
      }

      refreshPlans.set(plan.config.id, plan.refresh);
      if (!insertPlan(plan)) throw new Error(`Unsupported Column plan: ${plan.kind || 'missing'}`);
      return plan;
    }

    function create(request) {
      let plan;
      try {
        plan = createPlan(request);
        if (plan?.kind === 'input-required') return { status: 'input-required', plan };
        materialize(plan);
        persistWorkspace();
        return { status: 'created', id: plan.config.id, plan };
      } catch (error) {
        cleanupRefresh(plan?.config?.id || request?.id);
        return { status: 'failed', error };
      }
    }

    function normalizeStoredColumn(storedColumn, plan) {
      return {
        ...storedColumn,
        network: plan.config.network,
        definitionId: plan.config.definitionId,
      };
    }

    function remove(id) {
      cleanupRefresh(id);
      cleanupRuntimeState(id);
      const removed = removeElement(id);
      if (!removed) return { status: 'not-found', id };
      persistWorkspace();
      return { status: 'removed', id };
    }

    function pauseRefresh() {
      Object.keys(refreshIntervals).forEach(clearRefreshSchedule);
    }

    function resumeRefresh() {
      Object.entries(refreshIntervals).forEach(([id, interval]) => setRefreshInterval(id, interval));
    }

    function clear() {
      Object.keys(refreshIntervals).forEach(cleanupRefresh);
      refreshPlans.clear();
    }

    function restore(layout, { persistNormalized } = {}) {
      const normalizedLayout = [];
      const failures = [];

      layout.forEach(storedColumn => {
        try {
          const plan = materialize(createPlan({ storedColumn }));

          if (storedColumn.interval !== undefined) {
            setRefreshInterval(storedColumn.id, storedColumn.interval);
          }
          if (storedColumn.width) applyWidth(storedColumn.id, storedColumn.width);
          if (storedColumn.collapsed) applyCollapsed(storedColumn.id);

          normalizedLayout.push(normalizeStoredColumn(storedColumn, plan));
        } catch (error) {
          cleanupRefresh(storedColumn.id);
          failures.push({ storedColumn, error });
          reportRestoreError(storedColumn, error);
          normalizedLayout.push(storedColumn);
        }
      });

      if (failures.length === 0 && persistNormalized) {
        persistNormalized(normalizedLayout);
      }

      return {
        restoredCount: layout.length - failures.length,
        failures,
        normalizedLayout,
      };
    }

    return {
      clear,
      create,
      getRefreshInterval: (id, fallback) => refreshIntervals[id] ?? fallback,
      pauseRefresh,
      persist: persistWorkspace,
      remove,
      restore,
      resumeRefresh,
      setRefreshInterval,
    };
  }

  global.SocialDeckColumnLifecycle = { createColumnLifecycle };
})(window);
