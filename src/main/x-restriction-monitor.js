// X がアカウントの制限や本人確認を求めたことを見つけ、そのアカウントの画面（renderer）に知らせる。
// 知らせを受けた renderer は、そのアカウントの X の自動操作をすべて止める。
// 制限中に自動更新やボタン操作を続けると、制限が重くなるおそれがあるため。
const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.x.com', 'mobile.twitter.com']);
const { timelineOperation } = require('./x-timeline-normalizer');

// 同じ知らせを短い間に何度も送らない
const REPEAT_MS = 60 * 1000;
// SocialDeck が繰り返し読み取る・押す操作。タイムライン・リスト・通知は timelineOperation が判定する
const SOCIALDECK_OPERATIONS = new Set([
  'TweetDetail', 'TweetResultByRestId', 'TweetResultsByRestIds',
  'FavoriteTweet', 'UnfavoriteTweet', 'CreateRetweet', 'DeleteRetweet', 'CreateTweet', 'DeleteTweet',
]);

function graphqlOperation(url) {
  try {
    const parsed = new URL(url);
    if (!X_HOSTS.has(parsed.hostname) && !['api.x.com', 'api.twitter.com'].includes(parsed.hostname)) return null;
    return parsed.pathname.match(/\/graphql\/[^/]+\/([A-Za-z]+)$/)?.[1] || null;
  } catch {
    return null;
  }
}

// X のページは補助的な操作もたくさん送るので、その 429 では止めない
function isSocialDeckOperation(url) {
  return Boolean(timelineOperation(url)) || SOCIALDECK_OPERATIONS.has(graphqlOperation(url));
}

// アカウントのロック・本人確認（電話番号や画像認証など）の画面
function restrictionOfUrl(url) {
  try {
    const parsed = new URL(url);
    if (!X_HOSTS.has(parsed.hostname)) return null;
    return /^\/account\/access\/?$/.test(parsed.pathname) ? 'locked' : null;
  } catch {
    return null;
  }
}

function createXRestrictionMonitor({ partitionOf, fromId, now = Date.now }) {
  const lastSent = new Map();

  function report(contents, reason, detail = {}) {
    if (!contents || contents.isDestroyed?.()) return;
    const partition = partitionOf(contents);
    const host = contents.hostWebContents;
    if (!partition || !host || host.isDestroyed()) return;
    const key = `${partition}|${reason}`;
    const time = now();
    if (lastSent.has(key) && time - lastSent.get(key) < REPEAT_MS) return;
    lastSent.set(key, time);
    host.send('x-account-restricted', { partition, reason, ...detail });
  }

  function watch(contents) {
    const onNavigate = (_, url, isMainFrame = true) => {
      if (!isMainFrame) return;
      const reason = restrictionOfUrl(url);
      if (reason) report(contents, reason);
    };
    contents.on('did-navigate', onNavigate);
    contents.on('did-navigate-in-page', onNavigate);
  }

  // SocialDeck が使う X の操作が 429（回数制限）を返した
  function observeResponse(details) {
    if (details?.statusCode !== 429 || !isSocialDeckOperation(details.url)) return;
    report(fromId(details.webContentsId), 'rate-limit', { operation: graphqlOperation(details.url) });
  }

  return { observeResponse, watch };
}

module.exports = { createXRestrictionMonitor, graphqlOperation, isSocialDeckOperation, restrictionOfUrl };
