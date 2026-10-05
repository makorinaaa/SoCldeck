(function (global) {
  function createReplyNotificationRuntime({ storage = global.localStorage, view = {}, openItem = async () => false } = {}) {
    const key = 'socialdeck_x_reply_notifications_v1';
    // Bumped when notification identities change format: the next observation is taken as
    // already seen instead of announcing every notification again.
    const IDENTITY_VERSION = 2;
    let accounts = {};
    try { accounts = JSON.parse(storage?.getItem(key) || '{}') || {}; } catch {}
    if (typeof accounts !== 'object' || Array.isArray(accounts)) accounts = {};
    Object.keys(accounts).forEach(id => {
      const account = accounts[id];
      if (!account || !Array.isArray(account.seen) || !Array.isArray(account.unread)) delete accounts[id];
    });
    let persistedState = JSON.stringify(accounts);
    const unreadIndex = new Map();
    function accountKey(account) { return account.partition || account.username; }
    function identity(item) {
      const post = item.targetUrl + '|' + (item.author?.handle || '');
      // Keep the existing reply identity so saved read state survives this upgrade.
      return item.reason === 'like' ? `like|${post}|${item.indexedAt || ''}` : post;
    }
    function unreadItems() { return Object.values(accounts).flatMap(account => account.unread || []); }
    function getItemKey(item) { return `${accountKey(item.account || {})}|${identity(item)}`; }
    function indexUnread() {
      unreadIndex.clear();
      Object.entries(accounts).forEach(([id, account]) => unreadIndex.set(id, new Set(account.unread.map(identity))));
    }
    indexUnread();
    function save() {
      indexUnread();
      const next = JSON.stringify(accounts);
      if (next !== persistedState) {
        try { storage?.setItem(key, next); persistedState = next; } catch {}
      }
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
      const replies = items.filter(item => ['reply', 'like'].includes(item.reason));
      const previous = accounts[id];
      const seen = new Set(previous?.seen || []);
      const fresh = [];
      for (const item of replies) {
        const itemId = identity(item);
        const baselined = previous && previous.identityVersion === IDENTITY_VERSION
          && (item.reason !== 'like' || previous.likesBaselined === true);
        if (baselined && !seen.has(itemId)) fresh.push({ ...item, account, accountIndex });
        seen.add(itemId);
      }
      accounts[id] = {
        seen: [...seen].slice(-2000),
        likesBaselined: true,
        identityVersion: IDENTITY_VERSION,
        unread: [...(previous?.unread || []), ...fresh],
      };
      save();
      if (fresh.length) view.notify?.(fresh);
    }
    // The next observation of this account is taken as already seen.
    function rebaseline(account) {
      const entry = accounts[accountKey(account || {})];
      if (entry) entry.identityVersion = 0;
      save();
    }
    function isRead(item) {
      return !unreadIndex.get(accountKey(item.account || {}))?.has(identity(item));
    }
    function markRead(item) {
      const account = accounts[accountKey(item.account || {})];
      if (account) account.unread = account.unread.filter(entry => identity(entry) !== identity(item));
      save();
    }
    function markAllRead() {
      Object.values(accounts).forEach(account => { account.unread = []; });
      save();
    }
    async function activate(item) {
      if (await openItem(item) === false) return;
      markRead(item);
    }
    return { observe, syncAccounts, isRead, activate, markRead, markAllRead, rebaseline, unreadItems, getItemKey, render: save };
  }

  function createReplyNotificationDomView({ documentRef = global.document, activate, openUnread, onBadge = () => {} } = {}) {
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
        onBadge(count);
      },
      notify(items) {
        pending.push(...items);
        const item = pending[0];
        const reasonLabel = item.reason === 'like' ? 'いいね' : 'リプライ';
        documentRef.getElementById('reply-toast-title').textContent = pending.length === 1
          ? `${item.author.displayName || item.author.handle}さんから${reasonLabel}`
          : `新しい通知が${pending.length}件あります`;
        documentRef.getElementById('reply-toast-body').textContent = pending.length === 1 ? item.text : 'クリックして未読通知を確認';
        panel.hidden = false;
        schedule();
      },
    };
  }
  global.SocialDeckReplyNotifications = { createReplyNotificationRuntime, createReplyNotificationDomView };
})(window);
