(function (global) {
  const EVENT_BINDINGS = {
    click: { attribute: 'data-action', key: 'action' },
    input: { attribute: 'data-input-action', key: 'inputAction' },
    change: { attribute: 'data-change-action', key: 'changeAction' },
    dblclick: { attribute: 'data-dblclick-action', key: 'dblclickAction' },
    keydown: { attribute: 'data-keydown-action', key: 'keydownAction' },
  };

  function createDelegatedActionRuntime({ root = global.document, actions = {} } = {}) {
    if (!root?.addEventListener || !root?.removeEventListener) {
      throw new Error('Delegated Action Runtime requires an event root');
    }
    const listeners = [];

    Object.entries(EVENT_BINDINGS).forEach(([eventType, binding]) => {
      const listener = event => {
        const target = event.target?.closest?.(`[${binding.attribute}]`);
        if (!target || target.disabled) return;
        if (eventType === 'keydown' && target.dataset.actionKey && event.key !== target.dataset.actionKey) {
          return;
        }
        const action = actions[target.dataset[binding.key]];
        if (typeof action !== 'function') return;
        if (target.dataset.preventDefault === 'true') event.preventDefault?.();
        if (target.dataset.stopPropagation === 'true') event.stopPropagation?.();
        const result = action({ dataset: target.dataset, event, target, value: target.value });
        if (result?.catch) result.catch(error => global.console?.error?.('UI action failed:', error));
      };
      root.addEventListener(eventType, listener);
      listeners.push([eventType, listener]);
    });

    return {
      dispose() {
        listeners.splice(0).forEach(([eventType, listener]) => {
          root.removeEventListener(eventType, listener);
        });
      },
    };
  }

  global.SocialDeckDelegatedActionRuntime = { createDelegatedActionRuntime };
})(window);
