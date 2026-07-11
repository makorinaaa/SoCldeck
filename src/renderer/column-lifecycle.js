(function (global) {
  function createColumnLifecycle({
    createPlan,
    registerRefresh,
    cleanupRefresh = () => {},
    insertPlan,
    setRefreshInterval,
    applyWidth,
    applyCollapsed,
    reportRestoreError = () => {},
    cleanupRuntimeState = () => {},
    removeElement = () => false,
    persistWorkspace = () => {},
  }) {
    function materialize(plan) {
      if (!plan || !plan.config || !plan.refresh) {
        throw new Error('Column Definition could not be resolved');
      }

      registerRefresh(plan.config.id, plan.refresh);
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

    return { create, persist: persistWorkspace, remove, restore };
  }

  global.SocialDeckColumnLifecycle = { createColumnLifecycle };
})(window);
