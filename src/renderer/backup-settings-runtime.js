(function (global) {
  function createBackupSettingsRuntime({ backup, files, beforeCapture, beforeRestore, reload, documentRef = global.document }) {
    let pending = null;
    let busy = false;
    const status = () => documentRef.getElementById('backup-status');
    const apply = () => documentRef.getElementById('backup-apply');
    function reset() { pending = null; apply().hidden = true; }
    async function run(action) {
      if (busy) return;
      busy = true;
      try { await action(); }
      catch (error) { reset(); status().textContent = error.message || 'バックアップ操作に失敗しました'; }
      finally { busy = false; }
    }
    function preview(text) {
      reset();
      if (!text) { status().textContent = '復元するバックアップはありません'; return; }
      const { backup: data } = backup.prepare(text);
      pending = text;
      const accounts = [...new Set(data.columns.map(column => column.account).filter(Boolean))];
      status().textContent = `${data.columns.length} カラムを復元します。\n対象: ${accounts.join(' / ') || '情報カラムのみ'}\n現在の配置とバックアップ内の各種設定を置き換え、画面を再読み込みします。添付ファイルは選び直してください。復元直前の状態は退避します。`;
      apply().hidden = false;
    }
    return {
      open() {
        reset(); status().textContent = '';
        documentRef.getElementById('settingsMod').classList.remove('on');
        documentRef.getElementById('backupMod').classList.add('on');
      },
      export: () => run(async () => {
        reset(); beforeCapture();
        status().textContent = await files.saveWorkspaceBackup(backup.exportText()) ? 'バックアップを書き出しました' : '書き出しをキャンセルしました';
      }),
      import: () => run(async () => { reset(); preview(await files.openWorkspaceBackup()); }),
      recover: () => run(() => preview(backup.recoveryText())),
      apply: () => run(() => {
        if (!pending) return;
        beforeRestore(); beforeCapture();
        backup.restore(pending);
        reset(); reload();
      }),
    };
  }
  global.SocialDeckBackupSettingsRuntime = { createBackupSettingsRuntime };
})(window);
