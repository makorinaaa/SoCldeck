(function (global) {
  function replyUrl(item) {
    if (item?.networkId !== 'x' || !['reply', 'mention', 'quote'].includes(item.reason)) return null;
    try {
      const url = new URL(item.targetUrl);
      if (url.protocol !== 'https:' || !['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname)) return null;
      const id = url.pathname.match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/)?.[1];
      return id ? `https://x.com/intent/tweet?in_reply_to=${id}` : null;
    } catch { return null; }
  }

  function createNotificationReplyRuntime({ documentRef = global.document, getAccounts, getPreloadPath } = {}) {
    const panel = documentRef.getElementById('notif-reply-panel');
    const host = documentRef.getElementById('notif-reply-host');
    const title = documentRef.getElementById('notif-reply-title');
    const status = documentRef.getElementById('notif-reply-status');
    const modal = documentRef.getElementById('notifCenterMod');
    let currentKey = null;
    let currentWebview = null;

    function back() {
      panel.hidden = true;
      modal.classList.remove('replying');
    }

    function open(item) {
      const url = replyUrl(item);
      const account = getAccounts().find(entry => (entry.partition || entry.username)
        === (item.account?.partition || item.account?.username));
      if (!url || !account || account.loginPending || !getPreloadPath()) return false;
      const key = `${account.partition}:${url}`;
      if (currentKey !== key) {
        const webview = documentRef.createElement('webview');
        webview.setAttribute('partition', account.partition);
        webview.setAttribute('preload', getPreloadPath());
        webview.setAttribute('webpreferences', 'backgroundThrottling=false');
        webview.setAttribute('aria-label', 'Xの返信画面');
        webview.src = url;
        status.textContent = '返信画面を読み込んでいます…';
        webview.addEventListener('did-finish-load', () => {
          if (currentWebview === webview) status.textContent = '';
        });
        webview.addEventListener('did-fail-load', event => {
          if (currentWebview === webview && event.errorCode !== -3) {
            status.textContent = '返信画面を読み込めませんでした。「再読み込み」を押してください。';
          }
        });
        currentWebview = webview;
        currentKey = key;
        host.replaceChildren(webview);
      }
      title.textContent = `${account.username} から ${item.author?.displayName || item.author?.handle || '相手'}さんへ返信`;
      panel.hidden = false;
      modal.classList.add('replying');
      return true;
    }

    documentRef.getElementById('notif-reply-back').addEventListener('click', back);
    documentRef.getElementById('notif-reply-reload').addEventListener('click', () => {
      try { currentWebview?.reload(); } catch { status.textContent = '読み込み中です。少し待ってから再試行してください。'; }
    });
    return { open, back };
  }

  global.SocialDeckNotificationReply = { replyUrl, createNotificationReplyRuntime };
})(window);
