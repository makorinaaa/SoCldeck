(function (global) {
  const DEFAULT_APPEARANCE = Object.freeze({ theme: 'dark', accent: '#4e9af0' });
  const ACCENT_PRESETS = Object.freeze([
    '#4e9af0', '#3dc98a', '#e05c7a', '#9a5cf0', '#f08c46', '#26a7a1',
  ]);

  function normalizeAppearance(value) {
    const theme = value?.theme === 'light' ? 'light' : 'dark';
    const accent = /^#[0-9a-f]{6}$/i.test(String(value?.accent || ''))
      ? String(value.accent).toLowerCase()
      : DEFAULT_APPEARANCE.accent;
    return { theme, accent };
  }

  function accentDim(hex) {
    const value = hex.slice(1);
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${red},${green},${blue},0.15)`;
  }

  function createAppearanceRuntime({ root = global.document?.documentElement, persist = () => {} } = {}) {
    if (!root?.style?.setProperty || !root?.dataset) {
      throw new Error('Appearance Runtime requires a document root');
    }
    let current = { ...DEFAULT_APPEARANCE };
    let draft = null;

    function applyRoot(value) {
      const appearance = normalizeAppearance(value);
      root.dataset.theme = appearance.theme;
      root.style.setProperty('--accent', appearance.accent);
      root.style.setProperty('--accent-dim', accentDim(appearance.accent));
      return appearance;
    }

    function apply(value) {
      current = applyRoot(value);
      draft = null;
      return { ...current };
    }

    function begin() {
      draft = { ...current };
      return { ...draft };
    }

    function preview(partial) {
      if (!draft) begin();
      draft = normalizeAppearance({ ...draft, ...partial });
      applyRoot(draft);
      return { ...draft };
    }

    function cancel() {
      draft = null;
      applyRoot(current);
      return { ...current };
    }

    function commit() {
      if (draft) current = normalizeAppearance(draft);
      draft = null;
      applyRoot(current);
      persist({ ...current });
      return { ...current };
    }

    return {
      apply,
      begin,
      cancel,
      commit,
      getCurrent: () => ({ ...(draft || current) }),
      preview,
    };
  }

  global.SocialDeckAppearanceRuntime = {
    ACCENT_PRESETS,
    DEFAULT_APPEARANCE,
    createAppearanceRuntime,
    normalizeAppearance,
  };
})(window);
