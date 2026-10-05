// WebViews present themselves to X and Bluesky as desktop Chrome on the engine they
// actually run, so the User-Agent, navigator.userAgent and client hints agree.
const CLIENT_HINT_URLS = [
  'https://x.com/*',
  'https://*.x.com/*',
  'https://twitter.com/*',
  'https://*.twitter.com/*',
  'https://bsky.app/*',
  'https://*.bsky.app/*',
];

function createWebviewBrowserIdentity({ chromeVersion = process.versions.chrome } = {}) {
  const major = String(chromeVersion || '').split('.')[0];
  if (!/^\d+$/.test(major)) throw new Error('Chromium version is unavailable');
  return {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    clientHints: {
      'sec-ch-ua': `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not-A.Brand";v="99"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  };
}

function createWebviewBrowserIdentityPolicy(identity = createWebviewBrowserIdentity()) {
  const configuredSessions = new WeakSet();

  // The user agent is set per WebView before it loads, so no request needs rewriting
  // for it. Client hints are added only for the sites' own hosts, which keeps media
  // and other subresource requests out of the main-process hook.
  function apply(contents) {
    contents.setUserAgent(identity.userAgent);
    const targetSession = contents.session;
    if (configuredSessions.has(targetSession)) return false;
    configuredSessions.add(targetSession);
    targetSession.webRequest.onBeforeSendHeaders({ urls: CLIENT_HINT_URLS }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, ...identity.clientHints } });
    });
    return true;
  }

  return { apply, identity };
}

module.exports = {
  CLIENT_HINT_URLS,
  createWebviewBrowserIdentity,
  createWebviewBrowserIdentityPolicy,
};
