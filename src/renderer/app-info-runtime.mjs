function createAppInfoRuntime({ documentRef, api }) {
  async function openAbout() {
    const modal = documentRef.getElementById('aboutMod');
    const version = documentRef.getElementById('about-version');
    if (!modal || !version) return;
    try {
      const appVersion = await api?.getAppVersion?.();
      version.textContent = `Version ${appVersion || '開発版'}`;
    } catch {
      version.textContent = 'Version 開発版';
    }
    modal.classList.add('on');
  }

  function checkForUpdates() {
    const button = documentRef.getElementById('check-update-btn');
    const status = documentRef.getElementById('update-status');
    if (button) button.disabled = true;
    if (status) status.textContent = '更新を確認しています…';
    api?.checkForUpdates?.();
  }

  function installUpdate() {
    api?.installUpdate?.();
  }

  function renderUpdateStatus(update) {
    const status = documentRef.getElementById('update-status');
    const checkButton = documentRef.getElementById('check-update-btn');
    const installButton = documentRef.getElementById('install-update-btn');
    if (!status || !checkButton || !installButton || !update) return;

    checkButton.disabled = update.status === 'checking' || update.status === 'downloading';
    installButton.style.display = update.status === 'downloaded' ? '' : 'none';

    const messages = {
      checking: '更新を確認しています…',
      available: `Version ${update.version} を取得しています…`,
      downloading: `更新をダウンロードしています… ${update.percent ?? 0}%`,
      downloaded: `Version ${update.version} を適用できます。`,
      'not-available': '最新バージョンです。',
      development: '更新確認はインストール版で利用できます。',
      error: update.message || '更新を確認できませんでした。',
    };
    status.textContent = messages[update.status] || '';
  }
  return { openAbout, checkForUpdates, installUpdate, renderUpdateStatus };
}

export { createAppInfoRuntime };
