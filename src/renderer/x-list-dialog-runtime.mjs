function createXListDialogRuntime({ documentRef, getAccounts, esc, icon, toast, nextColumnId, createColumn }) {
  function openXListDialog(accountIdx) {
    documentRef.getElementById('x-list-dialog-ov')?.remove();
    const ov = documentRef.createElement('div');
    ov.className = 'ov on'; ov.id = 'x-list-dialog-ov';
    ov.onclick = e => { if (e.target === ov) ov.remove(); };

    const acc = getAccounts()?.[accountIdx ?? 0];
    const accLabel = acc ? ` (${acc.username})` : '';

    ov.innerHTML = `
      <div class="modal" style="width:400px">
        <h2 style="margin-bottom:6px;display:flex;align-items:center;gap:8px">
          ${icon.replace('viewBox', 'width="15" height="15" viewBox')}
          X リストを追加${esc(accLabel)}
        </h2>
        <p style="font-size:12px;color:var(--text2);margin-bottom:16px">リストの URL か ID を入力してください。</p>
        <div class="lf" style="margin-bottom:6px">
          <label>リストの URL / ID</label>
          <input type="text" id="x-list-input" placeholder="https://x.com/i/lists/123456789 または 123456789"
            style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;font-size:13px;color:var(--text1);font-family:inherit;outline:none"
            data-keydown-action="confirm-x-list" data-action-key="Enter" data-account-index="${accountIdx}">
        </div>
        <div class="lf" style="margin-bottom:16px">
          <label>カラム名（任意）</label>
          <input type="text" id="x-list-name" placeholder="マイリスト"
            style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;font-size:13px;color:var(--text1);font-family:inherit;outline:none"
            data-keydown-action="confirm-x-list" data-action-key="Enter" data-account-index="${accountIdx}">
        </div>
        <div style="display:flex;gap:8px">
          <button data-action="remove-element" data-target-id="x-list-dialog-ov" class="btn-cancel" style="flex:1">キャンセル</button>
          <button data-action="confirm-x-list" data-account-index="${accountIdx}" style="flex:1;padding:9px;border-radius:7px;background:var(--accent);border:none;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">追加</button>
        </div>
      </div>`;
    documentRef.body.appendChild(ov);
    documentRef.getElementById('x-list-input')?.focus();
  }

  function confirmXList(accountIdx) {
    const raw = documentRef.getElementById('x-list-input')?.value?.trim();
    const nameInput = documentRef.getElementById('x-list-name')?.value?.trim();
    if (!raw) { toast('リストの URL か ID を入力してください'); return; }

    let listId = raw;
    const m = raw.match(/lists\/([0-9]+)/);
    if (m) listId = m[1];
    // 数字のみでなければエラー
    if (!/^[0-9]+$/.test(listId)) { toast('正しいリストの URL か ID を入力してください'); return; }

    const url = `https://x.com/i/lists/${listId}`;
    const title = nameInput || `リスト ${listId}`;
    const acc = getAccounts()?.[accountIdx ?? 0];
    const xPart = acc?.partition || `persist:x-${accountIdx ?? 0}`;
    const accLabel = acc ? ` - ${acc.username}` : '';

    const id = nextColumnId(`x${accountIdx}-list-${listId}`);
    const result = createColumn({
      networkId: 'x',
      definitionId: 'x-list-new',
      id,
      account: acc ? { ...acc, index: accountIdx ?? 0, partition: xPart } : null,
      params: { url, title, sub: `X${accLabel}` },
    });
    if (result.status !== 'created') {
      toast('リストカラムを追加できませんでした');
      return;
    }

    documentRef.getElementById('x-list-dialog-ov')?.remove();
    const cols = documentRef.getElementById('cols');
    const lastCol = cols.querySelector('.col:last-of-type');
    if (lastCol) lastCol.scrollIntoView({ behavior: 'smooth', inline: 'end' });
    toast('リストカラムを追加しました');
  }
  return { openXListDialog, confirmXList };
}

export { createXListDialogRuntime };
