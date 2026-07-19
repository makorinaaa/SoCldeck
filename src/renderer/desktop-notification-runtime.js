(function (global) {
  const STORAGE_KEY = 'socialdeck_desktop_notification_rules';
  const KNOWN_IDS_VERSION = 2;
  const MAX_KNOWN_IDS = 1_000;
  const REASONS = ['reply', 'mention', 'quote', 'follow', 'like', 'repost', 'other'];
  const DEFAULT_RULES = Object.freeze({
    enabled: false,
    networks: { x: true, b: true },
    reasons: {
      reply: true,
      mention: true,
      quote: true,
      follow: true,
      like: false,
      repost: false,
      other: false,
    },
    onlyWhenUnfocused: true,
    users: [],
    keywords: [],
  });
  const REASON_LABELS = {
    reply: '返信',
    mention: 'メンション',
    quote: '引用',
    follow: 'フォロー',
    like: 'いいね',
    repost: 'リポスト',
    other: '通知',
  };

  function normalizeList(values, { handle = false } = {}) {
    const source = Array.isArray(values)
      ? values
      : String(values || '').split(/[\n,]/);
    return [...new Set(source
      .map(value => String(value || '').trim().toLowerCase())
      .map(value => handle ? value.replace(/^@/, '') : value)
      .filter(Boolean))];
  }

  function normalizeRules(value = {}) {
    const networks = value.networks || {};
    const reasons = value.reasons || {};
    return {
      enabled: value.enabled === true,
      networks: {
        x: networks.x !== false,
        b: networks.b !== false,
      },
      reasons: Object.fromEntries(REASONS.map(reason => [
        reason,
        typeof reasons[reason] === 'boolean'
          ? reasons[reason]
          : DEFAULT_RULES.reasons[reason],
      ])),
      onlyWhenUnfocused: value.onlyWhenUnfocused !== false,
      users: normalizeList(value.users, { handle: true }),
      keywords: normalizeList(value.keywords),
    };
  }

  function itemKey(item) {
    const rawId = String(item?.id || '');
    const encodedId = encodeURIComponent(rawId).replace(/[!'()*]/g, character =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
    if (encodedId.length <= 240) return `${item?.networkId || 'unknown'}:${encodedId}`;
    let hash = 2166136261;
    for (let index = 0; index < rawId.length; index++) {
      hash ^= rawId.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${item?.networkId || 'unknown'}:${encodedId.slice(0, 220)}-${(hash >>> 0).toString(16)}`;
  }

  function notificationPresentation(item) {
    const author = item?.author || {};
    const name = String(author.displayName || author.handle || 'ユーザー').trim();
    const reason = REASON_LABELS[item?.reason] || REASON_LABELS.other;
    const body = String(
      item?.text
      || item?.raw?.record?.text
      || item?.raw?.text
      || `@${author.handle || name} からの${reason}です`,
    ).trim();
    return {
      title: `${name}さんから${reason}`,
      body: body.slice(0, 240),
    };
  }

  function matchesRules(item, rules, appFocused) {
    if (!rules.enabled) return false;
    if (rules.onlyWhenUnfocused && appFocused) return false;
    if (!rules.networks[item?.networkId]) return false;
    const reason = REASONS.includes(item?.reason) ? item.reason : 'other';
    if (!rules.reasons[reason]) return false;
    const author = item?.author || {};
    const handle = String(author.handle || '').replace(/^@/, '').toLowerCase();
    if (rules.users.length > 0 && !rules.users.includes(handle)) return false;
    if (rules.keywords.length > 0) {
      const presentation = notificationPresentation(item);
      const haystack = `${presentation.title} ${presentation.body} ${handle}`.toLowerCase();
      if (!rules.keywords.some(keyword => haystack.includes(keyword))) return false;
    }
    return true;
  }

  function createDesktopNotificationDomView({ documentRef = global.document } = {}) {
    const modal = documentRef.getElementById('desktopNotifSettingsMod');
    const openButton = documentRef.getElementById('desktop-notif-settings-btn');
    const enabled = documentRef.getElementById('desktop-notif-enabled');
    const backgroundOnly = documentRef.getElementById('desktop-notif-background-only');
    const networkX = documentRef.getElementById('desktop-notif-network-x');
    const networkB = documentRef.getElementById('desktop-notif-network-b');
    const users = documentRef.getElementById('desktop-notif-users');
    const keywords = documentRef.getElementById('desktop-notif-keywords');
    const status = documentRef.getElementById('desktop-notif-status');
    let handlers = {};

    function readRules() {
      const reasons = {};
      modal?.querySelectorAll('[data-desktop-notification-reason]').forEach(input => {
        reasons[input.dataset.desktopNotificationReason] = Boolean(input.checked);
      });
      return {
        enabled: Boolean(enabled?.checked),
        onlyWhenUnfocused: Boolean(backgroundOnly?.checked),
        networks: { x: Boolean(networkX?.checked), b: Boolean(networkB?.checked) },
        reasons,
        users: users?.value || '',
        keywords: keywords?.value || '',
      };
    }

    function onClick(event) {
      const action = event.target.closest?.('[data-desktop-notification-action]')
        ?.dataset.desktopNotificationAction;
      if (action === 'open') handlers.open?.();
      if (action === 'close') handlers.close?.();
      if (action === 'save') handlers.save?.(readRules());
    }

    openButton?.addEventListener('click', onClick);
    modal?.addEventListener('click', onClick);

    return {
      connect(nextHandlers) { handlers = nextHandlers || {}; },
      dispose() {
        openButton?.removeEventListener('click', onClick);
        modal?.removeEventListener('click', onClick);
        handlers = {};
      },
      render(snapshot) {
        const rules = snapshot.rules;
        if (enabled) enabled.checked = rules.enabled;
        if (backgroundOnly) backgroundOnly.checked = rules.onlyWhenUnfocused;
        if (networkX) networkX.checked = rules.networks.x;
        if (networkB) networkB.checked = rules.networks.b;
        if (users) users.value = rules.users.join(', ');
        if (keywords) keywords.value = rules.keywords.join(', ');
        modal?.querySelectorAll('[data-desktop-notification-reason]').forEach(input => {
          input.checked = Boolean(rules.reasons[input.dataset.desktopNotificationReason]);
        });
        if (status) {
          status.textContent = snapshot.error
            ? `取得エラー: ${snapshot.error}`
            : rules.enabled ? 'デスクトップ通知は有効です' : 'デスクトップ通知は無効です';
        }
      },
      setOpen(open) { modal?.classList.toggle('on', open); },
    };
  }

  function createDesktopNotificationRuntime({
    storage = global.localStorage,
    fetchItems = async () => [],
    showNotification = async () => false,
    isAppFocused = () => false,
    subscribeActivation = () => () => {},
    view = {},
    intents = {},
    setIntervalImpl = global.setInterval,
    clearIntervalImpl = global.clearInterval,
    intervalMs = 30_000,
    now = () => new Date(),
  } = {}) {
    let rules = normalizeRules();
    let knownIds = [];
    let baselined = false;
    let busy = false;
    let error = null;
    let lastCheckedAt = null;
    let timer = null;
    let disposed = false;
    let started = false;
    let polling = null;
    let unsubscribeActivation = null;
    const itemsByKey = new Map();

    function snapshot() {
      return {
        rules: normalizeRules(rules),
        busy,
        error,
        lastCheckedAt,
      };
    }

    function render() {
      const current = snapshot();
      view.render?.(current);
      return current;
    }

    function load() {
      try {
        const saved = JSON.parse(storage?.getItem?.(STORAGE_KEY) || 'null') || {};
        rules = normalizeRules(saved.rules || saved);
        const identitiesAreCurrent = saved.knownIdsVersion === KNOWN_IDS_VERSION;
        knownIds = identitiesAreCurrent && Array.isArray(saved.knownIds)
          ? saved.knownIds.filter(Boolean).slice(0, MAX_KNOWN_IDS)
          : [];
        baselined = identitiesAreCurrent && saved.baselined === true;
      } catch {
        rules = normalizeRules();
        knownIds = [];
        baselined = false;
      }
    }

    function save() {
      storage?.setItem?.(STORAGE_KEY, JSON.stringify({
        rules,
        knownIds,
        baselined,
        knownIdsVersion: KNOWN_IDS_VERSION,
      }));
    }

    function stopTimer() {
      if (timer == null) return;
      clearIntervalImpl?.(timer);
      timer = null;
    }

    function startTimer() {
      stopTimer();
      if (!rules.enabled || disposed) return;
      timer = setIntervalImpl?.(() => poll().catch(() => {}), intervalMs);
    }

    async function activate(key) {
      const item = itemsByKey.get(key);
      if (!item) return { status: 'ignored', detail: 'not-found' };
      await intents.activate?.(item);
      return { status: 'activated', item };
    }

    function pruneActivationTargets() {
      const retained = new Set(knownIds);
      for (const key of itemsByKey.keys()) {
        if (!retained.has(key)) itemsByKey.delete(key);
      }
    }

    async function executePoll() {
      if (disposed || !rules.enabled) return { status: 'ignored', detail: disposed ? 'disposed' : 'disabled', emitted: 0 };
      busy = true;
      error = null;
      render();
      try {
        const items = await fetchItems() || [];
        const currentKeys = items.map(itemKey);
        items.forEach(item => itemsByKey.set(itemKey(item), item));
        if (!baselined) {
          knownIds = currentKeys.slice(0, MAX_KNOWN_IDS);
          pruneActivationTargets();
          baselined = true;
          lastCheckedAt = now().toISOString();
          save();
          return { status: 'baselined', emitted: 0 };
        }

        const known = new Set(knownIds);
        const unseen = items.filter(item => !known.has(itemKey(item)));
        knownIds = [...new Set([...currentKeys, ...knownIds])].slice(0, MAX_KNOWN_IDS);
        pruneActivationTargets();
        lastCheckedAt = now().toISOString();
        const appFocused = Boolean(await isAppFocused());
        let emitted = 0;
        for (const item of unseen) {
          if (!matchesRules(item, rules, appFocused)) continue;
          const presentation = notificationPresentation(item);
          await showNotification({ key: itemKey(item), ...presentation });
          emitted++;
        }
        save();
        return { status: 'succeeded', emitted };
      } catch (pollError) {
        error = pollError?.message || '通知を取得できませんでした';
        return { status: 'failed', error: pollError, emitted: 0 };
      } finally {
        busy = false;
        render();
      }
    }

    function poll() {
      if (polling) return polling;
      polling = executePoll().finally(() => { polling = null; });
      return polling;
    }

    async function updateRules(patch = {}) {
      if (disposed) return { status: 'ignored', detail: 'disposed', snapshot: snapshot() };
      const wasEnabled = rules.enabled;
      rules = normalizeRules({
        ...rules,
        ...patch,
        networks: { ...rules.networks, ...(patch.networks || {}) },
        reasons: { ...rules.reasons, ...(patch.reasons || {}) },
      });
      if (!wasEnabled && rules.enabled) {
        baselined = false;
        knownIds = [];
        itemsByKey.clear();
      }
      save();
      startTimer();
      render();
      view.setOpen?.(false);
      intents.saved?.(rules);
      if (rules.enabled) await poll();
      return { status: 'updated', snapshot: snapshot() };
    }

    function openSettings() {
      if (disposed) return { status: 'ignored', detail: 'disposed' };
      view.setOpen?.(true);
      render();
      return { status: 'opened' };
    }

    function closeSettings() {
      view.setOpen?.(false);
      return { status: 'closed' };
    }

    async function rebaseline() {
      if (disposed) return { status: 'ignored', detail: 'disposed', emitted: 0 };
      baselined = false;
      knownIds = [];
      itemsByKey.clear();
      save();
      if (!rules.enabled) return { status: 'ignored', detail: 'disabled', emitted: 0 };
      return poll();
    }

    async function start() {
      if (disposed) return snapshot();
      if (!started) {
        started = true;
        load();
        view.connect?.({ open: openSettings, close: closeSettings, save: updateRules });
        unsubscribeActivation = subscribeActivation?.(activate) || null;
      }
      render();
      startTimer();
      if (rules.enabled) await poll();
      return snapshot();
    }

    function dispose() {
      if (disposed) return { status: 'disposed' };
      disposed = true;
      stopTimer();
      unsubscribeActivation?.();
      unsubscribeActivation = null;
      view.dispose?.();
      view.connect?.(null);
      itemsByKey.clear();
      return { status: 'disposed' };
    }

    return {
      dispose,
      getSnapshot: snapshot,
      openSettings,
      poll,
      rebaseline,
      start,
      updateRules,
    };
  }

  global.SocialDeckDesktopNotificationRuntime = {
    DEFAULT_RULES,
    STORAGE_KEY,
    createDesktopNotificationDomView,
    createDesktopNotificationRuntime,
    matchesRules,
    normalizeRules,
    notificationPresentation,
  };
})(window);
