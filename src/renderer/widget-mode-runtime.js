(function (global) {
  const { escapeHtml } = global.SocialDeckHtmlEscape;

  const DEFAULT_FONT_SIZE = 13;
  const MIN_FONT_SIZE = 10;
  const MAX_FONT_SIZE = 20;

  const WIDGET_STYLES = `
    body.widget-mode {
      background: transparent !important;
      padding: 6px;
      /* 背景のみ透過でも不透明に保ちたい部分（メニューなど）が使う元の色 */
      --wg-base-bg1: var(--bg1);
      --wg-base-bg2: var(--bg2);
      --wg-base-bg3: var(--bg3);
    }
    body.widget-mode .topbar,
    body.widget-mode .sb,
    body.widget-mode .add-col-btn,
    body.widget-mode #login-screen { display: none !important; }
    body.widget-mode #app {
      flex: 1;
      min-height: 0;
      height: auto !important;
      background: var(--bg1);
      border: 1px solid var(--border2);
      border-top: none;
      border-radius: 0 0 12px 12px;
      overflow: hidden;
      box-shadow: 0 10px 28px rgba(0, 0, 0, .35);
    }
    body.widget-mode .layout { flex: 1; min-height: 0; height: 100%; }
    body.widget-mode #cols {
      position: relative;
      padding: 0 !important;
      gap: 0 !important;
      overflow: hidden !important;
      background: transparent !important;
    }
    /* タブのカラムを重ねて置き、選択中のものだけを見せる（裏のカラムも更新は続ける） */
    body.widget-mode .col {
      position: absolute !important;
      inset: 0;
      width: 100% !important;
      min-width: 0 !important;
      height: 100% !important;
      border: none !important;
      background: transparent !important;
    }
    body.widget-mode .col:not(.wg-active) { visibility: hidden; pointer-events: none; }
    /* カラム名と新着件数はタブに出すので、カラム側のヘッダーは隠す */
    body.widget-mode .col .col-head,
    body.widget-mode .col .col-resize { display: none !important; }

    /* 背景だけを透過し、文字や画像は不透明のまま残す */
    body.widget-bg-only #app,
    body.widget-bg-only #widget-bar {
      --bg1: color-mix(in srgb, var(--wg-base-bg1) var(--wg-bg-alpha, 100%), transparent);
      --bg2: color-mix(in srgb, var(--wg-base-bg2) var(--wg-bg-alpha, 100%), transparent);
      --bg3: color-mix(in srgb, var(--wg-base-bg3) var(--wg-bg-alpha, 100%), transparent);
    }

    #widget-bar {
      position: relative;
      flex-shrink: 0;
      height: 36px;
      display: flex;
      align-items: center;
      padding: 0 6px;
      background: var(--bg1);
      border: 1px solid var(--border2);
      border-bottom: 1px solid var(--border);
      border-radius: 12px 12px 0 0;
      box-shadow: 0 10px 28px rgba(0, 0, 0, .35);
      -webkit-app-region: drag;
      user-select: none;
    }
    /* 位置ロック中はドラッグ移動させない */
    body.widget-locked #widget-bar { -webkit-app-region: no-drag; }

    .wg-tabs {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .wg-tabs::-webkit-scrollbar { display: none; }
    .wg-tab {
      -webkit-app-region: no-drag;
      flex-shrink: 0;
      max-width: 150px;
      height: 26px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--text3);
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .wg-tab:hover { background: var(--hover); color: var(--text2); }
    .wg-tab.active { background: var(--bg3); color: var(--text1); }
    .wg-tab-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: var(--accent); }
    .wg-tab[data-network="x"] .wg-tab-dot { background: var(--x-color); }
    .wg-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wg-tab-count {
      flex-shrink: 0;
      padding: 0 6px;
      border-radius: 9px;
      background: var(--accent-dim);
      color: var(--accent);
      font-size: 10px;
      font-weight: 700;
      line-height: 16px;
    }
    .wg-tab-close {
      display: none;
      width: 14px;
      height: 14px;
      margin-right: -4px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text3);
      font-size: 12px;
      line-height: 14px;
      cursor: pointer;
    }
    .wg-tabs.closable .wg-tab:hover .wg-tab-close { display: block; }
    .wg-tab-close:hover { background: var(--bg3); color: var(--text1); }

    /* 操作ボタンはマウスを乗せたときだけタブの上に重ねて出す */
    .wg-controls {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 0 6px 0 24px;
      border-radius: 0 12px 0 0;
      background: linear-gradient(to right, transparent, var(--wg-base-bg1) 22px);
      opacity: 0;
      pointer-events: none;
      transition: opacity .15s;
    }
    body.widget-mode:hover .wg-controls,
    #widget-bar.wg-menu-open .wg-controls,
    #widget-bar:focus-within .wg-controls { opacity: 1; pointer-events: auto; }
    #widget-bar button.wg-icon {
      -webkit-app-region: no-drag;
      width: 24px;
      height: 24px;
      border-radius: 6px;
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
    #widget-bar button.wg-icon:hover { background: var(--wg-base-bg3); color: var(--text1); }
    #widget-bar button.wg-icon.active { color: var(--accent); }
    #widget-bar button.wg-icon svg { width: 14px; height: 14px; }

    .wg-popover {
      -webkit-app-region: no-drag;
      position: absolute;
      top: 38px;
      right: 4px;
      z-index: 50;
      width: 220px;
      max-height: calc(100vh - 60px);
      overflow-y: auto;
      padding: 10px;
      background: var(--wg-base-bg2);
      border: 1px solid var(--border2);
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, .45);
      color: var(--text2);
      font-size: 11px;
    }
    .wg-popover[hidden] { display: none; }
    .wg-popover.wg-picker { left: 4px; right: auto; padding: 4px; }
    .wg-menu-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; }
    .wg-menu-row + .wg-menu-row { margin-top: 4px; }
    .wg-menu-row input[type="range"] { flex: 1; max-width: 120px; accent-color: var(--accent); }
    .wg-check {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 4px 0;
      border: none;
      background: transparent;
      color: var(--text2);
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    .wg-check::before {
      content: '';
      width: 12px;
      height: 12px;
      border-radius: 3px;
      border: 1px solid var(--border2);
      flex-shrink: 0;
    }
    .wg-check.active::before { background: var(--accent); border-color: var(--accent); }
    .wg-stepper { display: flex; align-items: center; gap: 4px; }
    .wg-stepper button {
      width: 26px;
      height: 22px;
      border-radius: 5px;
      border: 1px solid var(--border2);
      background: var(--wg-base-bg3);
      color: var(--text1);
      font: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .wg-stepper span { min-width: 30px; text-align: center; color: var(--text1); }
    .wg-picker-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 8px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--text1);
      font: inherit;
      font-size: 11px;
      text-align: left;
      cursor: pointer;
    }
    .wg-picker-item:hover { background: var(--wg-base-bg3); }
    .wg-picker-item small { color: var(--text3); }
    .wg-picker-empty { padding: 8px; color: var(--text3); }
  `;

  const ICONS = {
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    top: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  function readBadgeCount(badge) {
    if (!badge || badge.style?.display === 'none') return 0;
    const match = String(badge.textContent || '').match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function createWidgetModeRuntime({
    documentRef = global.document,
    widgetHost = null,
    columnRuntime,
    intents = {},
    MutationObserverRef = global.MutationObserver,
  } = {}) {
    if (!columnRuntime) {
      throw new Error('Widget Mode requires the Column Runtime boundary');
    }
    const toast = intents.toast || (() => {});
    let backgroundOnly = false;
    let tabIds = [];
    let activeId = null;
    const unreadCounts = new Map();
    const badgeObservers = new Map();
    let columnsObserver = null;

    function byId(id) {
      return documentRef.getElementById(id);
    }

    function readLayout() {
      try {
        return columnRuntime.readStoredLayout();
      } catch {
        return [];
      }
    }

    function findColumn(layout, id) {
      return layout.find(column => column.id === id) || null;
    }

    function renderTabs() {
      const container = byId('wg-tabs');
      if (!container) return;
      const layout = readLayout();
      container.classList?.toggle('closable', tabIds.length > 1);
      container.innerHTML = tabIds.map(id => {
        const column = findColumn(layout, id) || { id };
        const count = unreadCounts.get(id) || 0;
        const title = column.title || column.id;
        return `<div class="wg-tab${id === activeId ? ' active' : ''}" data-action="widget-select-tab"
            data-column-id="${escapeHtml(id)}" data-network="${escapeHtml(column.network || '')}"
            title="${escapeHtml(title)}${column.sub ? ' · ' + escapeHtml(column.sub) : ''}">
          <span class="wg-tab-dot"></span>
          <span class="wg-tab-name">${escapeHtml(title)}</span>
          ${count ? `<span class="wg-tab-count">${count}</span>` : ''}
          <button class="wg-tab-close" title="タブを閉じる" data-action="widget-close-tab"
            data-column-id="${escapeHtml(id)}">×</button>
        </div>`;
      }).join('') + `<button class="wg-icon wg-tab-add" title="タブを追加" data-action="widget-open-picker">${ICONS.add}</button>`;
    }

    function renderPicker() {
      const picker = byId('wg-picker');
      if (!picker) return;
      const candidates = readLayout().filter(column => !tabIds.includes(column.id));
      picker.innerHTML = candidates.length
        ? candidates.map(column => `<button class="wg-picker-item" data-action="widget-add-tab"
            data-column-id="${escapeHtml(column.id)}">${escapeHtml(column.title || column.id)}
            ${column.sub ? `<small>${escapeHtml(column.sub)}</small>` : ''}</button>`).join('')
        : '<div class="wg-picker-empty">追加できるカラムはありません</div>';
    }

    function getFontSize(id) {
      const size = Number(intents.getFontSize?.(id));
      return Number.isFinite(size) && size > 0 ? size : DEFAULT_FONT_SIZE;
    }

    function renderFontSize() {
      const label = byId('wg-font-size');
      if (label) label.textContent = activeId ? `${getFontSize(activeId)}px` : '-';
    }

    // 選択中のタブのカラムだけを表に出す
    function syncColumns() {
      const columns = Array.from(byId('cols')?.querySelectorAll?.('.col') || []);
      const hasActive = columns.some(column => column.id === `col-${activeId}`);
      columns.forEach((column, index) => {
        const active = hasActive ? column.id === `col-${activeId}` : index === 0;
        column.classList.toggle('wg-active', active);
      });
      observeBadges();
    }

    // カラムの新着バッジ（+N）をタブの件数に写す
    function observeBadges() {
      tabIds.forEach(id => {
        const badge = byId(`badge-${id}`);
        const current = badgeObservers.get(id);
        if (current?.badge === badge) return;
        current?.observer?.disconnect();
        if (!badge) {
          badgeObservers.delete(id);
          return;
        }
        const update = () => {
          const count = readBadgeCount(badge);
          if ((unreadCounts.get(id) || 0) === count) return;
          unreadCounts.set(id, count);
          renderTabs();
        };
        const observer = MutationObserverRef ? new MutationObserverRef(update) : null;
        observer?.observe(badge, { attributes: true, childList: true, characterData: true, subtree: true });
        badgeObservers.set(id, { badge, observer });
        update();
      });
    }

    function watchColumns() {
      const cols = byId('cols');
      if (!cols || !MutationObserverRef || columnsObserver) return;
      columnsObserver = new MutationObserverRef(() => syncColumns());
      columnsObserver.observe(cols, { childList: true });
    }

    async function init() {
      documentRef.body.classList.add('widget-mode');

      const style = documentRef.createElement('style');
      style.textContent = WIDGET_STYLES;
      documentRef.head.appendChild(style);

      const storedActive = columnRuntime.getWidgetColumnId();
      tabIds = columnRuntime.getWidgetTabIds
        ? columnRuntime.getWidgetTabIds()
        : [findColumn(readLayout(), storedActive)?.id || readLayout()[0]?.id].filter(Boolean);
      activeId = tabIds.includes(storedActive) ? storedActive : tabIds[0] || null;

      const bar = documentRef.createElement('div');
      bar.id = 'widget-bar';
      bar.innerHTML = `
        <div class="wg-tabs" id="wg-tabs"></div>
        <div class="wg-controls">
          <button class="wg-icon" id="wg-top-btn" title="常に手前に表示" data-action="widget-toggle-top">${ICONS.top}</button>
          <button class="wg-icon" id="wg-lock-btn" title="位置を固定" data-action="widget-toggle-lock">${ICONS.lock}</button>
          <button class="wg-icon" id="wg-menu-btn" title="ウィジェットの設定" data-action="widget-toggle-menu">${ICONS.more}</button>
          <button class="wg-icon" title="閉じる" data-action="widget-close">${ICONS.close}</button>
        </div>
        <div class="wg-popover" id="wg-menu" hidden>
          <div class="wg-menu-row">
            <span>透明度</span>
            <input type="range" min="30" max="100" value="100" title="不透明度" id="wg-opacity"
              data-input-action="widget-set-opacity">
          </div>
          <div class="wg-menu-row">
            <button class="wg-check" id="wg-bg-btn" data-action="widget-toggle-background-only">背景だけ透過する</button>
          </div>
          <div class="wg-menu-row">
            <span>文字サイズ</span>
            <div class="wg-stepper">
              <button title="小さく" data-action="widget-font-step" data-step="-1">A-</button>
              <span id="wg-font-size">-</span>
              <button title="大きく" data-action="widget-font-step" data-step="1">A+</button>
            </div>
          </div>
        </div>
        <div class="wg-popover wg-picker" id="wg-picker" hidden></div>
      `;
      documentRef.body.prepend(bar);
      renderTabs();
      renderFontSize();
      watchColumns();
      syncColumns();

      documentRef.addEventListener?.('pointerdown', event => {
        if (!event.target?.closest?.('#widget-bar')) closePopovers();
      });
      documentRef.addEventListener?.('keydown', event => {
        if (event.key === 'Escape') closePopovers();
      });

      if (widgetHost) {
        try {
          const state = await readHostState();
          backgroundOnly = state.backgroundOnly === true;
          const slider = byId('wg-opacity');
          if (slider && state.opacity) slider.value = Math.round(state.opacity * 100);
          applyBackgroundAlpha(state.opacity || 1);
          setButtonActive('wg-top-btn', state.alwaysOnTop === true);
          setButtonActive('wg-bg-btn', backgroundOnly);
          applyLocked(state.locked === true);
        } catch {}
      }
    }

    async function readHostState() {
      if (widgetHost.getState) return widgetHost.getState();
      const [opacity, alwaysOnTop] = await Promise.all([widgetHost.getOpacity(), widgetHost.getTop()]);
      return { opacity, alwaysOnTop, locked: false, backgroundOnly: false };
    }

    function setButtonActive(id, active) {
      byId(id)?.classList.toggle('active', active);
    }

    function applyLocked(locked) {
      documentRef.body.classList.toggle('widget-locked', locked);
      setButtonActive('wg-lock-btn', locked);
    }

    function applyBackgroundAlpha(opacity) {
      documentRef.body.classList.toggle('widget-bg-only', backgroundOnly);
      documentRef.body.style.setProperty('--wg-bg-alpha', `${Math.round(opacity * 100)}%`);
    }

    function setPopoverOpen(id, open) {
      const popover = byId(id);
      if (!popover) return;
      popover.hidden = !open;
    }

    function updateMenuState() {
      const anyOpen = ['wg-menu', 'wg-picker'].some(id => byId(id) && !byId(id).hidden);
      byId('widget-bar')?.classList?.toggle('wg-menu-open', anyOpen);
      setButtonActive('wg-menu-btn', byId('wg-menu') ? !byId('wg-menu').hidden : false);
    }

    function closePopovers() {
      setPopoverOpen('wg-menu', false);
      setPopoverOpen('wg-picker', false);
      updateMenuState();
    }

    function toggleMenu() {
      const open = byId('wg-menu')?.hidden !== false;
      closePopovers();
      if (open) {
        renderFontSize();
        setPopoverOpen('wg-menu', true);
      }
      updateMenuState();
    }

    function openPicker() {
      const open = byId('wg-picker')?.hidden !== false;
      closePopovers();
      if (open) {
        renderPicker();
        setPopoverOpen('wg-picker', true);
      }
      updateMenuState();
    }

    async function toggleTop() {
      if (!widgetHost) return;
      const next = await widgetHost.toggleTop();
      setButtonActive('wg-top-btn', next);
      toast(next ? '常に手前に表示します' : '常に手前に表示するのをやめました');
    }

    async function toggleLock() {
      if (!widgetHost?.toggleLock) return;
      const next = await widgetHost.toggleLock();
      applyLocked(next);
      toast(next ? '位置を固定しました' : '位置の固定を解除しました');
    }

    async function toggleBackgroundOnly() {
      if (!widgetHost?.setBackgroundOnly) return;
      backgroundOnly = await widgetHost.setBackgroundOnly(!backgroundOnly);
      const slider = byId('wg-opacity');
      applyBackgroundAlpha(Number(slider?.value ?? 100) / 100);
      setButtonActive('wg-bg-btn', backgroundOnly);
      toast(backgroundOnly ? '背景だけ透過します' : 'ウィンドウ全体を透過します');
    }

    function setOpacity(percent) {
      const opacity = Number(percent) / 100;
      applyBackgroundAlpha(opacity);
      widgetHost?.setOpacity(opacity);
    }

    function stepFontSize(step) {
      if (!activeId || !intents.setFontSize) return;
      const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, getFontSize(activeId) + Number(step)));
      intents.setFontSize(activeId, next);
      renderFontSize();
    }

    // 選択中のカラムを先頭までスクロールし、溜まった新着をクリアする
    function scrollActiveToTop() {
      const badge = byId(`badge-${activeId}`);
      if (readBadgeCount(badge) && badge.click) {
        badge.click();
        return;
      }
      byId(`col-${activeId}`)?.querySelector?.('.feed, [id^="feed-"]')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    }

    function selectTab(columnId) {
      if (!tabIds.includes(columnId)) return;
      if (columnId === activeId) {
        scrollActiveToTop();
        return;
      }
      activeId = columnId;
      columnRuntime.setWidgetColumnId(columnId);
      renderTabs();
      renderFontSize();
      syncColumns();
    }

    function persistTabs() {
      columnRuntime.setWidgetTabIds?.(tabIds);
      columnRuntime.setWidgetColumnId(activeId);
    }

    function addTab(columnId) {
      closePopovers();
      if (!columnId || tabIds.includes(columnId)) {
        selectTab(columnId);
        return;
      }
      tabIds = [...tabIds, columnId];
      activeId = columnId;
      persistTabs();
      renderTabs();
      renderFontSize();
      if (intents.mountColumn) {
        intents.mountColumn(columnId);
        syncColumns();
      } else {
        intents.reload?.();
      }
    }

    function closeTab(columnId) {
      if (tabIds.length <= 1 || !tabIds.includes(columnId)) return;
      tabIds = tabIds.filter(id => id !== columnId);
      if (activeId === columnId) activeId = tabIds[0];
      badgeObservers.get(columnId)?.observer?.disconnect();
      badgeObservers.delete(columnId);
      unreadCounts.delete(columnId);
      persistTabs();
      renderTabs();
      renderFontSize();
      intents.unmountColumn?.(columnId);
      syncColumns();
    }

    function close() {
      widgetHost?.close();
    }

    // 以前のカラム選択の入口。タブがあればそこへ移り、なければタブとして加える
    function selectColumn(columnId) {
      if (tabIds.length) {
        addTab(columnId);
        return;
      }
      columnRuntime.setWidgetColumnId(columnId);
      intents.reload?.();
    }

    return {
      addTab,
      close,
      closeTab,
      init,
      openPicker,
      selectColumn,
      selectTab,
      setOpacity,
      stepFontSize,
      syncColumns,
      toggleBackgroundOnly,
      toggleLock,
      toggleMenu,
      toggleTop,
    };
  }

  global.SocialDeckWidgetModeRuntime = { createWidgetModeRuntime };
})(window);
