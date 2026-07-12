(function (global) {
  function createDefinition({ id, network, columnType, label, description, icon, requiresAccount = false, defaultParams = {}, picker = true }) {
    return {
      id,
      network,
      columnType,
      label,
      description,
      icon,
      requiresAccount,
      defaultParams,
      picker,
    };
  }

  function getIconClass(columnType, network) {
    if (columnType === 'notifications') return 'ic-n';
    if (columnType === 'search' || columnType === 'settings') return 'ic-s';
    return network === 'b' ? 'ic-b' : 'ic-x';
  }

  function getStoredValue(storedColumn, key, fallback) {
    return storedColumn?.[key] || fallback;
  }

  function createXColumnPlan({ definition, id, account, storedColumn, params = {} }) {
    if (definition.columnType === 'list' && !storedColumn?.url && !params.url) {
      return { kind: 'input-required', input: 'x-list' };
    }

    const accountIndex = account?.index ?? 0;
    const accountLabel = account?.username ? ` · ${account.username}` : '';
    const url = definition.columnType === 'list'
      ? storedColumn?.url || params.url
      : definition.defaultParams.url || storedColumn?.url;
    return {
      kind: 'wv',
      refresh: { networkId: 'x', kind: 'webview' },
      partition: getStoredValue(storedColumn, 'partition', account?.partition || `persist:x-${accountIndex}`),
      config: {
        id,
        title: getStoredValue(storedColumn, 'title', params.title || definition.label),
        sub: getStoredValue(storedColumn, 'sub', params.sub || `X${accountLabel}`),
        url,
        icCls: getIconClass(definition.columnType, definition.network),
        icon: definition.icon,
        network: definition.network,
        definitionId: definition.id,
      },
    };
  }

  function createBlueskyColumnPlan({ definition, id, storedColumn, params = {} }) {
    const commonConfig = {
      id,
      title: getStoredValue(storedColumn, 'title', params.title || definition.label),
      sub: getStoredValue(storedColumn, 'sub', params.sub || 'Bluesky'),
      icCls: getIconClass(definition.columnType, definition.network),
      icon: definition.icon,
      network: definition.network,
      definitionId: definition.id,
    };

    if (definition.columnType === 'settings' || definition.columnType === 'profile') {
      return {
        kind: 'wv',
        refresh: { networkId: 'b', kind: 'webview' },
        partition: getStoredValue(storedColumn, 'partition', 'persist:bsky'),
        config: {
          ...commonConfig,
          url: storedColumn?.url || params.url || definition.defaultParams.url,
        },
      };
    }

    const type = definition.defaultParams.runtimeType || storedColumn?.type;
    const feedUri = storedColumn?.feedUri || definition.defaultParams.feedUri || null;
    return {
      kind: 'bsky',
      refresh: { networkId: 'b', kind: 'feed', type, feedUri },
      config: {
        ...commonConfig,
        type,
        feedUri,
      },
    };
  }

  function prepareXComposeDelivery(request) {
    const imageFiles = request.attachments
      .filter(attachment => attachment.kind === 'image')
      .map(attachment => attachment.file);
    const videoAttachment = request.attachments
      .find(attachment => attachment.kind === 'video');
    if (imageFiles.length > 0 && videoAttachment) {
      throw new Error('X compose delivery cannot mix image and video attachments');
    }

    return {
      kind: 'x-webview',
      accountId: request.target.accountId,
      text: request.text,
      imageFiles,
      video: videoAttachment
        ? {
            file: videoAttachment.file,
            trim: { ...videoAttachment.trim },
          }
        : null,
    };
  }

  function prepareXComposeCompletion(request) {
    return {
      message: `Posted to ${request.target.accountId}`,
      refresh: {
        kind: 'x-account-columns',
        accountId: request.target.accountId,
      },
      delayMs: 2500,
    };
  }

  function prepareBlueskyComposeDelivery(request) {
    const hasUnsupportedAttachment = request.attachments
      .some(attachment => attachment.kind !== 'image');
    if (hasUnsupportedAttachment) {
      throw new Error('Bluesky compose delivery only supports image attachments');
    }

    return {
      kind: 'bsky-atproto',
      repoDid: request.target.accountId,
      text: request.text,
      images: request.attachments.map(attachment => ({
        file: attachment.file,
        alt: attachment.altText,
      })),
      reply: request.replyTo
        ? {
            root: { ...request.replyTo.root },
            parent: { ...request.replyTo.parent },
          }
        : null,
    };
  }

  function prepareBlueskyComposeCompletion(request) {
    return {
      message: 'Posted to Bluesky',
      refresh: {
        kind: 'bsky-timelines',
        accountId: request.target.accountId,
      },
      delayMs: 1000,
    };
  }

  async function refreshXColumn({ id, operations }) {
    const result = await operations.refreshXTimeline(id);
    if (result === 'deferred' || result === 'queued' || result === 'not-following') {
      return { status: 'deferred', detail: result };
    }
    if (result === 'clicked' || result === 'tab-toggled') {
      return { status: 'succeeded', detail: result };
    }
    operations.reloadWebView(id);
    return { status: 'succeeded', detail: 'reloaded' };
  }

  async function refreshBlueskyColumn({ id, plan, operations }) {
    if (plan.kind === 'webview') {
      operations.reloadWebView(id);
      return { status: 'succeeded', detail: 'reloaded' };
    }
    return await operations.refreshBlueskyFeed(id, plan.type, plan.feedUri)
      || { status: 'succeeded' };
  }

  function createXAdapter({ icons }) {
    return {
      id: 'x',
      label: 'X',
      kind: 'webview-backed',
      capabilities: {
        compose: {
          prepareDelivery: prepareXComposeDelivery,
          prepareCompletion: prepareXComposeCompletion,
        },
        columns: {
          createPlan: createXColumnPlan,
          refresh: refreshXColumn,
          definitions: [
            createDefinition({
              id: 'x-home-new',
              network: 'x',
              columnType: 'timeline',
              label: 'Home',
              description: 'x.com/home',
              icon: icons.x,
              requiresAccount: true,
              defaultParams: { url: 'https://x.com/home' },
            }),
            createDefinition({
              id: 'x-notif-new',
              network: 'x',
              columnType: 'notifications',
              label: 'Notifications',
              description: 'x.com/notifications',
              icon: icons.bell,
              requiresAccount: true,
              defaultParams: { url: 'https://x.com/notifications' },
            }),
            createDefinition({
              id: 'x-search-new',
              network: 'x',
              columnType: 'search',
              label: 'Search',
              description: 'x.com/search',
              icon: icons.x,
              requiresAccount: true,
              defaultParams: { url: 'https://x.com/search' },
            }),
            createDefinition({
              id: 'x-list-new',
              network: 'x',
              columnType: 'list',
              label: 'List',
              description: 'x.com/i/lists',
              icon: icons.x,
              requiresAccount: true,
              defaultParams: { url: 'https://x.com/i/lists' },
            }),
            createDefinition({
              id: 'x-settings',
              network: 'x',
              columnType: 'settings',
              label: 'Settings',
              description: 'x.com/settings',
              icon: icons.gear,
              requiresAccount: true,
              defaultParams: { url: 'https://x.com/settings' },
            }),
          ],
        },
      },
    };
  }

  function createBlueskyAdapter({ icons }) {
    return {
      id: 'b',
      label: 'Bluesky',
      kind: 'api-backed',
      capabilities: {
        compose: {
          prepareDelivery: prepareBlueskyComposeDelivery,
          prepareCompletion: prepareBlueskyComposeCompletion,
        },
        columns: {
          createPlan: createBlueskyColumnPlan,
          refresh: refreshBlueskyColumn,
          definitions: [
            createDefinition({
              id: 'b-timeline-new',
              network: 'b',
              columnType: 'timeline',
              label: 'Timeline',
              description: 'Real-time feed',
              icon: icons.bsky,
              requiresAccount: true,
              defaultParams: { runtimeType: 'timeline' },
            }),
            createDefinition({
              id: 'b-notif-new',
              network: 'b',
              columnType: 'notifications',
              label: 'Notifications',
              description: 'Real-time notifications',
              icon: icons.bell,
              requiresAccount: true,
              defaultParams: { runtimeType: 'notif' },
            }),
            createDefinition({
              id: 'b-search-new',
              network: 'b',
              columnType: 'search',
              label: 'Search',
              description: 'Keyword search',
              icon: icons.bsky,
              requiresAccount: true,
              defaultParams: { runtimeType: 'search' },
            }),
            createDefinition({
              id: 'b-discover',
              network: 'b',
              columnType: 'feed',
              label: 'Discover',
              description: 'Recommended feed',
              icon: icons.bsky,
              requiresAccount: true,
              defaultParams: {
                runtimeType: 'feed',
                feedUri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot',
              },
            }),
            createDefinition({
              id: 'b-profile',
              network: 'b',
              columnType: 'profile',
              label: 'Profile',
              description: 'Bluesky profile',
              icon: icons.bsky,
              requiresAccount: true,
              picker: false,
            }),
            createDefinition({
              id: 'b-settings',
              network: 'b',
              columnType: 'settings',
              label: 'Bsky Settings',
              description: 'bsky.app/settings',
              icon: icons.gear,
              requiresAccount: true,
              defaultParams: { url: 'https://bsky.app/settings' },
            }),
          ],
        },
      },
    };
  }

  function createNetworkAdapterRegistry({ icons }) {
    const adapters = [
      createXAdapter({ icons }),
      createBlueskyAdapter({ icons }),
    ];

    function getAdapter(id) {
      return adapters.find(adapter => adapter.id === id) || null;
    }

    function getCapability(networkId, capabilityId) {
      return getAdapter(networkId)?.capabilities?.[capabilityId] || null;
    }

    function getColumnDefinitions(networkId) {
      const adapter = getAdapter(networkId);
      return adapter?.capabilities?.columns?.definitions || [];
    }

    function getColumnDefinition(networkId, definitionId) {
      return getColumnDefinitions(networkId)
        .find(definition => definition.id === definitionId) || null;
    }

    function inferNetwork(storedColumn) {
      if (storedColumn.network) return storedColumn.network;
      if (storedColumn.kind === 'bsky') return 'b';
      if (storedColumn.partition === 'persist:bsky') return 'b';
      return storedColumn.kind === 'wv' ? 'x' : null;
    }

    function getXColumnTypeFromUrl(value) {
      try {
        const path = new URL(value).pathname.replace(/\/$/, '');
        if (path === '/home') return 'timeline';
        if (path.startsWith('/notifications')) return 'notifications';
        if (path.startsWith('/search')) return 'search';
        if (path.startsWith('/i/lists')) return 'list';
        if (path.startsWith('/settings')) return 'settings';
      } catch {}
      return null;
    }

    function resolveColumnDefinition(storedColumn = {}) {
      const networkId = inferNetwork(storedColumn);
      if (!networkId) return null;

      if (storedColumn.definitionId) {
        const declared = getColumnDefinition(networkId, storedColumn.definitionId);
        if (declared) return declared;
      }

      const definitions = getColumnDefinitions(networkId);
      if (networkId === 'x') {
        const columnType = getXColumnTypeFromUrl(storedColumn.url);
        return definitions.find(definition => definition.columnType === columnType) || null;
      }

      if (storedColumn.kind === 'wv') {
        if (storedColumn.url?.includes('/settings')) {
          return definitions.find(definition => definition.columnType === 'settings') || null;
        }
        if (storedColumn.url?.includes('/profile/')) {
          return definitions.find(definition => definition.columnType === 'profile') || null;
        }
        return null;
      }

      return definitions.find(definition => (
        definition.defaultParams.runtimeType === storedColumn.type
        && (!definition.defaultParams.feedUri || definition.defaultParams.feedUri === storedColumn.feedUri)
      )) || null;
    }

    function createColumnPlan({ networkId, definitionId, id, account, storedColumn, params } = {}) {
      const definition = storedColumn
        ? resolveColumnDefinition(storedColumn)
        : getColumnDefinition(networkId, definitionId);
      if (!definition) return null;

      const adapter = getAdapter(definition.network);
      return adapter?.capabilities?.columns?.createPlan({
        definition,
        id: id || storedColumn?.id,
        account,
        storedColumn,
        params,
      }) || null;
    }

    function prepareComposeDelivery(request) {
      const networkId = request?.target?.networkId;
      const compose = getCapability(networkId, 'compose');
      if (!compose?.prepareDelivery) {
        throw new Error(`Compose capability is unavailable for network: ${networkId || 'missing'}`);
      }
      return compose.prepareDelivery(request);
    }

    function prepareComposeCompletion(request) {
      const networkId = request?.target?.networkId;
      const compose = getCapability(networkId, 'compose');
      if (!compose?.prepareCompletion) {
        throw new Error(`Compose completion is unavailable for network: ${networkId || 'missing'}`);
      }
      return compose.prepareCompletion(request);
    }

    function executeColumnRefresh(id, plan, operations) {
      const refresh = getCapability(plan?.networkId, 'columns')?.refresh;
      if (!refresh) throw new Error(`Column refresh is unavailable for network: ${plan?.networkId || 'missing'}`);
      return refresh({ id, plan, operations });
    }

    return {
      adapters,
      getAdapter,
      getCapability,
      getColumnDefinitions,
      getColumnDefinition,
      resolveColumnDefinition,
      createColumnPlan,
      executeColumnRefresh,
      prepareComposeDelivery,
      prepareComposeCompletion,
    };
  }

  global.SocialDeckNetworkAdapters = {
    createNetworkAdapterRegistry,
  };
})(window);
