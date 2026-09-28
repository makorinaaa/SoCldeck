(function (global) {
  const INTERACTIVE_SELECTOR = 'button,a,input,textarea,select,[contenteditable="true"],.feed,.post,.notif,.col-webview,[data-column-resize-handle]';

  // Owns drag state and DOM order only. The caller owns persistence and feedback.
  function createColumnReorderRuntime({
    container,
    documentRef = global.document,
    requestFrame = callback => global.requestAnimationFrame(callback),
    onReorder = () => {},
  } = {}) {
    let active = null;
    let hover = null;
    let attached = false;

    function setHover(column) {
      if (hover === column) return;
      hover?.classList.remove('drag-over');
      hover = column;
      hover?.classList.add('drag-over');
    }

    function finish() {
      if (active) {
        active.column.style.opacity = active.opacity;
        active.shields.forEach(shield => shield.remove());
      }
      active = null;
      setHover(null);
    }

    function findColumn(target) {
      const column = target?.closest?.('.col');
      return column?.parentElement === container ? column : null;
    }

    function start(event) {
      const head = event.target?.closest?.('[data-column-drag-handle]');
      const column = findColumn(head);
      if (!column || event.target.closest(INTERACTIVE_SELECTOR) || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      finish();
      const drag = { column, opacity: column.style.opacity, shields: [] };
      active = drag;
      // A drag can end before this frame runs; never dim a finished drag.
      requestFrame(() => {
        if (active === drag) column.style.opacity = '0.4';
      });
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', column.id);
      container.querySelectorAll('.col').forEach(item => {
        const shield = documentRef.createElement('div');
        shield.className = 'col-drag-shield';
        shield.style.cssText = 'position:absolute;inset:0;z-index:20;pointer-events:none;background:transparent';
        item.appendChild(shield);
        drag.shields.push(shield);
      });
    }

    function over(event) {
      if (!active) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const column = findColumn(event.target);
      setHover(column === active.column ? null : column);
    }

    function leave(event) {
      if (!container.contains(event.relatedTarget)) setHover(null);
    }

    function drop(event) {
      if (!active) return;
      event.preventDefault();
      const source = active.column;
      const target = findColumn(event.target);
      const columns = [...container.querySelectorAll('.col')];
      const sourceIndex = columns.indexOf(source);
      const targetIndex = columns.indexOf(target);
      finish();
      if (sourceIndex < 0 || targetIndex < 0 || source === target) return;
      if (sourceIndex < targetIndex) target.insertAdjacentElement('afterend', source);
      else container.insertBefore(source, target);
      onReorder();
    }

    const listeners = { dragstart: start, dragover: over, dragleave: leave, drop };
    function attach() {
      if (attached) return;
      attached = true;
      Object.entries(listeners).forEach(([type, handler]) => container.addEventListener(type, handler));
      documentRef.addEventListener('dragend', finish);
    }

    function dispose() {
      finish();
      if (!attached) return;
      attached = false;
      Object.entries(listeners).forEach(([type, handler]) => container.removeEventListener(type, handler));
      documentRef.removeEventListener('dragend', finish);
    }

    return { attach, dispose, isDragging: () => active !== null };
  }

  global.SocialDeckColumnReorderRuntime = { createColumnReorderRuntime };
})(window);
