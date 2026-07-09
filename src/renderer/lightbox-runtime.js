(function (global) {
  function createLightboxRuntime({ documentRef = global.document } = {}) {
    let images = [];
    let index = 0;

    function show() {
      const lb = documentRef.getElementById('lightbox');
      const img = documentRef.getElementById('lightbox-img');
      const counter = documentRef.getElementById('lightbox-counter');
      const prev = documentRef.getElementById('lightbox-prev');
      const next = documentRef.getElementById('lightbox-next');
      if (!lb || !img) return;

      img.src = images[index];
      lb.classList.add('on');
      if (counter) counter.textContent = images.length > 1 ? `${index + 1} / ${images.length}` : '';
      if (prev) prev.style.display = images.length > 1 ? 'flex' : 'none';
      if (next) next.style.display = images.length > 1 ? 'flex' : 'none';
    }

    function open(urls, startIndex = 0) {
      images = Array.isArray(urls) ? urls : [urls];
      index = Math.max(0, Math.min(startIndex, images.length - 1));
      show();
    }

    function move(dir) {
      if (!images.length) return;
      index = (index + dir + images.length) % images.length;
      show();
    }

    function close(event) {
      if (event?.target && (event.target.id === 'lightbox-prev' || event.target.id === 'lightbox-next')) return;
      documentRef.getElementById('lightbox')?.classList.remove('on');
      const img = documentRef.getElementById('lightbox-img');
      if (img) img.src = '';
      images = [];
      index = 0;
    }

    return {
      open,
      move,
      close,
    };
  }

  global.SocialDeckLightboxRuntime = {
    createLightboxRuntime,
  };
})(window);
