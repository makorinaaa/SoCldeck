(function (global) {
  const COLUMN_LAYOUT_KEY = 'socialdeck_cols';
  const WIDGET_COLUMN_KEY = 'socialdeck_widget_col';
  const WIDGET_TABS_KEY = 'socialdeck_widget_tabs';
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

  function filterLayoutForAccounts(layout, { bluesky = false } = {}) {
    if (!Array.isArray(layout) || bluesky) return Array.isArray(layout) ? layout : [];
    return layout.filter(column => column?.kind !== 'bsky' && column?.network !== 'b');
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
          width: (isCollapsed(id) ? column.dataset.savedWidth ?? column.style.width : column.style.width) || '',
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

        const columnKind = column.dataset.kind || (column.dataset.type ? 'bsky' : null);
        if (columnKind) {
          const definition = resolveDefinition({
            kind: columnKind,
            network: column.dataset.network,
            definitionId: column.dataset.definitionId,
            type: column.dataset.type,
            feedUri: column.dataset.feeduri || '',
          });
          layout.push({
            kind: columnKind,
            ...(definition && { network: definition.network, definitionId: definition.id }),
            id,
            ...(columnKind === 'bsky' && {
              type: column.dataset.type,
              feedUri: column.dataset.feeduri || '',
            }),
            ...(columnKind === 'x-native' && { partition: column.dataset.partition }),
            ...captureCommonState(column, id, {
              schedule: 'ic-anime',
              'x-native': 'ic-x',
            }[columnKind] || 'ic-b'),
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

      return getWidgetTabColumns(layout).map(col => ({ ...col, collapsed: false, width: '' }));
    }

    function readWidgetTabIds() {
      try {
        const ids = JSON.parse(storage.getItem(WIDGET_TABS_KEY) || '[]');
        return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
      } catch {
        return [];
      }
    }

    // ウィジェットのタブとして開くカラム。消えたカラムは除き、空なら選択中か先頭の1つにする
    function getWidgetTabColumns(layout = readStoredLayout()) {
      const tabs = readWidgetTabIds()
        .map(id => layout.find(col => col.id === id))
        .filter(Boolean);
      if (tabs.length) return tabs;
      const selectedId = storage.getItem(WIDGET_COLUMN_KEY);
      const selected = layout.find(col => col.id === selectedId) || layout[0];
      return selected ? [selected] : [];
    }

    return {
      layoutKey: COLUMN_LAYOUT_KEY,
      widgetColumnKey: WIDGET_COLUMN_KEY,
      isWidgetMode: () => isWidgetLocation(locationLike),
      normalizeXUrl,
      captureLayout,
      filterLayoutForAccounts,
      readStoredLayout,
      writeStoredLayout,
      getLayoutForCurrentMode,
      clearStoredLayout: () => storage.removeItem(COLUMN_LAYOUT_KEY),
      getWidgetColumnId: () => storage.getItem(WIDGET_COLUMN_KEY),
      setWidgetColumnId: (id) => storage.setItem(WIDGET_COLUMN_KEY, id),
      getWidgetTabIds: () => getWidgetTabColumns().map(col => col.id),
      setWidgetTabIds: (ids) => storage.setItem(WIDGET_TABS_KEY, JSON.stringify(ids)),
    };
  }

  global.SocialDeckColumnRuntime = {
    COLUMN_LAYOUT_KEY,
    WIDGET_COLUMN_KEY,
    WIDGET_TABS_KEY,
    createColumnRuntime,
    filterLayoutForAccounts,
    normalizeXUrl,
  };
})(window);
