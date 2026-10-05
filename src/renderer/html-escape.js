(function (global) {
  const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  // Escapes text for HTML element content and quoted attribute values.
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ENTITIES[character]);
  }

  global.SocialDeckHtmlEscape = { escapeHtml };
})(window);
