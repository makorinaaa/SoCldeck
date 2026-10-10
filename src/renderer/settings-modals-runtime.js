(function (global) {
  function createSettingsModalsRuntime({
    documentRef = global.document,
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
        `<div class="ng-row">
          <span>${format(value)}</span>
          <button class="ng-del" data-action="remove-ng-rule" data-rule-kind="${kind}" data-rule-index="${index}">削除</button>
        </div>`).join('') || '<div class="ng-empty">なし</div>';
    }

    function openNgSettings() {
      const ngData = muteRules.getRules();
      const wordsList = ngRuleList(ngData.words, 'word', word => escape(word));
      const usersList = ngRuleList(ngData.users, 'user', user => `@${escape(user)}`);
      openOverlay('ng-modal-ov', `<div class="modal" style="width:380px;max-height:80vh;overflow-y:auto">
        <h2 style="margin-bottom:16px">NGワード / ミュート設定</h2>
        <div style="margin-bottom:18px">
          <div class="ng-section-title">NGワード（投稿本文）</div>
          ${wordsList}
          <div class="ng-add-row">
            <input id="ng-word-input" class="ng-input" type="text" placeholder="キーワードを追加…">
            <button class="ng-add" data-action="add-ng-rule" data-rule-kind="word">追加</button>
          </div>
        </div>
        <div style="margin-bottom:18px">
          <div class="ng-section-title">ミュートユーザー</div>
          ${usersList}
          <div class="ng-add-row">
            <input id="ng-user-input" class="ng-input" type="text" placeholder="@handle を追加…">
            <button class="ng-add" data-action="add-ng-rule" data-rule-kind="user">追加</button>
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
    function intervalLabel(ms) {
      if (ms === 0) return 'OFF';
      return ms < 60000 ? `${ms / 1000}秒` : `${ms / 60000}分`;
    }

    function optionButton(action, dataAttributes, active, label) {
      const data = Object.entries(dataAttributes)
        .map(([name, value]) => `data-${name}="${escape(value)}"`).join(' ');
      return `<button class="chip-btn${active ? ' on' : ''}" data-action="${action}" ${data}>
        ${label}</button>`;
    }

    // ── カラム別フィルター ──
    // columns.getFilter が undefined を返すカラム（通知など）には出さない
    const MAX_FILTER_WORDS = 20;
    const openedColumnTypes = new Map();

    function currentFilter(id) {
      const filter = columns.getFilter?.(id);
      return {
        mediaOnly: Boolean(filter?.mediaOnly),
        hideReposts: Boolean(filter?.hideReposts),
        keywords: [...(filter?.keywords || [])],
      };
    }

    function filterToggle(id, key, active, label) {
      return `<button class="chip-btn${active ? ' on' : ''}" data-action="toggle-column-filter" data-column-id="${escape(id)}" data-filter-key="${key}" aria-pressed="${active}">${label}</button>`;
    }

    function columnFilterSection(id) {
      if (columns.getFilter?.(id) === undefined) return '';
      const filter = currentFilter(id);
      const words = filter.keywords.map((word, index) => `<div class="ng-row">
          <span>${escape(word)}</span>
          <button class="ng-del" data-action="remove-column-filter-word" data-column-id="${escape(id)}" data-word-index="${index}">削除</button>
        </div>`).join('') || '<div class="ng-empty">指定なし（すべて表示）</div>';
      return `<div class="modal-label">表示する投稿</div>
        <div class="chip-row">
          ${filterToggle(id, 'mediaOnly', filter.mediaOnly, '画像・動画だけ')}
          ${filterToggle(id, 'hideReposts', filter.hideReposts, 'リポストを非表示')}
        </div>
        <div class="modal-label">語句を含む投稿だけ（いずれかを含むもの）</div>
        ${words}
        <div class="ng-add-row">
          <input id="col-filter-word-input" class="ng-input" type="text" maxlength="100" placeholder="語句を追加…">
          <button class="ng-add" data-action="add-column-filter-word" data-column-id="${escape(id)}">追加</button>
        </div>`;
    }

    function updateColumnFilter(id, change, { focusWordInput = false } = {}) {
      columns.setFilter?.(id, change(currentFilter(id)));
      openColumnSettings(id, openedColumnTypes.get(id));
      if (focusWordInput) global.setTimeout(() => documentRef.getElementById('col-filter-word-input')?.focus(), 50);
    }

    function toggleColumnFilter(id, key) {
      if (!['mediaOnly', 'hideReposts'].includes(key)) return;
      updateColumnFilter(id, filter => ({ ...filter, [key]: !filter[key] }));
    }

    function addColumnFilterWord(id) {
      const word = String(documentRef.getElementById('col-filter-word-input')?.value || '').trim();
      const filter = currentFilter(id);
      if (!word || filter.keywords.includes(word)) return;
      if (filter.keywords.length >= MAX_FILTER_WORDS) {
        toast(`語句は${MAX_FILTER_WORDS}個まで追加できます`);
        return;
      }
      updateColumnFilter(id, current => ({ ...current, keywords: [...current.keywords, word] }), { focusWordInput: true });
    }

    function removeColumnFilterWord(id, index) {
      updateColumnFilter(id, filter => ({
        ...filter,
        keywords: filter.keywords.filter((_, wordIndex) => wordIndex !== Number(index)),
      }));
    }

    function openColumnSettings(id, colType) {
      openedColumnTypes.set(id, colType);
      const currentSeconds = Math.round((columns.getRefreshInterval?.(id) || 0) / 1000);
      const currentFontSize = columns.getFontSize?.(id) || 13;
      openOverlay('col-settings-ov', `<div class="modal" style="width:300px">
        <h2 style="margin-bottom:14px">カラム設定</h2>
        <div class="modal-label">自動更新の間隔</div>
        <div class="chip-row">
          ${[15, 30, 60, 120, 300, 0].map(seconds => optionButton(
            'apply-column-interval',
            { 'column-id': id, 'interval-ms': seconds * 1000 },
            currentSeconds === seconds,
            intervalLabel(seconds * 1000),
          )).join('')}
        </div>
        <div class="modal-label">文字サイズ</div>
        <div class="chip-row">
          ${[11, 12, 13, 14, 15, 16].map(fontSize => optionButton(
            'apply-column-font-size',
            { 'column-id': id, 'column-type': colType, 'font-size': fontSize },
            currentFontSize === fontSize,
            fontSize + 'px',
          )).join('')}
        </div>
        ${columnFilterSection(id)}
        <button data-action="remove-element" data-target-id="col-settings-ov" class="btn-cancel">閉じる</button>
      </div>`);
      documentRef.getElementById('col-filter-word-input')?.addEventListener?.('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        addColumnFilterWord(id);
      });
    }

    function applyColumnInterval(id, ms) {
      columns.setRefreshInterval?.(id, ms);
      toast(`自動更新: ${intervalLabel(ms)}`);
      closeOverlay('col-settings-ov');
      columns.persistLayout?.();
    }

    function applyColumnFontSize(id, colType, fontSize) {
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
        <div class="mem-total-row">
          <strong class="mem-total">${formatMemoryMb(host.totalKb)}</strong>
          <span>${host.processCount || 0}プロセス</span>
        </div>
        <div class="mem-grid">
          <span>メイン</span><span>${formatMemoryMb(groups.browser)}</span>
          <span>画面・WebView</span><span>${formatMemoryMb(groups.renderer)}</span>
          <span>GPU</span><span>${formatMemoryMb(groups.gpu)}</span>
          <span>その他</span><span>${formatMemoryMb((groups.utility || 0) + (groups.other || 0))}</span>
        </div>
        <div class="mem-runtime">
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
          <div id="memory-metrics" class="mem-metrics">計測中…</div>
          <div class="modal-label">自動整理の間隔</div>
          <div class="chip-row">
            ${[[15 * 60000, '15分'], [30 * 60000, '30分'], [60 * 60000, '1時間'], [120 * 60000, '2時間'], [0, 'OFF']].map(([ms, label]) => optionButton(
              'apply-memory-interval',
              { 'interval-ms': ms },
              current === ms,
              label,
            )).join('')}
          </div>
          <button class="mem-clear-btn" data-action="clear-memory-now">
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
      documentRef.querySelectorAll('.appearance-density').forEach(button => {
        button.classList.toggle('primary', button.dataset.density === current.density);
        button.setAttribute('aria-pressed', String(button.dataset.density === current.density));
      });
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
      toast('外観設定を保存しました');
    }

    return {
      addColumnFilterWord,
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
      removeColumnFilterWord,
      removeNgRule,
      saveAppearance,
      toggleColumnFilter,
    };
  }

  global.SocialDeckSettingsModalsRuntime = { createSettingsModalsRuntime };
})(window);
