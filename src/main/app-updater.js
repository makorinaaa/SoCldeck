const AUTO_CHECK_DELAY_MS = 10_000;
const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function createAppUpdater({
  autoUpdater,
  app,
  getWindow,
  showUpdatePrompt = null,
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
}) {
  let updateDownloaded = false;
  let manualCheck = false;
  let promptedVersion = null;

  function send(status, details = {}) {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('update-status', { status, ...details });
  }

  function reportError(error) {
    console.error('[Updater]', error);
    if (manualCheck) {
      send('error', { message: '更新を確認できませんでした。時間をおいて再試行してください。' });
    }
    manualCheck = false;
  }

  async function promptForInstall(info) {
    if (typeof showUpdatePrompt !== 'function' || promptedVersion === info.version) return;
    promptedVersion = info.version;
    try {
      if (await showUpdatePrompt({ version: info.version })) install();
    } catch (error) {
      console.error('[Updater] Update prompt failed', error);
    }
  }

  async function check({ manual = false } = {}) {
    if (!app.isPackaged || process.env.SOCIALDECK_E2E === '1') {
      if (manual) send('development');
      return false;
    }

    if (manual) manualCheck = true;
    if (manual) send('checking');
    try {
      await autoUpdater.checkForUpdates();
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  function start() {
    if (!app.isPackaged || process.env.SOCIALDECK_E2E === '1') return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', info => {
      send('available', { version: info.version });
    });
    autoUpdater.on('update-not-available', info => {
      if (manualCheck) send('not-available', { version: info.version });
      manualCheck = false;
    });
    autoUpdater.on('download-progress', progress => {
      send('downloading', { percent: Math.round(progress.percent || 0) });
    });
    autoUpdater.on('update-downloaded', info => {
      updateDownloaded = true;
      manualCheck = false;
      send('downloaded', { version: info.version });
      void promptForInstall(info);
    });
    autoUpdater.on('error', reportError);

    setTimeoutFn(() => check(), AUTO_CHECK_DELAY_MS);
    setIntervalFn(() => check(), AUTO_CHECK_INTERVAL_MS);
  }

  function install() {
    if (!updateDownloaded) return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  }

  return { start, check, install };
}

module.exports = {
  AUTO_CHECK_DELAY_MS,
  AUTO_CHECK_INTERVAL_MS,
  createAppUpdater,
};
