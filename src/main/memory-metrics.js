const PROCESS_GROUPS = Object.freeze({
  browser: 'browser',
  tab: 'renderer',
  gpu: 'gpu',
  utility: 'utility',
});

function toMemoryKb(metric) {
  const value = Number(metric?.memory?.privateBytes);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function normalizeProcessMetrics(metrics = []) {
  const groups = {
    browser: 0,
    renderer: 0,
    gpu: 0,
    utility: 0,
    other: 0,
  };
  let processCount = 0;

  for (const metric of Array.isArray(metrics) ? metrics : []) {
    const memoryKb = toMemoryKb(metric);
    if (memoryKb === null) continue;
    const type = String(metric?.type || '').toLowerCase();
    const group = PROCESS_GROUPS[type] || 'other';
    groups[group] += memoryKb;
    processCount += 1;
  }

  return {
    totalKb: Object.values(groups).reduce((total, value) => total + value, 0),
    processCount,
    groups,
  };
}

function createMemoryMetricsService({ getAppMetrics }) {
  if (typeof getAppMetrics !== 'function') {
    throw new TypeError('getAppMetrics must be a function');
  }
  return {
    snapshot: () => normalizeProcessMetrics(getAppMetrics()),
  };
}

module.exports = {
  createMemoryMetricsService,
  normalizeProcessMetrics,
};
