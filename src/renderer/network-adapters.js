(function (global) {
  function createDefinition({ id, network, columnType, label, description, icon, requiresAccount = false, defaultParams = {} }) {
    return {
      id,
      network,
      columnType,
      label,
      description,
      icon,
      requiresAccount,
      defaultParams,
    };
  }

  function createXAdapter({ icons }) {
    return {
      id: 'x',
      label: 'X',
      kind: 'webview-backed',
      capabilities: {
        columns: {
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
        columns: {
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
        return definitions.find(definition => definition.columnType === 'settings') || null;
      }

      return definitions.find(definition => (
        definition.defaultParams.runtimeType === storedColumn.type
        && (!definition.defaultParams.feedUri || definition.defaultParams.feedUri === storedColumn.feedUri)
      )) || null;
    }

    return {
      adapters,
      getAdapter,
      getColumnDefinitions,
      getColumnDefinition,
      resolveColumnDefinition,
    };
  }

  global.SocialDeckNetworkAdapters = {
    createNetworkAdapterRegistry,
  };
})(window);
