const ALLOWED_HOSTS = new Set(['x.com', 'twitter.com', 'bsky.app']);

function parseAllowedUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(host)) return null;
    return url;
  } catch {
    return null;
  }
}

function isXPartition(partition) {
  return typeof partition === 'string' && /^persist:x(?:-\d+)?$/.test(partition);
}

function normalizeNotificationWindowRequest(value) {
  if (!value || typeof value !== 'object') return null;
  const url = parseAllowedUrl(value.url);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, '');
  const isX = host === 'x.com' || host === 'twitter.com';
  if (isX && value.networkId !== 'x') return null;
  if (isX && !isXPartition(value.partition)) return null;
  if (!isX && value.networkId !== 'b') return null;
  return {
    networkId: isX ? 'x' : 'b',
    url: url.toString(),
    partition: isX ? value.partition : null,
    title: String(value.title || 'SocialDeck Notification').slice(0, 120),
  };
}

module.exports = {
  normalizeNotificationWindowRequest,
  parseAllowedUrl,
};
