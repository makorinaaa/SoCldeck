(function (global) {
  function createColumnPicker({
    documentRef = global.document,
    modalId = 'addMod',
    getAccounts = () => ({ x: [], b: null }),
    getColumnDefinitions,
    createColumn,
    ui = {},
    intents = {},
  } = {}) {
    if (typeof getColumnDefinitions !== 'function' || typeof createColumn !== 'function') {
      throw new Error('Column Picker requires column definition and lifecycle boundaries');
    }
    const escape = ui.escape || (value => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;'));
    const toast = intents.toast || (() => {});
    let extraColumnCount = 0;

    function sectionHeading(content, first = false) {
      return `<div style="grid-column:1/-1;font-size:10px;font-weight:600;color:var(--text3);letter-spacing:.06em;margin-top:${first ? 0 : 10}px;padding:4px 0;border-bottom:1px solid var(--border)">${content}</div>`;
    }

    function xOption(definition, accountIndex) {
      return `<button class="opt" data-action="add-column" data-definition-id="${escape(definition.id)}" data-network="x" data-account-index="${accountIndex}">
        <div style="width:16px;height:16px;margin-bottom:5px">${definition.icon}</div>
        <div class="oname">${definition.label}</div>
        <div class="odesc">${definition.description}</div>
      </button>`;
    }

    function option(definition, networkId) {
      return `<button class="opt" data-action="add-column" data-definition-id="${escape(definition.id)}" data-network="${escape(networkId)}">
        <div style="width:16px;height:16px;margin-bottom:5px">${definition.icon}</div>
        <div class="oname">${definition.label}</div>
        <div class="odesc">${definition.description}</div>
      </button>`;
    }

    function buildOptionGrid() {
      const grid = documentRef.getElementById('opt-grid');
      grid.innerHTML = '';
      const accounts = getAccounts();
      const xAccounts = accounts.x || [];

      // X: アカウントごとにセクションを分けて表示
      if (xAccounts.length > 0) {
        const xDefinitions = getColumnDefinitions('x');
        xAccounts.forEach((account, accountIndex) => {
          grid.innerHTML += sectionHeading(`
            <span style="display:inline-flex;align-items:center;gap:5px">
              <span style="width:14px;height:14px;border-radius:50%;background:${account.bg};display:inline-flex;align-items:center;justify-content:center;font-size:7px;color:#000;font-weight:700">${account.initials}</span>
              X · ${escape(account.username)}
            </span>`, accountIndex === 0);
          xDefinitions.forEach(definition => {
            grid.innerHTML += xOption(definition, accountIndex);
          });
        });
      }

      if (accounts.b) {
        if (xAccounts.length > 0) {
          grid.innerHTML += sectionHeading(`Bluesky · @${accounts.b.handle}`);
        }
        getColumnDefinitions('b').filter(definition => definition.picker !== false).forEach(definition => {
          grid.innerHTML += option(definition, 'b');
        });
      }

      grid.innerHTML += sectionHeading('情報');
      getColumnDefinitions('anime').filter(definition => definition.picker !== false).forEach(definition => {
        grid.innerHTML += option(definition, 'anime');
      });
    }

    function open() {
      buildOptionGrid();
      documentRef.getElementById(modalId).classList.add('on');
    }

    function nextColumnId(prefix) {
      let id;
      do {
        extraColumnCount += 1;
        id = `${prefix}-${extraColumnCount}`;
      } while (documentRef.getElementById(`col-${id}`));
      return id;
    }

    function addColumn(definitionId, networkId, accountIndex) {
      intents.close?.(modalId);
      // X: アカウントindexをIDに含めて一意にする
      const id = networkId === 'x'
        ? nextColumnId(`x${accountIndex}-${definitionId}`)
        : nextColumnId(definitionId);
      const xAccount = networkId === 'x' ? (getAccounts().x || [])[accountIndex ?? 0] : null;
      const result = createColumn({
        networkId,
        definitionId,
        id,
        account: xAccount ? { ...xAccount, index: accountIndex ?? 0 } : null,
      });

      if (result.status === 'input-required' && result.plan.input === 'x-list') {
        intents.requestXListInput?.(accountIndex);
        return;
      }
      if (result.status !== 'created') {
        toast('Column type is unavailable');
        return;
      }

      const columns = documentRef.getElementById('cols');
      const lastColumn = columns.querySelector('.col:last-of-type');
      if (lastColumn) lastColumn.scrollIntoView({ behavior: 'smooth', inline: 'end' });
      toast('Column added');
    }

    return { addColumn, open };
  }

  global.SocialDeckColumnPicker = { createColumnPicker };
})(window);
