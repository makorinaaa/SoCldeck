const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createMemoryMetricsService,
  normalizeProcessMetrics,
} = require('../src/main/memory-metrics');

test('groups bounded Electron process memory metrics', () => {
  const snapshot = normalizeProcessMetrics([
    { type: 'Browser', memory: { privateBytes: 50_000 } },
    { type: 'Tab', memory: { privateBytes: 30_000 } },
    { type: 'GPU', memory: { privateBytes: 20_000 } },
    { type: 'Utility', memory: { privateBytes: 10_000 } },
    { type: 'Other', memory: { privateBytes: 5_000 } },
    { type: 'Tab', memory: { privateBytes: -1 } },
    { type: 'Tab', memory: { privateBytes: Number.NaN } },
  ]);

  assert.deepEqual(snapshot, {
    totalKb: 115_000,
    processCount: 5,
    groups: {
      browser: 50_000,
      renderer: 30_000,
      gpu: 20_000,
      utility: 10_000,
      other: 5_000,
    },
  });
});

test('reads app metrics through a small service boundary', () => {
  const service = createMemoryMetricsService({
    getAppMetrics: () => [{ type: 'Browser', memory: { privateBytes: 42 } }],
  });

  assert.equal(service.snapshot().totalKb, 42);
});
