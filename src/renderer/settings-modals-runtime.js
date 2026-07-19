(function (global) {
  function createSettingsModalsRuntime({
    documentRef = global.document,
    storage = global.localStorage,
    muteRules,
    appearance,
    memoryCleaner,
    columns = {},
    ui = {},
    intents = {},
  } = {}) {
    if (!muteRules || !appearance || !memoryCleaner) {
      throw new Error('Settings Modals require mute, appearance, and memory boundaries');
    }
    const escape = ui.escape || (value => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;'));
    const toast = intents.toast || (() => {});
    const refilterColumns = intents.refilterColumns || (() => {});

    function openOverlay(id, innerHtml) {
      documentRef.getElementById(id)?.remove();
      const overlay = documentRef.createElement('div');
      overlay.className = 'ov on';
      overlay.id = id;
      overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };
      overlay.innerHTML = innerHtml;
      documentRef.body.appendChild(overlay);
      return overlay;
    }

    function closeOverlay(id) {
      documentRef.getElementById(id)?.remove();
    }

    // ── NGワード / ミュート ──
    function ngRuleList(rules, kind, format) {
      return rules.map((value, index) =>
        `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
          <span style="flex:1;font-size:12px;color:var(--text1)">${format(value)}</span>
          <button data-action="remove-ng-rule" data-rule-kind="${kind}" data-rule-index="${index}" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--red);cursor:pointer;font-size:11px;font-family:inherit">削除</button>
        </div>`).join('') || '<div style="font-size:12px;color:var(--text3);padding:6px 0">なし</div>';
    }

    function openNgSettings() {
      const ngData = muteRules.getRules();
      const wordsList = ngRuleList(ngData.words, 'word', word => escape(word));
      const usersList = ngRuleList(ngData.users, 'user', user => `@${escape(user)}`);
      openOverlay('ng-modal-ov', `<div class="modal" style="width:380px;max-height:80vh;overflow-y:auto">
        <h2 style="margin-bottom:16px">NGワード / ミュート設定</h2>
        <div style="margin-bottom:18px">
          <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px">NGワード（投稿本文）</div>
          ${wordsList}
          <div style="display:flex;gap:6px;margin-top:8px">
            <input id="ng-word-input" type="text" placeholder="キーワードを追加…" style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text1);font-family:inherit;outline:none">
            <button data-action="add-ng-rule" data-rule-kind="word" style="padding:6px 12px;border-radius:6px;background:var(--accent);border:none;color:#fff;cursor:pointer;font-size:12px;font-family:inherit">追加</button>
          </div>
        </div>
        <div style="margin-bottom:18px">
          <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px">ミュートユーザー</div>
          ${usersList}
          <div style="display:flex;gap:6px;margin-top:8px">
            <input id="ng-user-input" type="text" placeholder="@handle を追加…" style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text1);font-family:inherit;outline:none">
            <button data-action="add-ng-rule" data-rule-kind="user" style="padding:6px 12px;border-radius:6px;background:var(--accent);border:none;color:#fff;cursor:pointer;font-size:12px;font-family:inherit">追加</button>
          </div>
        </div>
        <button data-action="remove-element" data-target-id="ng-modal-ov" class="btn-cancel">閉じる</button>
      </div>`);
      global.setTimeout(() => documentRef.getElementById('ng-word-input')?.focus(), 50);
    }

    function addNgRule(kind) {
      const inputId = kind === 'word' ? 'ng-word-input' : 'ng-user-input';
      const input = documentRef.getElementById(inputId);
      const { value } = muteRules.add(kind, input?.value);
      if (!value) return;
      openNgSettings();
      refilterColumns();
      toast('NG ' + kind + ': ' + value + ' added');
    }

    function removeNgRule(kind, index) {
      muteRules.remove(kind, index);
      openNgSettings();
      refilterColumns();
    }

    // ── カラム設定 ──
    function optionButton(action, dataAttributes, active, label) {
      const data = Object.entries(dataAttributes)
        .map(([name, value]) => `data-${name}="${escape(value)}"`).join(' ');
      return `<button data-action="${action}" ${data}
        style="padding:5px 11px;border-radius:6px;border:1px solid ${active ? 'var(--accent)' : 'var(--border2)'};background:${active ? 'var(--accent-dim)' : 'transparent'};color:${active ? 'var(--accent)' : 'var(--text2)'};cursor:pointer;font-size:12px;font-family:inherit">
        ${label}</button>`;
    }

    function openColumnSettings(id, colType) {
      const currentSeconds = Math.round((columns.getRefreshInterval?.(id) || 0) / 1000);
      const currentFontSize = parseInt(storage.getItem(`col_fs_${id}`)) || 13;
      openOverlay('col-settings-ov', `<div class="modal" style="width:300px">
        <h2 style="margin-bottom:14px">Column settings</h2>
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Auto refresh interval</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
          ${[15, 30, 60, 120, 300, 0].map(seconds => optionButton(
            'apply-column-interval',
            { 'column-id': id, 'interval-ms': seconds * 1000 },
            currentSeconds === seconds,
            seconds === 0 ? 'OFF' : seconds < 60 ? seconds + ' sec' : seconds / 60 + ' min',
          )).join('')}
        </div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Font size</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
          ${[11, 12, 13, 14, 15, 16].map(fontSize => optionButton(
            'apply-column-font-size',
            { 'column-id': id, 'column-type': colType, 'font-size': fontSize },
            currentFontSize === fontSize,
            fontSize + 'px',
          )).join('')}
        </div>
        <button data-action="remove-element" data-target-id="col-settings-ov" class="btn-cancel">Close</button>
      </div>`);
    }

    function applyColumnInterval(id, ms) {
      columns.setRefreshInterval?.(id, ms);
      const label = ms === 0 ? 'OFF' : ms < 60000 ? (ms / 1000) + ' sec' : (ms / 60000) + ' min';
      toast('Auto refresh: ' + label);
      closeOverlay('col-settings-ov');
      columns.persistLayout?.();
    }

    function applyColumnFontSize(id, colType, fontSize) {
      storage.setItem(`col_fs_${id}`, fontSize);
      columns.setFontSize?.(id, colType, fontSize);
      toast(`文字サイズ: ${fontSize}px`);
      closeOverlay('col-settings-ov');
    }

    // ── メモリ管理 ──
    function formatMemoryMb(valueKb) {
      const value = Number(valueKb);
      return Number.isFinite(value) ? `${(value / 1024).toFixed(1)} MB` : '計測不可';
    }

    function renderMemoryMetrics(snapshot) {
      const target = documentRef.getElementById('memory-metrics');
      if (!target) return;
      const host = snapshot?.host;
      const runtime = snapshot?.runtime || {};
      if (!host) {
        target.innerHTML = '<span style="color:var(--text3)">Electronで起動するとプロセスメモリを確認できます。</span>';
        return;
      }
      const groups = host.groups || {};
      target.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <strong style="font-size:18px;color:var(--text1)">${formatMemoryMb(host.totalKb)}</strong>
          <span style="color:var(--text3)">${host.processCount || 0}プロセス</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:5px 12px;color:var(--text2)">
          <span>メイン</span><span>${formatMemoryMb(groups.browser)}</span>
          <span>画面・WebView</span><span>${formatMemoryMb(groups.renderer)}</span>
          <span>GPU</span><span>${formatMemoryMb(groups.gpu)}</span>
          <span>その他</span><span>${formatMemoryMb((groups.utility || 0) + (groups.other || 0))}</span>
        </div>
        <div style="border-top:1px solid var(--border);margin-top:9px;padding-top:8px;color:var(--text3)">
          Bluesky ${runtime.blueskyItems || 0}件 / ${runtime.blueskyColumns || 0}カラム<br>
          X WebView ${runtime.xColumnWebViews || 0}個 / 通知Reader ${runtime.xNotificationReaders || 0}個
        </div>`;
    }

    async function refreshMemoryMetrics() {
      const target = documentRef.getElementById('memory-metrics');
      if (target) target.textContent = '計測中…';
      try {
        renderMemoryMetrics(await memoryCleaner.measure());
      } catch (error) {
        if (target) target.textContent = `計測できませんでした: ${error.message}`;
      }
    }

    async function clearMemoryNow(showToast = true) {
      const button = documentRef.querySelector('[data-action="clear-memory-now"]');
      if (button) button.disabled = true;
      try {
        const result = await memoryCleaner.clear({ includeCache: true });
        renderMemoryMetrics(result.after);
        if (showToast) {
          const removed = result.runtimeCleanup?.blueskyItemsRemoved || 0;
          const readers = result.runtimeCleanup?.xNotificationReadersDisposed || 0;
          toast(`メモリを整理しました（投稿${removed}件・Reader ${readers}個を解放）`);
        }
        return result;
      } catch (error) {
        if (showToast) toast(`メモリ整理エラー: ${error.message}`);
        return null;
      } finally {
        if (button) button.disabled = false;
      }
    }

    function openMemorySettings() {
      const current = memoryCleaner.getInterval();
      openOverlay('mem-settings-ov', `
        <div class="modal" style="width:340px">
          <h2 style="margin-bottom:6px">メモリ管理</h2>
          <p style="font-size:12px;color:var(--text2);margin-bottom:10px">長時間利用時の描画データを定期的に整理します。</p>
          <div id="memory-metrics" style="font-size:11px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:11px;margin-bottom:12px">計測中…</div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:7px">自動整理の間隔</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
            ${[[15 * 60000, '15分'], [30 * 60000, '30分'], [60 * 60000, '1時間'], [120 * 60000, '2時間'], [0, 'OFF']].map(([ms, label]) => optionButton(
              'apply-memory-interval',
              { 'interval-ms': ms },
              current === ms,
              label,
            )).join('')}
          </div>
          <button data-action="clear-memory-now"
            style="width:100%;padding:8px;border-radius:7px;background:var(--bg3);border:1px solid var(--border);color:var(--text2);font-family:inherit;font-size:12px;cursor:pointer;margin-bottom:8px">
            今すぐ整理（キャッシュを含む）
          </button>
          <div style="display:flex;gap:7px">
            <button data-action="refresh-memory-metrics" class="btn-cancel">再計測</button>
            <button data-action="remove-element" data-target-id="mem-settings-ov" class="btn-cancel">閉じる</button>
          </div>
        </div>`);
      refreshMemoryMetrics();
    }

    function applyMemoryInterval(ms) {
      memoryCleaner.setIntervalMs(ms);
      const label = ms === 0 ? 'OFF' : ms < 3600000 ? (ms / 60000) + '分' : (ms / 3600000) + '時間';
      toast(`メモリ自動整理: ${label}`);
      closeOverlay('mem-settings-ov');
    }

    // ── 外観設定 ──
    function syncAppearanceSettings(current) {
      documentRef.querySelectorAll('.appearance-theme').forEach(button => {
        button.classList.toggle('primary', button.dataset.theme === current.theme);
      });
      documentRef.querySelectorAll('.appearance-swatch').forEach(button => {
        button.classList.toggle('selected', button.dataset.accent === current.accent);
      });
      const custom = documentRef.getElementById('appearance-custom-color');
      if (custom && custom.value !== current.accent) custom.value = current.accent;
    }

    function openAppearanceSettings() {
      syncAppearanceSettings(appearance.begin());
      documentRef.getElementById('appearanceMod')?.classList.add('on');
    }

    function previewAppearance(partial) {
      syncAppearanceSettings(appearance.preview(partial));
    }

    function cancelAppearance(event = null, overlay = null) {
      if (event && overlay && event.target !== overlay) return;
      appearance.cancel();
      documentRef.getElementById('appearanceMod')?.classList.remove('on');
    }

    function saveAppearance() {
      syncAppearanceSettings(appearance.commit());
      documentRef.getElementById('appearanceMod')?.classList.remove('on');
      toast('テーマ設定を保存しました');
    }

    return {
      addNgRule,
      applyColumnFontSize,
      applyColumnInterval,
      applyMemoryInterval,
      cancelAppearance,
      clearMemoryNow,
      openAppearanceSettings,
      openColumnSettings,
      openMemorySettings,
      openNgSettings,
      previewAppearance,
      refreshMemoryMetrics,
      removeNgRule,
      saveAppearance,
    };
  }

  global.SocialDeckSettingsModalsRuntime = { createSettingsModalsRuntime };
})(window);
