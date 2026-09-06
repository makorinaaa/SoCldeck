const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRuntime() {
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'appearance-runtime.js'),
    'utf8',
  );
  vm.runInNewContext(source, context);
  return context.window.SocialDeckAppearanceRuntime;
}

function createRoot() {
  const properties = new Map();
  return {
    dataset: {},
    style: { setProperty: (name, value) => properties.set(name, value) },
    properties,
  };
}

test('applies normalized theme and accent CSS variables', () => {
  const root = createRoot();
  const runtime = loadRuntime().createAppearanceRuntime({ root });

  const appearance = runtime.apply({ theme: 'light', accent: '#E05C7A', density: 'standard' });

  assert.deepEqual({ ...appearance }, { theme: 'light', accent: '#e05c7a', density: 'standard' });
  assert.equal(root.dataset.theme, 'light');
  assert.equal(root.properties.get('--accent'), '#e05c7a');
  assert.equal(root.properties.get('--accent-dim'), 'rgba(224,92,122,0.15)');
});

test('cancels previews and persists only committed appearance', () => {
  const root = createRoot();
  const saved = [];
  const runtime = loadRuntime().createAppearanceRuntime({
    root,
    persist: appearance => saved.push({ ...appearance }),
  });
  runtime.apply({ theme: 'dark', accent: '#4e9af0', density: 'standard' });

  runtime.begin();
  runtime.preview({ theme: 'light', accent: '#3dc98a', density: 'standard' });
  runtime.cancel();
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(saved.length, 0);

  runtime.begin();
  runtime.preview({ theme: 'light', accent: '#3dc98a', density: 'standard' });
  const committed = runtime.commit();
  assert.deepEqual({ ...committed }, { theme: 'light', accent: '#3dc98a', density: 'standard' });
  assert.deepEqual(saved, [{ theme: 'light', accent: '#3dc98a', density: 'standard' }]);
});

test('density previews cancel and committed density survives normalization', () => {
  const root = createRoot();
  const saved = [];
  const runtime = loadRuntime().createAppearanceRuntime({ root, persist: value => saved.push(value) });
  runtime.apply({ density: 'compact' });
  runtime.preview({ density: 'comfortable' });
  assert.equal(root.dataset.density, 'comfortable');
  runtime.cancel();
  assert.equal(root.dataset.density, 'compact');
  runtime.preview({ density: 'comfortable' });
  runtime.commit();
  assert.equal(saved[0].density, 'comfortable');
  assert.equal(loadRuntime().normalizeAppearance({ density: 'invalid' }).density, 'standard');
});
