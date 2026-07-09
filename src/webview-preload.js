// WebView用preloadスクリプト
// X画像クリック・返信ボタンのpostMessageをwebviewのipc-messageに変換してrendererへ送る
const { ipcRenderer } = require('electron');

function isXHost() {
  const host = location.hostname.replace(/^www\./, '');
  return host === 'x.com' || host === 'twitter.com';
}

const COMPACT_STYLE_ID = '__socialdeck_x_compact_style';
const COMPACT_STYLE = `
  :root {
    color-scheme: dark !important;
  }

  html,
  body {
    min-width: 0 !important;
    overflow-x: hidden !important;
    background: #000 !important;
  }

  [data-testid="sidebarColumn"],
  [data-testid="DMDrawer"],
  [aria-label="Trending"],
  [aria-label="Who to follow"],
  [aria-label="Relevant people"],
  [data-testid="primaryColumn"] ~ div,
  div[data-testid="cellInnerDiv"]:has([data-testid="promotedIndicator"]),
  header[role="banner"] nav,
  aside,
  div[aria-label="Timeline: Trending now"],
  div[aria-label="Timeline: Explore"] [data-testid="sidebarColumn"] {
    display: none !important;
  }

  main,
  [role="main"],
  [data-testid="primaryColumn"] {
    width: 100% !important;
    max-width: none !important;
    min-width: 0 !important;
    margin: 0 !important;
    border-left: 0 !important;
    border-right: 0 !important;
  }

  [data-testid="primaryColumn"] > div,
  [aria-label^="Timeline:"] {
    max-width: none !important;
  }

  article[data-testid="tweet"] {
    max-width: none !important;
  }

  [data-testid="tweetText"] {
    font-size: 14px !important;
    line-height: 1.45 !important;
  }

  [data-testid="tweetPhoto"] img {
    object-fit: cover !important;
  }

  [data-testid$="-newTweetsButton"] {
    opacity: 0 !important;
    pointer-events: none !important;
    height: 0 !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }

  * {
    scrollbar-width: thin !important;
    scrollbar-color: rgba(255,255,255,.22) transparent !important;
  }

  *::-webkit-scrollbar {
    width: 4px !important;
    height: 4px !important;
  }

  *::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,.22) !important;
    border-radius: 4px !important;
  }

  *::-webkit-scrollbar-track {
    background: transparent !important;
  }

  @media (max-width: 520px) {
    [data-testid="tweetText"] {
      font-size: 13px !important;
    }

    article[data-testid="tweet"] [role="group"] {
      justify-content: space-between !important;
    }
  }
`;

function injectCompactStyle() {
  if (!document.head || document.getElementById(COMPACT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = COMPACT_STYLE_ID;
  style.textContent = COMPACT_STYLE;
  document.head.appendChild(style);
}

function clickNewPostsBanner() {
  const banner = document.querySelector('[data-testid$="-newTweetsButton"]');
  if (!banner) return;
  const scroller = document.scrollingElement || document.documentElement;
  const keepAtTop = scroller.scrollTop < 80;
  banner.click();
  if (keepAtTop) {
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'auto' }), 100);
  }
}

function hidePromotedCells() {
  document.querySelectorAll('[data-testid="placementTracking"]').forEach(node => {
    const cell = node.closest('[data-testid="cellInnerDiv"]');
    const tweet = node.closest('[data-testid="tweet"]');
    if (cell && !tweet) cell.style.display = 'none';
  });
}

function keepVisibleToX() {
  try {
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', {
      get: () => false,
      configurable: true,
    });
  } catch {}
}

function installCompactMode() {
  injectCompactStyle();
  keepVisibleToX();
  hidePromotedCells();
  clickNewPostsBanner();

  if (window.__socialdeckCompactObserver) return;
  let timer = null;
  window.__socialdeckCompactObserver = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      injectCompactStyle();
      hidePromotedCells();
      clickNewPostsBanner();
    }, 150);
  });
  window.__socialdeckCompactObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (isXHost()) installCompactMode();
  }, { once: true });
} else if (isXHost()) {
  installCompactMode();
}

window.addEventListener('message', e => {
  try {
    const data = JSON.parse(e.data);
    if (data._sdType === 'x-img-open') {
      ipcRenderer.sendToHost('x-img-open', JSON.stringify({ urls: data.urls, idx: data.idx }));
    }
    if (data._sdType === 'x-reply') {
      ipcRenderer.sendToHost('x-reply', JSON.stringify(data));
    }
  } catch {}
});
