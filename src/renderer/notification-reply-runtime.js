(function (global) {
  function replyUrl(item) {
    if (item?.networkId !== 'x' || !['reply', 'mention', 'quote'].includes(item.reason)) return null;
    return postUrl(item);
  }

  function postUrl(item) {
    try {
      const url = new URL(item.targetUrl);
      if (url.protocol !== 'https:' || !['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname)) return null;
      const post = url.pathname.match(/^\/([a-zA-Z0-9_]+)\/status\/(\d+)(?:\/|$)/);
      // Open the post itself so the surrounding conversation stays available while replying.
      return post ? `https://x.com/${post[1]}/status/${post[2]}` : null;
    } catch { return null; }
  }

  function notificationUrl(item) {
    if (item?.networkId === 'x') {
      const post = postUrl(item);
      if (post) return post;
      if (item.reason === 'follow' && /^[a-zA-Z0-9_]+$/.test(item.author?.handle || '')) {
        return `https://x.com/${item.author.handle}`;
      }
      return 'https://x.com/notifications';
    }
    if (item?.networkId === 'b') {
      const post = item.targetUri?.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
      if (post) return `https://bsky.app/profile/${encodeURIComponent(post[1])}/post/${encodeURIComponent(post[2])}`;
      if (item.author?.did) return `https://bsky.app/profile/${encodeURIComponent(item.author.did)}`;
    }
    return null;
  }

  function createNotificationReplyRuntime({ documentRef = global.document, getAccounts, getPreloadPath, getBlueskyAccount = () => null, getActivationScript } = {}) {
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
      const url = notificationUrl(item);
      const isX = item?.networkId === 'x';
      const account = isX ? getAccounts().find(entry => (entry.partition || entry.username)
        === (item.account?.partition || item.account?.username)) : getBlueskyAccount();
      if (!url || !account || account.loginPending || (isX && !getPreloadPath())) return false;
      const partition = isX ? account.partition : 'persist:bsky';
      const needsActivation = isX && url === 'https://x.com/notifications';
      const key = `${partition}:${isX ? '' : account.did || account.handle}:${url}:${needsActivation ? item.id : ''}`;
      if (currentKey !== key) {
        const webview = documentRef.createElement('webview');
        webview.setAttribute('partition', partition);
        if (isX) webview.setAttribute('preload', getPreloadPath());
        webview.setAttribute('webpreferences', 'backgroundThrottling=false');
        webview.setAttribute('aria-label', '通知の対象ページ');
        webview.src = url;
        status.textContent = '投稿と会話を読み込んでいます…';
        let activated = false;
        webview.addEventListener('did-finish-load', async () => {
          if (currentWebview !== webview) return;
          status.textContent = '';
          if (needsActivation && !activated) {
            activated = true;
            try {
              const script = getActivationScript?.(item);
              if (!script || !await webview.executeJavaScript(script)) {
                if (currentWebview === webview) status.textContent = '対象を見つけられませんでした。表示中の通知ページから確認できます。';
              }
            } catch {
              if (currentWebview === webview) status.textContent = '対象を開けませんでした。表示中の通知ページから確認できます。';
            }
          }
        });
        webview.addEventListener('did-fail-load', event => {
          if (currentWebview === webview && event.errorCode !== -3) {
            status.textContent = '投稿と会話を読み込めませんでした。「再読み込み」を押してください。';
          }
        });
        currentWebview = webview;
        currentKey = key;
        host.replaceChildren(webview);
      }
      title.textContent = `${isX ? account.username : account.handle || 'Bluesky'} · ${item.reason === 'follow' ? 'プロフィール' : '投稿と会話'}`;
      panel.hidden = false;
      modal.classList.add('on');
      modal.classList.add('replying');
      return true;
    }

    documentRef.getElementById('notif-reply-back').addEventListener('click', back);
    documentRef.getElementById('notif-reply-reload').addEventListener('click', () => {
      try { currentWebview?.reload(); } catch { status.textContent = '読み込み中です。少し待ってから再試行してください。'; }
    });
    return { open, back };
  }

  global.SocialDeckNotificationReply = { replyUrl, notificationUrl, createNotificationReplyRuntime };
})(window);
