(function (global) {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createBlueskyProfileCard({
    adapter,
    documentRef = global.document,
    onOutcome = () => {},
    schedule = global.setTimeout || (callback => callback()),
    cancelSchedule = global.clearTimeout || (() => {}),
    hoverDelay = 300,
  } = {}) {
    if (!adapter) throw new Error('Bluesky Profile Card requires an authenticated adapter');
    let hoverTimer = null;
    let hoverTimerOwnerId = null;
    let cardOwnerId = null;

    function clearHoverTimer(ownerId = null) {
      if (ownerId && hoverTimerOwnerId !== ownerId) return;
      if (hoverTimer !== null) cancelSchedule(hoverTimer);
      hoverTimer = null;
      hoverTimerOwnerId = null;
    }

    function removeCard() {
      documentRef?.getElementById?.('bsky-hover-card')?.remove?.();
      cardOwnerId = null;
    }

    function positionCard(card, target) {
      const rect = target?.getBoundingClientRect?.() || { left: 10, top: 10, bottom: 10 };
      const viewportWidth = Number(global.innerWidth) || 1200;
      const viewportHeight = Number(global.innerHeight) || 800;
      let left = rect.left;
      let top = rect.bottom + 8;
      if (left + 280 > viewportWidth - 10) left = viewportWidth - 290;
      if (top + 220 > viewportHeight - 10) top = rect.top - 228;
      if (left < 10) left = 10;
      if (top < 10) top = 10;
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }

    async function toggleFollow(button) {
      const followUri = button.dataset.followuri || '';
      const active = !followUri;
      const previousText = button.textContent;
      button.disabled = true;
      button.textContent = '...';
      try {
        if (active) {
          const result = await adapter.follow({ targetDid: button.dataset.did });
          button.dataset.followuri = result?.uri || '';
        } else {
          await adapter.unfollow({ followUri });
          button.dataset.followuri = '';
        }
        button.textContent = active ? 'フォロー中' : 'フォロー';
        button.disabled = false;
        onOutcome({
          kind: 'follow',
          status: 'succeeded',
          active,
          handle: button.dataset.handle || '',
        });
      } catch (error) {
        button.textContent = previousText;
        button.disabled = false;
        onOutcome({
          kind: 'follow',
          status: 'failed',
          active,
          handle: button.dataset.handle || '',
          error,
        });
      }
    }

    async function showCard(ownerId, target, profileElement) {
      const actor = profileElement.dataset.did || profileElement.dataset.handle || '';
      if (!actor || !documentRef?.createElement || !documentRef?.body) return;
      removeCard();
      const card = documentRef.createElement('div');
      card.id = 'bsky-hover-card';
      card.className = 'bsky-hover-card';
      card.textContent = 'Loading...';
      cardOwnerId = ownerId;
      documentRef.body.appendChild(card);
      positionCard(card, target);

      try {
        const profile = await adapter.getProfile({ actor });
        if (documentRef.getElementById?.('bsky-hover-card') !== card) return;
        const avatar = profile.avatar
          ? `<img src="${escapeHtml(profile.avatar)}" alt="" style="width:42px;height:42px;border-radius:50%;object-fit:cover">`
          : '<div style="width:42px;height:42px;border-radius:50%;background:var(--bg3)"></div>';
        const following = profile.viewer?.following || '';
        card.innerHTML = `<div style="display:flex;gap:10px;align-items:center">${avatar}<div style="min-width:0;flex:1"><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(profile.displayName || profile.handle || '')}</div><div style="color:var(--text3)">@${escapeHtml(profile.handle || '')}</div></div><button type="button" data-bsky-follow data-did="${escapeHtml(profile.did || '')}" data-handle="${escapeHtml(profile.handle || '')}" data-followuri="${escapeHtml(following)}">${following ? 'フォロー中' : 'フォロー'}</button></div>${profile.description ? `<div style="margin-top:8px;color:var(--text2);line-height:1.4">${escapeHtml(profile.description).slice(0, 180)}</div>` : ''}`;
        positionCard(card, target);
      } catch (error) {
        if (documentRef.getElementById?.('bsky-hover-card') === card) card.textContent = 'Profile load failed';
        onOutcome({ kind: 'profile', status: 'failed', columnId: ownerId, error });
      }

      card.addEventListener?.('click', async event => {
        const button = event.target?.closest?.('[data-bsky-follow]');
        if (!button) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        await toggleFollow(button);
      });
      card.addEventListener?.('pointerenter', () => clearHoverTimer(ownerId));
      card.addEventListener?.('pointerleave', () => scheduleHide(ownerId));
    }

    function scheduleShow(ownerId, target, profileElement) {
      clearHoverTimer();
      hoverTimerOwnerId = ownerId;
      if (hoverDelay <= 0) return showCard(ownerId, target, profileElement);
      hoverTimer = schedule(() => {
        showCard(ownerId, target, profileElement).catch(() => {});
      }, hoverDelay);
    }

    function scheduleHide(ownerId, delay = 150) {
      clearHoverTimer(ownerId);
      hoverTimerOwnerId = ownerId;
      hoverTimer = schedule(() => removeCard(), delay);
    }

    function disposeOwner(ownerId) {
      clearHoverTimer(ownerId);
      if (cardOwnerId === ownerId) removeCard();
    }

    return { disposeOwner, removeCard, scheduleHide, scheduleShow };
  }

  global.SocialDeckBlueskyProfileCard = { createBlueskyProfileCard };
})(window);
