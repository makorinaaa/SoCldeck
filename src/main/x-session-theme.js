const X_THEME_URL = 'https://x.com/';
const TEN_YEARS_SECONDS = 60 * 60 * 24 * 365 * 10;

async function ensureDefaultXDarkTheme(targetSession, nowSeconds = () => Date.now() / 1000) {
  const existing = await targetSession.cookies.get({
    url: X_THEME_URL,
    name: 'night_mode',
  });
  if (existing.length > 0) return false;

  await targetSession.cookies.set({
    url: X_THEME_URL,
    name: 'night_mode',
    value: '2',
    domain: '.x.com',
    path: '/',
    secure: true,
    sameSite: 'no_restriction',
    expirationDate: nowSeconds() + TEN_YEARS_SECONDS,
  });
  return true;
}

async function isXSessionAuthenticated(targetSession) {
  const cookies = await targetSession.cookies.get({
    url: X_THEME_URL,
    name: 'auth_token',
  });
  return cookies.length > 0;
}

// X stores the signed-in user's numeric id in the twid cookie ("u=123"). Only the id
// leaves this function; it identifies the account's own posts.
async function getXSessionUserId(targetSession) {
  const [cookie] = await targetSession.cookies.get({ url: X_THEME_URL, name: 'twid' });
  let value = String(cookie?.value || '');
  try { value = decodeURIComponent(value); } catch {}
  return /^"?u=(\d+)"?$/.exec(value)?.[1] || null;
}

module.exports = { ensureDefaultXDarkTheme, getXSessionUserId, isXSessionAuthenticated };
