// カラムの種類ごとの見た目（ヘッダーのボタン、中身の器）と、中身を動かす runtime への接続。
// どの種類のカラムを作るかは network-adapters.js のプランが決める。
const UNAVAILABLE_HTML = '<div class="feed-empty">このカラムはデスクトップ版でのみ使えます</div>';
const X_INDICATOR = '#e7e9ea';

function settingsAction(columnType) {
  return { type: 'settings', columnType };
}

function feedHost(id, className, loadingText) {
  return { name: 'content', id: `feed-${id}`, className, loadingText };
}

function createColumnMounts({
  documentRef,
  shell,
  xWebView,
  bluesky,
  animeSchedule,
  xNative = null,
  setRefreshInterval,
  getFontSize = () => null,
  getPreloadPath = () => '',
  intervals,
}) {
  function mountShell(config, view) {
    return shell.mount({
      id: config.id,
      network: config.network,
      definitionId: config.definitionId,
      title: config.title,
      subtitle: config.sub,
      iconClass: config.icCls,
      icon: config.icon,
      ...view,
    });
  }

  function restoreFontSize(id, host) {
    const size = getFontSize(id);
    if (size) host.style.fontSize = `${size}px`;
  }

  // X / Bluesky のページをそのまま表示する WebView カラム
  function mountWebView(config, partition) {
    const { hosts } = mountShell(config, {
      kind: 'x',
      indicatorColor: X_INDICATOR,
      actions: ['collapse', 'back', 'refresh', settingsAction('wv'), 'remove'],
      hosts: [{ name: 'content', className: 'col-webview', style: { position: 'relative' } }],
    });
    const loading = documentRef.createElement('div');
    loading.className = 'webview-loading';
    loading.id = `wvload-${config.id}`;
    loading.innerHTML = '<div class="spinner"></div>読み込み中…';
    const overlay = documentRef.createElement('div');
    overlay.id = `wvov-${config.id}`;
    Object.assign(overlay.style, {
      display: 'none',
      position: 'absolute',
      inset: '0',
      zIndex: '10',
      pointerEvents: 'none',
      opacity: '1',
      transition: 'opacity .4s ease',
    });
    hosts.content.appendChild(loading);
    hosts.content.appendChild(overlay);
    xWebView.mountColumn({
      id: config.id,
      networkId: config.network || 'x',
      partition,
      targetUrl: config.url,
      host: hosts.content,
      preloadPath: getPreloadPath(),
    });
  }

  function mountBluesky(config) {
    const id = config.id;
    const hasSearch = config.type === 'search';
    const { hosts, badge } = mountShell(config, {
      kind: 'bsky',
      metadata: { type: config.type || 'timeline', feeduri: config.feedUri || '' },
      badge: true,
      actions: ['refresh', 'collapse', settingsAction('bsky'), 'remove'],
      hosts: [
        ...(hasSearch ? [{ name: 'search', className: 'col-search-bar' }] : []),
        feedHost(id, 'feed', '読み込み中…'),
      ],
    });

    let searchInput = null;
    let searchButton = null;
    if (hasSearch) {
      searchInput = documentRef.createElement('input');
      searchInput.type = 'text';
      searchInput.id = `sq-${id}`;
      searchInput.placeholder = 'Bluesky を検索…';
      searchButton = documentRef.createElement('button');
      searchButton.type = 'button';
      searchButton.id = `sq-btn-${id}`;
      searchButton.textContent = '検索';
      hosts.search.appendChild(searchInput);
      hosts.search.appendChild(searchButton);
    }

    bluesky.mount({
      id,
      type: config.type,
      feedUri: config.feedUri || null,
      host: hosts.content,
      badge,
      searchInput,
      searchButton,
    });
    if (hasSearch) {
      hosts.content.innerHTML = '<div class="feed-empty">検索キーワードを入力してください</div>';
    } else {
      bluesky.refresh(id, { mode: 'replace' }).catch(() => {});
      setRefreshInterval(id, intervals.standard);
    }
    restoreFontSize(id, hosts.content);
  }

  function mountAnimeSchedule(config) {
    const id = config.id;
    const { hosts } = mountShell(config, {
      kind: 'schedule',
      subtitleId: `anime-sub-${id}`,
      indicatorColor: '#ffd166',
      actions: ['refresh', 'collapse', settingsAction('schedule'), 'remove'],
      hosts: [feedHost(id, 'feed anime-schedule', '放送予定を取得中…')],
    });
    setRefreshInterval(id, intervals.animeSchedule);
    animeSchedule.load(id).catch(() => {});
    restoreFontSize(id, hosts.content);
  }

  // 非表示の X ページが取得したデータを SocialDeck の表示で描画するカラム。
  // ホームは非表示のホームページ、リストはそのリストのページ、通知は通知センターと共有する通知ページから読む。
  function mountXNative(config, partition) {
    const id = config.id;
    const notifications = config.definitionId === 'x-notif-native';
    const listId = /\/i\/lists\/(\d+)/.exec(config.url || '')?.[1] || null;
    const { hosts, badge } = mountShell(config, {
      kind: 'x-native',
      metadata: { partition, url: listId ? config.url : null },
      ...(notifications ? {} : { subtitleId: `xn-sub-${id}` }),
      indicatorColor: X_INDICATOR,
      badge: true,
      actions: ['refresh', 'collapse', settingsAction('x-native'), 'remove'],
      hosts: [notifications
        ? feedHost(id, 'feed x-native-feed x-native-notif-feed', 'X の通知を読み込み中…')
        : feedHost(id, 'feed x-native-feed', 'X のタイムラインを読み込み中…')],
    });
    if (!xNative) {
      hosts.content.innerHTML = UNAVAILABLE_HTML;
    } else if (notifications) {
      xNative.mountNotifications({ id, partition, host: hosts.content, badge });
    } else {
      xNative.mount({
        id,
        partition,
        listId,
        host: hosts.content,
        subtitle: documentRef.getElementById(`xn-sub-${id}`),
        badge,
      });
    }
    setRefreshInterval(id, intervals.standard);
    restoreFontSize(id, hosts.content);
  }

  // Returns false for a plan this app cannot show.
  function insertPlan(plan) {
    switch (plan?.kind) {
      case 'wv': mountWebView(plan.config, plan.partition); return true;
      case 'bsky': mountBluesky(plan.config); return true;
      case 'schedule': mountAnimeSchedule(plan.config); return true;
      case 'x-native': mountXNative(plan.config, plan.partition); return true;
      default: return false;
    }
  }

  // A saved Column that cannot be restored stays visible so the user can remove it.
  function mountRestoreError(column, error) {
    const { hosts } = shell.mount({
      id: column.id,
      title: column.title || 'カラムを復元できませんでした',
      subtitle: '保存済みの設定はそのまま残っています',
      interactiveHeader: false,
      actions: ['remove'],
      hosts: [{ name: 'content', className: 'feed-empty' }],
    });
    hosts.content.textContent = error.message || 'カラムの種類を判別できませんでした';
  }

  function applyFontSize(id, columnType, fontSize) {
    if (columnType === 'wv') {
      xWebView.setFontSize(id, fontSize);
      return;
    }
    const feed = documentRef.getElementById(`feed-${id}`);
    if (feed) feed.style.fontSize = `${fontSize}px`;
  }

  return { applyFontSize, insertPlan, mountRestoreError };
}

export { createColumnMounts };
