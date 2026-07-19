(function (global) {
  const WIDGET_STYLES = `
    body.widget-mode { background: transparent !important; }
    body.widget-mode .sidebar,
    body.widget-mode .topbar,
    body.widget-mode #login-screen { display: none !important; }
    body.widget-mode .main { margin: 0 !important; }
    body.widget-mode #cols {
      padding: 0 !important;
      gap: 0 !important;
      background: transparent !important;
    }
    body.widget-mode .col {
      width: 100% !important;
      min-width: 100% !important;
      height: calc(100vh - 34px) !important;
      border-radius: 0 0 10px 10px !important;
      border: 1px solid var(--border) !important;
      border-top: none !important;
    }
    body.widget-mode .col .col-actions .cbtn { display: none !important; }
    body.widget-mode .col .col-actions .cbtn.wg-keep { display: flex !important; }
    /* ドラッグハンドルバー */
    #widget-bar {
      height: 34px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-bottom: 1px solid var(--border2);
      border-radius: 10px 10px 0 0;
      -webkit-app-region: drag;
      user-select: none;
    }
    #widget-bar .wg-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text2);
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      overflow: hidden;
      white-space: nowrap;
    }
    #widget-bar button {
      -webkit-app-region: no-drag;
      width: 22px;
      height: 22px;
      border-radius: 5px;
      border: none;
      background: transparent;
      color: var(--text3);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
      flex-shrink: 0;
    }
    #widget-bar button:hover { background: var(--bg3); color: var(--text1); }
    #widget-bar button.active { color: var(--accent); }
    #widget-bar button svg { width: 13px; height: 13px; }
    #widget-bar input[type="range"] {
      -webkit-app-region: no-drag;
      width: 60px;
      accent-color: var(--accent);
    }
  `;

  function createWidgetModeRuntime({
    documentRef = global.document,
    widgetHost = null,
    columnRuntime,
    intents = {},
  } = {}) {
    if (!columnRuntime) {
      throw new Error('Widget Mode requires the Column Runtime boundary');
    }
    const toast = intents.toast || (() => {});

    async function init() {
      documentRef.body.classList.add('widget-mode');

      const style = documentRef.createElement('style');
      style.textContent = WIDGET_STYLES;
      documentRef.head.appendChild(style);

      // ドラッグハンドルバーを挿入
      const bar = documentRef.createElement('div');
      bar.id = 'widget-bar';

      let columnOptions = '';
      try {
        const fullLayout = columnRuntime.readStoredLayout();
        const selectedId = columnRuntime.getWidgetColumnId() || fullLayout[0]?.id;
        columnOptions = fullLayout.map(column =>
          `<option value="${column.id}" ${column.id === selectedId ? 'selected' : ''}>${(column.title || column.id)}${column.sub ? ' · ' + column.sub : ''}</option>`
        ).join('');
      } catch {}

      bar.innerHTML = `
        <div class="wg-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
          <select id="wg-col-select" data-change-action="widget-select-column"
            style="-webkit-app-region:no-drag;background:var(--bg3);border:1px solid var(--border);border-radius:5px;color:var(--text2);font-size:10px;font-family:inherit;padding:2px 4px;max-width:150px">
            ${columnOptions}
          </select>
        </div>
        <input type="range" min="30" max="100" value="100" title="Opacity" id="wg-opacity"
          data-input-action="widget-set-opacity">
        <button id="wg-top-btn" title="Always on top" data-action="widget-toggle-top">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>
        </button>
        <button title="Close" data-action="widget-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
      documentRef.body.prepend(bar);

      if (widgetHost) {
        try {
          const opacity = await widgetHost.getOpacity();
          const slider = documentRef.getElementById('wg-opacity');
          if (slider && opacity) {
            slider.value = Math.round(opacity * 100);
            widgetHost.setOpacity(opacity);
          }
          if (await widgetHost.getTop()) {
            documentRef.getElementById('wg-top-btn')?.classList.add('active');
          }
        } catch {}
      }
    }

    async function toggleTop() {
      if (!widgetHost) return;
      const next = await widgetHost.toggleTop();
      const button = documentRef.getElementById('wg-top-btn');
      if (button) button.classList.toggle('active', next);
      toast(next ? 'Always on top enabled' : 'Always on top disabled');
    }

    function setOpacity(percent) {
      widgetHost?.setOpacity(Number(percent) / 100);
    }

    function close() {
      widgetHost?.close();
    }

    function selectColumn(columnId) {
      columnRuntime.setWidgetColumnId(columnId);
      intents.reload?.();
    }

    return { close, init, selectColumn, setOpacity, toggleTop };
  }

  global.SocialDeckWidgetModeRuntime = { createWidgetModeRuntime };
})(window);
