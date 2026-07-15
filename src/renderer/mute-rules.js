(function (global) {
  const STORAGE_KEY = 'socialdeck_ng';

  function emptyRules() {
    return { words: [], users: [] };
  }

  function normalizeRules(value) {
    if (!value || typeof value !== 'object') return emptyRules();
    return {
      words: Array.isArray(value.words) ? value.words.filter(rule => typeof rule === 'string') : [],
      users: Array.isArray(value.users) ? value.users.filter(rule => typeof rule === 'string') : [],
    };
  }

  function createMuteRules(storage = global.localStorage) {
    let rules = load();

    function load() {
      try {
        return normalizeRules(JSON.parse(storage.getItem(STORAGE_KEY)));
      } catch {
        return emptyRules();
      }
    }

    function save() {
      storage.setItem(STORAGE_KEY, JSON.stringify(rules));
    }

    function getRules() {
      return { words: [...rules.words], users: [...rules.users] };
    }

    function add(type, input) {
      const value = String(input || '').trim().replace(/^@/, '');
      if (!value) return { changed: false, value: '' };
      const list = type === 'word' ? rules.words : rules.users;
      if (list.includes(value)) return { changed: false, value };
      list.push(value);
      save();
      return { changed: true, value };
    }

    function remove(type, index) {
      const list = type === 'word' ? rules.words : rules.users;
      if (!Number.isInteger(index) || index < 0 || index >= list.length) return false;
      list.splice(index, 1);
      save();
      return true;
    }

    function blocksPost(item) {
      const post = item.post || item;
      const texts = [post.record?.text || ''];
      const authors = [{ handle: post.author?.handle, displayName: post.author?.displayName }];

      const reasonBy = item.reason?.by;
      if (reasonBy) authors.push({ handle: reasonBy.handle, displayName: reasonBy.displayName });

      const embed = post.embed;
      if (embed) {
        const quotedRecord = embed.record?.value ? embed.record : embed.record?.record;
        if (quotedRecord?.value?.text) texts.push(quotedRecord.value.text);
        if (quotedRecord?.author) {
          authors.push({
            handle: quotedRecord.author.handle,
            displayName: quotedRecord.author.displayName,
          });
        }
      }

      const normalizedTexts = texts.map(text => text.toLowerCase());
      if (rules.words.some(rule => rule && normalizedTexts.some(text => text.includes(rule.toLowerCase())))) {
        return true;
      }

      return rules.users.some(rule => {
        if (!rule) return false;
        const normalizedRule = rule.toLowerCase();
        return authors.some(author =>
          (author.handle || '').toLowerCase().includes(normalizedRule)
          || (author.displayName || '').toLowerCase().includes(normalizedRule));
      });
    }

    function blocksNotification(notification) {
      const handle = (notification.author?.handle || '').toLowerCase();
      return rules.users.some(rule => rule && handle.includes(rule.toLowerCase()));
    }

    return { getRules, add, remove, blocksPost, blocksNotification };
  }

  global.SocialDeckMuteRules = {
    STORAGE_KEY,
    createMuteRules,
  };
})(window);
