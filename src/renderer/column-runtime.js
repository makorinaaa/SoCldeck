(function (global) {
  const COLUMN_LAYOUT_KEY = 'socialdeck_cols';
  const WIDGET_COLUMN_KEY = 'socialdeck_widget_col';
  const SAFE_X_PATHS = new Set(['/home', '/notifications', '/messages', '/explore', '/search', '/settings']);

  function isWidgetLocation(locationLike = global.location) {
    return new URLSearchParams(locationLike.search).get('widget') === '1';
  }

  function normalizeXUrl(value) {
    if (!value || !/x\.com|twitter\.com/.test(value)) return value;
    try {
      const url = new URL(value);
      const path = url.pathname.replace(/\/$/, '');
      const isList = /^\/i\/lists\/\d+$/.test(path);
      if (!SAFE_X_PATHS.has(path) && !isList) return 'https://x.com/home';
    } catch {}
    return value;
  }

  function normalizeLayout(layout) {
    if (!Array.isArray(layout)) return [];
    return layout.map(col => {
      if (col?.kind === 'wv' && col.url) {
        return { ...col, url: normalizeXUrl(col.url) };
      }
      return col;
    });
  }

  function createColumnRuntime({
    storage = global.localStorage,
    locationLike = global.location,
  } = {}) {
    function captureLayout(columns, {
      resolveDefinition,
      getInterval,
      isCollapsed,
    }) {
      function captureCommonState(column, id, defaultIconClass) {
        return {
          title: column.querySelector('.col-title')?.textContent || '',
          sub: column.querySelector('.col-sub')?.textContent?.trim() || '',
          icCls: column.querySelector('.col-ic')?.className?.replace('col-ic ', '') || defaultIconClass,
          width: column.style.width || '',
          interval: getInterval(id),
          collapsed: isCollapsed(id),
        };
      }

      const layout = [];
      Array.from(columns).forEach(column => {
        const webview = column.querySelector('webview');
        const id = column.id.replace('col-', '');
        if (webview) {
          const definition = resolveDefinition({
            kind: 'wv',
            network: column.dataset.network,
            definitionId: column.dataset.definitionId,
            url: webview.src,
            partition: webview.partition,
          });
          layout.push({
            kind: 'wv',
            ...(definition && { network: definition.network, definitionId: definition.id }),
            id,
            url: normalizeXUrl(webview.src),
            partition: webview.partition,
            ...captureCommonState(column, id, 'ic-x'),
          });
          return;
        }

        if (column.dataset.type) {
          const definition = resolveDefinition({
            kind: 'bsky',
            network: column.dataset.network,
            definitionId: column.dataset.definitionId,
            type: column.dataset.type,
            feedUri: column.dataset.feeduri || '',
          });
          layout.push({
            kind: 'bsky',
            ...(definition && { network: definition.network, definitionId: definition.id }),
            id,
            type: column.dataset.type,
            feedUri: column.dataset.feeduri || '',
            ...captureCommonState(column, id, 'ic-b'),
          });
        }
      });
      return layout;
    }

    function readStoredLayout() {
      try {
        return normalizeLayout(JSON.parse(storage.getItem(COLUMN_LAYOUT_KEY)) || []);
      } catch {
        return [];
      }
    }

    function writeStoredLayout(layout) {
      storage.setItem(COLUMN_LAYOUT_KEY, JSON.stringify(normalizeLayout(layout)));
    }

    function getLayoutForCurrentMode() {
      const layout = readStoredLayout();
      if (!isWidgetLocation(locationLike) || layout.length === 0) return layout;

      const selectedId = storage.getItem(WIDGET_COLUMN_KEY);
      const selected = layout.find(col => col.id === selectedId) || layout[0];
      return [{ ...selected, collapsed: false, width: '' }];
    }

    return {
      layoutKey: COLUMN_LAYOUT_KEY,
      widgetColumnKey: WIDGET_COLUMN_KEY,
      isWidgetMode: () => isWidgetLocation(locationLike),
      normalizeXUrl,
      captureLayout,
      readStoredLayout,
      writeStoredLayout,
      getLayoutForCurrentMode,
      clearStoredLayout: () => storage.removeItem(COLUMN_LAYOUT_KEY),
      getWidgetColumnId: () => storage.getItem(WIDGET_COLUMN_KEY),
      setWidgetColumnId: (id) => storage.setItem(WIDGET_COLUMN_KEY, id),
    };
  }

  global.SocialDeckColumnRuntime = {
    COLUMN_LAYOUT_KEY,
    WIDGET_COLUMN_KEY,
    createColumnRuntime,
    normalizeXUrl,
  };
})(window);
