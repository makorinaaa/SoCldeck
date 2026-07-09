(function (global) {
  function createFileDragShield({
    documentRef = global.document,
    getIsColumnDragging = () => false,
    allowedDropSelectors = ['#x-img-drop', '#b-img-drop'],
  } = {}) {
    let active = false;
    let enterCount = 0;

    function hasFiles(event) {
      return [...(event.dataTransfer?.types || [])].includes('Files');
    }

    function isAllowedTarget(target) {
      return allowedDropSelectors.some(selector => target.closest(selector));
    }

    function add() {
      if (active) return;
      active = true;
      documentRef.querySelectorAll('.col').forEach(col => {
        if (col.querySelector('.file-drag-shield')) return;
        const shield = documentRef.createElement('div');
        shield.className = 'file-drag-shield';
        shield.style.cssText = 'position:absolute;inset:-2px;z-index:30;pointer-events:all;background:var(--bg1, #0d0d0d);opacity:0.01;cursor:default';
        col.style.position = 'relative';
        col.appendChild(shield);
      });
    }

    function remove() {
      active = false;
      enterCount = 0;
      documentRef.querySelectorAll('.file-drag-shield').forEach(shield => shield.remove());
    }

    function onDragEnter(event) {
      if (getIsColumnDragging() || !hasFiles(event)) return;
      enterCount++;
      if (enterCount === 1) add();
    }

    function onDragLeave(event) {
      if (getIsColumnDragging() || !hasFiles(event)) return;
      enterCount = Math.max(0, enterCount - 1);
      if (enterCount === 0) remove();
    }

    function onDragOver(event) {
      if (getIsColumnDragging() || !hasFiles(event)) return;
      event.preventDefault();
      if (!isAllowedTarget(event.target)) {
        event.dataTransfer.dropEffect = 'none';
      }
    }

    function onDrop(event) {
      if (hasFiles(event) && !isAllowedTarget(event.target)) {
        event.preventDefault();
      }
      remove();
    }

    function attach() {
      documentRef.addEventListener('dragenter', onDragEnter);
      documentRef.addEventListener('dragleave', onDragLeave);
      documentRef.addEventListener('dragover', onDragOver);
      documentRef.addEventListener('drop', onDrop);
      documentRef.addEventListener('dragend', remove);
    }

    return {
      attach,
      add,
      remove,
    };
  }

  global.SocialDeckFileDragShield = {
    createFileDragShield,
  };
})(window);
