(function (global) {
  function createReplyNotificationRuntime({ storage = global.localStorage, view = {}, openItem = async () => false } = {}) {
    const key = 'socialdeck_x_reply_notifications_v1';
    let accounts = {};
    try { accounts = JSON.parse(storage?.getItem(key) || '{}') || {}; } catch {}
    function accountKey(account) { return account.partition || account.username; }
    function identity(item) { return item.targetUrl + '|' + (item.author?.handle || ''); }
    function unreadItems() { return Object.values(accounts).flatMap(account => account.unread || []); }
    function save() {
      try { storage?.setItem(key, JSON.stringify(accounts)); } catch {}
      view.badge?.(unreadItems().length);
    }
    function syncAccounts(current) {
      const active = new Set(current.map(accountKey));
      Object.keys(accounts).forEach(id => { if (!active.has(id)) delete accounts[id]; });
      save();
    }
    function observe(items, account, accountIndex) {
      const id = accountKey(account);
      if (!id) return;
      const replies = items.filter(item => item.reason === 'reply');
      const previous = accounts[id];
      const seen = new Set(previous?.seen || []);
      const fresh = [];
      for (const item of replies) {
        const itemId = identity(item);
        if (previous && !seen.has(itemId)) fresh.push({ ...item, account, accountIndex });
        seen.add(itemId);
      }
      accounts[id] = {
        seen: [...seen].slice(-2000),
        unread: [...(previous?.unread || []), ...fresh],
      };
      save();
      if (fresh.length) view.notify?.(fresh);
    }
    function isRead(item) {
      return !(accounts[accountKey(item.account || {})]?.unread || []).some(entry => identity(entry) === identity(item));
    }
    async function activate(item) {
      if (await openItem(item) === false) return;
      const account = accounts[accountKey(item.account || {})];
      if (account) account.unread = account.unread.filter(entry => identity(entry) !== identity(item));
      save();
    }
    return { observe, syncAccounts, isRead, activate, unreadItems, render: save };
  }

  function createReplyNotificationDomView({ documentRef = global.document, activate, openUnread } = {}) {
    const panel = documentRef.getElementById('reply-toast');
    const content = documentRef.getElementById('reply-toast-content');
    let pending = [];
    let timer;
    let hovered = false;
    let focused = false;
    function dismiss() { clearTimeout(timer); panel.hidden = true; pending = []; hovered = false; focused = false; }
    function schedule() { clearTimeout(timer); if (!hovered && !focused) timer = setTimeout(dismiss, 8000); }
    panel.addEventListener('mouseenter', () => { hovered = true; clearTimeout(timer); });
    panel.addEventListener('mouseleave', () => { hovered = false; schedule(); });
    panel.addEventListener('focusin', () => { focused = true; clearTimeout(timer); });
    panel.addEventListener('focusout', event => { focused = panel.contains(event.relatedTarget); schedule(); });
    documentRef.getElementById('reply-toast-close').addEventListener('click', dismiss);
    content.addEventListener('click', () => {
      const items = pending;
      dismiss();
      if (items.length === 1) activate(items[0]); else openUnread();
    });
    return {
      badge(count) {
        const badge = documentRef.getElementById('x-reply-badge');
        if (badge) { badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = count === 0; }
        const button = documentRef.getElementById('x-reply-button');
        if (button) button.title = `Xの未読リプライ ${count}件`;
      },
      notify(items) {
        pending.push(...items);
        const item = pending[0];
        documentRef.getElementById('reply-toast-title').textContent = pending.length === 1
          ? `${item.author.displayName || item.author.handle}さんからリプライ`
          : `新しいリプライが${pending.length}件あります`;
        documentRef.getElementById('reply-toast-body').textContent = pending.length === 1 ? item.text : 'クリックして未読リプライを確認';
        panel.hidden = false;
        schedule();
      },
    };
  }
  global.SocialDeckReplyNotifications = { createReplyNotificationRuntime, createReplyNotificationDomView };
})(window);
