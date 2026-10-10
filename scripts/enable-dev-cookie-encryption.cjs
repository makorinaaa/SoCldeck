// The installed app is built with Electron's cookie encryption fuse on, and the development
// Electron (npm start / npm run dev) shares its data folder. A development Electron without
// the fuse cannot read the encrypted cookies and drops them, which signs every X and
// Bluesky page of the installed app out. Turning the same fuse on here keeps both readable.
const { getCurrentFuseWire, flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const { FuseState } = require('@electron/fuses/dist/constants');

// --strict (before starting the app) refuses to start it without the fuse.
const strict = process.argv.includes('--strict');

async function main() {
  let electronPath;
  try {
    electronPath = require('electron');
  } catch {
    console.log('[dev-cookie-encryption] Electron is not installed; skipped');
    return;
  }
  const wire = await getCurrentFuseWire(electronPath);
  if (wire[FuseV1Options.EnableCookieEncryption] === FuseState.ENABLE) return;
  await flipFuses(electronPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: process.platform === 'darwin',
    [FuseV1Options.EnableCookieEncryption]: true,
  });
  console.log('[dev-cookie-encryption] Cookie encryption enabled for the development Electron');
}

main().catch(error => {
  console.error('[dev-cookie-encryption] Could not enable cookie encryption:', error?.message || error);
  if (strict) {
    console.error('[dev-cookie-encryption] Close every running SocialDeck development window and try again;'
      + ' starting without it would sign the installed app out of X.');
    process.exitCode = 1;
  }
});
