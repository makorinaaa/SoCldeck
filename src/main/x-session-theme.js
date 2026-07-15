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

module.exports = { ensureDefaultXDarkTheme };
