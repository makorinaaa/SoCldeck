(function (global) {
  const ACTION_SPECS = {
    refresh: {
      title: '更新',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    },
    collapse: {
      title: '折りたたむ',
      className: 'col-collapse-btn',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>',
    },
    back: {
      title: '戻る',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
    },
    settings: {
      title: '自動更新設定',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>',
    },
    remove: {
      title: '削除',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    },
  };
  const COLLAPSED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>';
  const REFRESH_LABELS = {
    refreshing: '更新中',
    deferred: '保留',
    failed: '失敗',
    paused: '停止中',
    disabled: 'OFF',
  };

  function append(parent, child) {
    parent.appendChild(child);
    return child;
  }

  function createElement(documentRef, tagName, { className = '', id = '', text = '' } = {}) {
    const element = documentRef.createElement(tagName);
    element.className = className;
    element.id = id;
    element.textContent = text;
    return element;
  }

  function normalizeAction(action) {
    return typeof action === 'string' ? { type: action } : action;
  }

  function createColumnShellRuntime({
    documentRef = global.document,
    container,
    getInsertionPoint = () => container?.querySelector?.('.add-col-btn') || null,
    onCollapseChange = () => {},
    onWidthChange = () => {},
    onIntent = () => {},
  } = {}) {
    if (!documentRef?.createElement || !container?.insertBefore) {
      throw new Error('Column Shell Runtime requires a document and container');
    }

    const columns = new Map();

    function dispatchIntent(intent) {
      try {
        const result = onIntent(intent);
        result?.catch?.(error => global.console?.error?.('Column shell intent failed:', error));
      } catch (error) {
        global.console?.error?.('Column shell intent failed:', error);
      }
    }

    const clickListener = event => {
      const target = event.target?.closest?.('[data-shell-action]');
      if (!target || target.disabled) return;
      const id = target.dataset.columnId;
      const record = columns.get(id);
      if (!record) return;
      const type = target.dataset.shellAction;
      if (type === 'collapse') {
        setCollapsed(id, !record.collapsed, { notify: true });
        return;
      }
      if (type === 'scroll-top' && record.collapsed) {
        setCollapsed(id, false, { notify: true });
        return;
      }
      dispatchIntent({
        type,
        id,
        kind: record.kind,
        columnType: target.dataset.columnType || '',
        target,
      });
    };
    const dblclickListener = event => {
      const target = event.target?.closest?.('[data-shell-dblclick-action]');
      if (!target || target.dataset.shellDblclickAction !== 'expand') return;
      const id = target.dataset.columnId;
      if (columns.get(id)?.collapsed) setCollapsed(id, false, { notify: true });
    };
    container.addEventListener?.('click', clickListener);
    container.addEventListener?.('dblclick', dblclickListener);

    function mount(config) {
      if (!config?.id) throw new Error('Column shell id is required');
      if (columns.has(config.id)) throw new Error(`Column shell already mounted: ${config.id}`);

      const root = createElement(documentRef, 'div', { className: 'col', id: `col-${config.id}` });
      if (config.kind) root.dataset.kind = config.kind;
      if (config.network) root.dataset.network = config.network;
      if (config.definitionId) root.dataset.definitionId = config.definitionId;
      Object.entries(config.metadata || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') root.dataset[key] = String(value);
      });

      const head = append(root, createElement(documentRef, 'div', { className: 'col-head' }));
      head.draggable = true;
      head.style.cursor = 'grab';
      head.dataset.columnDragHandle = 'true';
      if (config.icon !== undefined) {
        const icon = append(head, createElement(documentRef, 'div', {
          className: `col-ic ${config.iconClass || ''}`.trim(),
        }));
        icon.innerHTML = config.icon;
      }

      const info = append(head, createElement(documentRef, 'div', { className: 'col-info' }));
      if (config.interactiveHeader !== false) {
        info.style.cursor = 'pointer';
        info.title = '先頭へスクロール / ダブルクリックで展開';
        info.draggable = false;
        info.dataset.shellAction = 'scroll-top';
        info.dataset.shellDblclickAction = 'expand';
        info.dataset.columnKind = config.kind || '';
        info.dataset.columnId = config.id;
      }
      const title = append(info, createElement(documentRef, 'div', {
        className: 'col-title',
        text: config.title || '',
      }));
      const subtitle = append(info, createElement(documentRef, 'div', { className: 'col-sub' }));
      const indicator = append(subtitle, createElement(documentRef, 'div', { className: 'ldot' }));
      if (config.indicatorColor) indicator.style.background = config.indicatorColor;
      const subtitleText = append(subtitle, createElement(documentRef, 'span', {
        id: config.subtitleId || '',
        text: config.subtitle || '',
      }));

      const actions = append(head, createElement(documentRef, 'div', { className: 'col-actions' }));
      let badge = null;
      if (config.badge) {
        badge = append(actions, createElement(documentRef, 'span', {
          className: 'cbadge',
          id: `badge-${config.id}`,
        }));
        badge.style.display = 'none';
      }
      const refreshState = append(actions, createElement(documentRef, 'span', {
        className: 'col-refresh-state',
        id: `refresh-state-${config.id}`,
      }));
      const actionButtons = new Map();
      (config.actions || []).map(normalizeAction).forEach(action => {
        const spec = ACTION_SPECS[action.type];
        if (!spec) throw new Error(`Unsupported Column shell action: ${action.type}`);
        const button = append(actions, createElement(documentRef, 'button', {
          className: `cbtn ${spec.className || ''}`.trim(),
          id: action.type === 'refresh' ? `rfr-${config.id}` : '',
        }));
        button.type = 'button';
        button.title = spec.title;
        button.dataset.shellAction = action.type;
        button.dataset.columnId = config.id;
        if (action.type === 'settings') button.dataset.columnType = action.columnType || config.kind || '';
        button.innerHTML = spec.icon;
        actionButtons.set(action.type, button);
      });

      const hosts = {};
      (config.hosts || []).forEach(hostConfig => {
        const host = append(root, createElement(documentRef, hostConfig.tagName || 'div', {
          className: hostConfig.className || '',
          id: hostConfig.id || '',
        }));
        Object.assign(host.style, hostConfig.style || {});
        if (hostConfig.loadingText) {
          const loading = append(host, createElement(documentRef, 'div', { className: 'feed-loading' }));
          append(loading, createElement(documentRef, 'div', { className: 'spinner' }));
          append(loading, createElement(documentRef, 'span', { text: hostConfig.loadingText }));
        }
        hosts[hostConfig.name] = host;
      });

      const resizeHandle = append(root, createElement(documentRef, 'div', { className: 'col-resize' }));
      resizeHandle.title = 'ドラッグで幅を変更';
      resizeHandle.dataset.columnResizeHandle = 'true';
      let resizeMove = null;
      let resizeUp = null;
      const resizeMouseDown = event => {
        event.preventDefault?.();
        const startX = event.clientX;
        const startWidth = root.offsetWidth;
        resizeMove = moveEvent => {
          const width = Math.max(260, Math.min(600, startWidth + moveEvent.clientX - startX));
          root.style.width = `${width}px`;
          root.style.minWidth = `${width}px`;
        };
        resizeUp = () => {
          documentRef.removeEventListener?.('mousemove', resizeMove);
          documentRef.removeEventListener?.('mouseup', resizeUp);
          resizeMove = null;
          resizeUp = null;
          onWidthChange(config.id, root.style.width || '');
        };
        documentRef.addEventListener?.('mousemove', resizeMove);
        documentRef.addEventListener?.('mouseup', resizeUp);
      };
      resizeHandle.addEventListener?.('mousedown', resizeMouseDown);

      const record = {
        id: config.id,
        kind: config.kind || '',
        root,
        hosts,
        title,
        subtitleText,
        badge,
        refreshState,
        info,
        actionButtons,
        resizeHandle,
        resizeMouseDown,
        get resizeMove() { return resizeMove; },
        get resizeUp() { return resizeUp; },
        collapsed: false,
        collapsedClick: null,
      };
      record.collapsedClick = event => {
        if (!record.collapsed || event.target?.closest?.('[data-shell-action], [data-shell-dblclick-action], button')) return;
        setCollapsed(config.id, false, { notify: true });
      };
      root.addEventListener?.('click', record.collapsedClick);
      columns.set(config.id, record);
      container.insertBefore(root, config.before || getInsertionPoint());
      return { root, hosts, badge, refreshState };
    }

    function update(id, changes = {}) {
      const record = columns.get(id);
      if (!record) return false;
      if (changes.title !== undefined) record.title.textContent = changes.title;
      if (changes.subtitle !== undefined) record.subtitleText.textContent = changes.subtitle;
      if (changes.badge !== undefined && record.badge) {
        record.badge.textContent = changes.badge.text || '';
        record.badge.style.display = changes.badge.visible ? '' : 'none';
      }
      return true;
    }

    function setRefreshState(id, state = {}) {
      const element = columns.get(id)?.refreshState;
      if (!element) return false;
      element.className = `col-refresh-state ${state.status || ''}`.trim();
      if (state.status === 'succeeded' && state.lastUpdatedAt) {
        const updatedAt = new Date(state.lastUpdatedAt);
        element.textContent = updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        element.title = `最終更新: ${updatedAt.toLocaleString()}`;
        return true;
      }
      element.textContent = REFRESH_LABELS[state.status] || '';
      element.title = state.status === 'failed'
        ? `更新失敗: ${state.error?.message || 'Unknown error'}`
        : state.status === 'deferred'
          ? '閲覧中または準備中のため更新を延期しました'
          : state.status === 'paused'
            ? 'バックグラウンドのため自動更新を停止中です'
            : state.status === 'disabled'
              ? '自動更新はOFFです'
              : '';
      return true;
    }

    function setCollapsed(id, collapsed, { notify = false } = {}) {
      const record = columns.get(id);
      if (!record) return false;
      const next = Boolean(collapsed);
      if (record.collapsed === next) return true;
      const collapseButton = record.actionButtons.get('collapse');
      record.collapsed = next;
      if (next) {
        record.root.dataset.savedWidth = record.root.style.width || '';
        record.root.style.width = '42px';
        record.root.style.minWidth = '42px';
        Object.values(record.hosts).forEach(host => { host.style.display = 'none'; });
        record.title.style.writingMode = 'vertical-rl';
        record.title.style.maxWidth = '20px';
        record.actionButtons.forEach((button, type) => {
          if (type !== 'collapse') button.style.display = 'none';
        });
        if (collapseButton) {
          collapseButton.innerHTML = COLLAPSED_ICON;
          collapseButton.title = '展開する';
        }
        record.root.style.cursor = 'pointer';
        record.resizeHandle.style.display = 'none';
      } else {
        const width = record.root.dataset.savedWidth || '';
        record.root.style.width = width;
        record.root.style.minWidth = width;
        Object.values(record.hosts).forEach(host => { host.style.display = ''; });
        record.title.style.writingMode = '';
        record.title.style.maxWidth = '';
        record.actionButtons.forEach((button, type) => {
          if (type !== 'collapse') button.style.display = '';
        });
        if (collapseButton) {
          collapseButton.innerHTML = ACTION_SPECS.collapse.icon;
          collapseButton.title = ACTION_SPECS.collapse.title;
        }
        record.info.style.setProperty?.('flex', '');
        record.root.style.cursor = '';
        record.resizeHandle.style.display = '';
      }
      if (notify) onCollapseChange(id, next);
      return true;
    }

    function toggleCollapsed(id) {
      const record = columns.get(id);
      if (!record) return false;
      setCollapsed(id, !record.collapsed, { notify: true });
      return record.collapsed;
    }

    function applyWidth(id, width) {
      const record = columns.get(id);
      if (!record) return false;
      if (record.collapsed) record.root.dataset.savedWidth = width;
      else {
        record.root.style.width = width;
        record.root.style.minWidth = width;
      }
      return true;
    }

    function remove(id) {
      const record = columns.get(id);
      if (!record) return false;
      documentRef.removeEventListener?.('mousemove', record.resizeMove);
      documentRef.removeEventListener?.('mouseup', record.resizeUp);
      record.resizeHandle.removeEventListener?.('mousedown', record.resizeMouseDown);
      record.root.removeEventListener?.('click', record.collapsedClick);
      record.root.remove();
      columns.delete(id);
      return true;
    }

    function dispose() {
      [...columns.keys()].forEach(remove);
      container.removeEventListener?.('click', clickListener);
      container.removeEventListener?.('dblclick', dblclickListener);
    }

    return {
      mount,
      update,
      setRefreshState,
      setCollapsed,
      toggleCollapsed,
      isCollapsed: id => columns.get(id)?.collapsed === true,
      applyWidth,
      remove,
      listIds: () => [...columns.keys()],
      getRoot: id => columns.get(id)?.root || null,
      getHost: (id, name) => columns.get(id)?.hosts[name] || null,
      dispose,
    };
  }

  global.SocialDeckColumnShellRuntime = { createColumnShellRuntime };
})(window);
