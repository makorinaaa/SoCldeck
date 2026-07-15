const X_HOSTS = new Set(['x.com', 'twitter.com']);
const COMPACT_STYLE_ID = '__socialdeck_x_compact_style';
const COMPOSER_STYLE_ID = '__socialdeck_x_composer_style';

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
  [data-testid="WhoToFollow"],
  [data-testid="UserRecommendations"],
  [aria-label="Trending"],
  [aria-label="Who to follow"],
  [aria-label="Relevant people"],
  [data-testid="primaryColumn"] ~ div,
  div[data-testid="cellInnerDiv"]:has([data-testid="promotedIndicator"]),
  header[role="banner"],
  aside,
  .r-1mhb1uw,
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

const HOME_COMPOSER_STYLE = `
  [data-testid="tweetButtonInline"],
  [data-testid="tweetTextarea_0"],
  [data-testid="tweetTextarea_0_label"],
  [data-testid="toolBar"],
  [data-testid="tweetTextarea_0RichTextInputContainer"],
  div:has(> [data-testid="tweetTextarea_0"]) {
    display: none !important;
  }
`;

const VIDEO_CONTEXT_SELECTORS = [
  'video',
  '[data-testid="videoPlayer"]',
  '[data-testid="gifPlayer"]',
  '[data-testid="playButton"]',
  '[data-testid="videoComponent"]',
];
const VIDEO_URL_MARKERS = [
  'amplify_video_thumb',
  'ext_tw_video_thumb',
  'tweet_video_thumb',
];
const NEW_POSTS_TEXT = /(?:\u65b0\u3057\u3044\u30dd\u30b9\u30c8|\u65b0\u3057\u3044\u30c4\u30a4\u30fc\u30c8|Show\s+\d+\s+posts?)/i;

function isXHostname(hostname) {
  const normalized = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
  return X_HOSTS.has(normalized);
}

function isXHost(locationLike) {
  const hostname = typeof locationLike === 'string'
    ? locationLike
    : locationLike?.hostname;
  return isXHostname(hostname);
}

function queryFirst(node, selectors) {
  if (!node || typeof node.querySelector !== 'function') return null;
  for (const selector of selectors) {
    const match = node.querySelector(selector);
    if (match) return match;
  }
  return null;
}

function closestFirst(node, selectors) {
  if (!node || typeof node.closest !== 'function') return null;
  for (const selector of selectors) {
    const match = node.closest(selector);
    if (match) return match;
  }
  return null;
}

function imageSource(photo) {
  const image = queryFirst(photo, ['img']);
  return image?.currentSrc || image?.src || '';
}

function isVideoPhoto(photo) {
  if (!photo) return false;
  if (queryFirst(photo, ['video', '[data-testid="gifPlayer"]'])) return true;
  if (closestFirst(photo, [
    '[data-testid="videoPlayer"]',
    '[data-testid="gifPlayer"]',
    '[data-testid="videoComponent"]',
  ])) return true;
  if (queryFirst(photo.parentElement, ['[data-testid="playButton"]'])) return true;

  const image = queryFirst(photo, ['img']);
  const alt = String(image?.getAttribute?.('alt') || '');
  const src = String(image?.currentSrc || image?.src || '').toLowerCase();
  if (/(?:video|gif|\u52d5\u753b)/i.test(alt)) return true;
  if (VIDEO_URL_MARKERS.some(marker => src.includes(marker))) return true;

  let container = photo;
  for (let depth = 0; depth < 3 && container; depth += 1) {
    container = container.parentElement;
  }
  return Boolean(queryFirst(container, [
    'video',
    '[data-testid="videoPlayer"]',
    '[data-testid="gifPlayer"]',
    '[data-testid="playButton"]',
  ]));
}

function normalizeXImageUrl(source) {
  try {
    const url = new URL(String(source || ''));
    if (url.hostname.toLowerCase() !== 'pbs.twimg.com') return null;
    if (!url.pathname.startsWith('/media/')) return null;
    url.hash = '';
    url.searchParams.set('name', 'large');
    return url.toString();
  } catch {
    return null;
  }
}

function imageUrlKey(source) {
  try {
    const url = new URL(String(source || ''));
    url.hash = '';
    url.searchParams.delete('name');
    return url.toString();
  } catch {
    return String(source || '').split('&name=')[0];
  }
}

function collectXImageUrls(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return [];
  return Array.from(container.querySelectorAll('[data-testid="tweetPhoto"]'))
    .filter(photo => !isVideoPhoto(photo))
    .map(photo => normalizeXImageUrl(imageSource(photo)))
    .filter(Boolean);
}

function createImageOpenPayload(clickedPhoto, fallbackContainer) {
  if (!clickedPhoto || isVideoPhoto(clickedPhoto)) return null;
  const tweet = typeof clickedPhoto.closest === 'function'
    ? clickedPhoto.closest('[data-testid="tweet"]')
    : null;
  const urls = collectXImageUrls(tweet || fallbackContainer);
  if (!urls.length) return null;

  const clickedKey = imageUrlKey(imageSource(clickedPhoto));
  const matchedIndex = urls.findIndex(url => imageUrlKey(url) === clickedKey);
  return { urls, idx: matchedIndex < 0 ? 0 : matchedIndex };
}

function isVideoClickTarget(target) {
  return Boolean(closestFirst(target, VIDEO_CONTEXT_SELECTORS.slice(1)));
}

function findNewPostsBanner(documentLike) {
  if (!documentLike || typeof documentLike.querySelector !== 'function') return null;
  const banner = documentLike.querySelector('[data-testid$="-newTweetsButton"]');
  if (banner) return banner;
  if (typeof documentLike.querySelectorAll !== 'function') return null;
  return Array.from(documentLike.querySelectorAll('[role="button"]'))
    .find(button => NEW_POSTS_TEXT.test(String(button.textContent || ''))) || null;
}

function isReplyDialogOpen(documentLike) {
  return Boolean(documentLike?.querySelector?.('[data-testid="tweetButton"]'));
}

function shouldHideHomeComposer(documentLike) {
  return !isReplyDialogOpen(documentLike);
}

function ensureStyle(documentLike, id, textContent) {
  if (!documentLike?.head) return null;
  let style = documentLike.getElementById(id);
  if (!style) {
    style = documentLike.createElement('style');
    style.id = id;
    documentLike.head.appendChild(style);
  }
  if (style.textContent !== textContent) style.textContent = textContent;
  return style;
}

function injectCompactStyle(documentLike) {
  ensureStyle(documentLike, COMPACT_STYLE_ID, COMPACT_STYLE);
}

function updateComposerVisibility(documentLike) {
  const style = shouldHideHomeComposer(documentLike) ? HOME_COMPOSER_STYLE : '';
  ensureStyle(documentLike, COMPOSER_STYLE_ID, style);
}

function clickNewPostsBanner(documentLike, windowLike) {
  const banner = findNewPostsBanner(documentLike);
  if (!banner) return false;
  const scroller = documentLike.scrollingElement || documentLike.documentElement;
  const keepAtTop = !scroller || scroller.scrollTop < 80;
  banner.click();
  if (keepAtTop && typeof windowLike?.setTimeout === 'function') {
    windowLike.setTimeout(() => {
      if (typeof windowLike.scrollTo === 'function') {
        windowLike.scrollTo({ top: 0, behavior: 'auto' });
      } else if (scroller) {
        scroller.scrollTop = 0;
      }
    }, 100);
  }
  return true;
}

function hidePromotedCells(documentLike) {
  if (typeof documentLike?.querySelectorAll !== 'function') return;
  documentLike.querySelectorAll('[data-testid="placementTracking"]').forEach(node => {
    const cell = node.closest?.('[data-testid="cellInnerDiv"]');
    const tweet = node.closest?.('[data-testid="tweet"]');
    if (cell && !tweet) cell.style.display = 'none';
  });
}

function keepVisibleToX(documentLike, windowLike) {
  if (windowLike.__socialdeckVisibilityInstalled) return;
  windowLike.__socialdeckVisibilityInstalled = true;
  try {
    Object.defineProperty(documentLike, 'visibilityState', {
      get: () => 'visible',
      configurable: true,
    });
    Object.defineProperty(documentLike, 'hidden', {
      get: () => false,
      configurable: true,
    });
    documentLike.addEventListener('visibilitychange', event => {
      event.stopImmediatePropagation();
    }, true);
    windowLike.addEventListener('blur', event => {
      event.stopImmediatePropagation();
    }, true);
  } catch {}
}

function createImageClickHandler(documentLike, ipcRendererLike) {
  return event => {
    const target = event?.target;
    if (isVideoClickTarget(target)) return;
    const photo = target?.closest?.('[data-testid="tweetPhoto"]');
    if (!photo) return;

    const payload = createImageOpenPayload(photo, documentLike.body);
    if (!payload) return;

    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    ipcRendererLike.sendToHost('x-img-open', JSON.stringify(payload));
  };
}

function installImageClickInterception(documentLike, windowLike, ipcRendererLike) {
  if (windowLike.__socialdeckXImageClickHandler) return;
  const handler = createImageClickHandler(documentLike, ipcRendererLike);
  windowLike.__socialdeckXImageClickHandler = handler;
  documentLike.addEventListener('click', handler, true);
}

function installMessageBridge(windowLike, ipcRendererLike) {
  if (windowLike.__socialdeckXMessageBridge) return;
  windowLike.__socialdeckXMessageBridge = true;
  windowLike.addEventListener('message', event => {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data?._sdType === 'x-reply') {
        ipcRendererLike.sendToHost('x-reply', JSON.stringify(data));
      }
    } catch {}
  });
}

function runDomMaintenance(documentLike, windowLike) {
  injectCompactStyle(documentLike);
  updateComposerVisibility(documentLike);
  hidePromotedCells(documentLike);
  clickNewPostsBanner(documentLike, windowLike);
}

function installMutationMaintenance(documentLike, windowLike) {
  if (windowLike.__socialdeckCompactObserver) return;
  const MutationObserverLike = windowLike.MutationObserver;
  const target = documentLike.documentElement || documentLike.body;
  if (typeof MutationObserverLike !== 'function' || !target) return;

  let timer = null;
  const observer = new MutationObserverLike(() => {
    if (timer !== null) windowLike.clearTimeout(timer);
    timer = windowLike.setTimeout(() => {
      timer = null;
      runDomMaintenance(documentLike, windowLike);
    }, 100);
  });
  observer.observe(target, { childList: true, subtree: true });
  windowLike.__socialdeckCompactObserver = observer;
}

function installXBehavior(documentLike, windowLike, ipcRendererLike) {
  runDomMaintenance(documentLike, windowLike);
  keepVisibleToX(documentLike, windowLike);
  installImageClickInterception(documentLike, windowLike, ipcRendererLike);
  installMessageBridge(windowLike, ipcRendererLike);
  installMutationMaintenance(documentLike, windowLike);
}

function bootstrap(options = {}) {
  const windowLike = options.windowLike
    || (typeof window !== 'undefined' ? window : null);
  const documentLike = options.documentLike
    || (typeof document !== 'undefined' ? document : null);
  const locationLike = options.locationLike
    || (typeof location !== 'undefined' ? location : null);
  const ipcRendererLike = options.ipcRendererLike || null;

  if (!windowLike || !documentLike || !isXHost(locationLike)) return false;
  if (typeof ipcRendererLike?.sendToHost !== 'function') return false;
  if (typeof windowLike.addEventListener !== 'function') return false;
  if (typeof windowLike.setTimeout !== 'function') return false;
  if (typeof windowLike.clearTimeout !== 'function') return false;
  if (typeof documentLike.addEventListener !== 'function') return false;
  if (typeof documentLike.querySelector !== 'function') return false;
  if (typeof documentLike.querySelectorAll !== 'function') return false;

  const install = () => {
    if (isXHost(locationLike)) {
      installXBehavior(documentLike, windowLike, ipcRendererLike);
    }
  };

  if (documentLike.readyState === 'loading') {
    documentLike.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
  return true;
}

let electronIpcRenderer = null;
try {
  ({ ipcRenderer: electronIpcRenderer } = require('electron'));
} catch {}

bootstrap({ ipcRendererLike: electronIpcRenderer });

module.exports = {
  bootstrap,
  collectXImageUrls,
  createImageClickHandler,
  createImageOpenPayload,
  findNewPostsBanner,
  imageUrlKey,
  isReplyDialogOpen,
  isVideoClickTarget,
  isVideoPhoto,
  isXHost,
  isXHostname,
  normalizeXImageUrl,
  shouldHideHomeComposer,
};
