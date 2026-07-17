(function (global) {
  function credentialsFrom(value) {
    if (!value || typeof value !== 'object') return null;
    const credentials = {
      handle: value.handle,
      did: value.did,
      accessJwt: value.accessJwt,
      refreshJwt: value.refreshJwt,
    };
    if (!credentials.handle || !credentials.did || !credentials.accessJwt) return null;
    return credentials;
  }

  function toWorkspaceAccount(value) {
    if (!value || typeof value !== 'object') return null;
    const { accessJwt, refreshJwt, ...account } = value;
    return account;
  }

  function createBlueskySessionRuntime({ vault } = {}) {
    if (!vault?.store || !vault?.load || !vault?.clear) {
      throw new Error('Bluesky Session Runtime requires a Vault adapter');
    }

    async function initialize(workspaceAccount) {
      if (!workspaceAccount) {
        await vault.clear();
        return { status: 'empty', account: null, workspaceAccount: null };
      }

      const legacyCredentials = credentialsFrom(workspaceAccount);
      if (legacyCredentials) {
        await vault.store(legacyCredentials);
        const publicAccount = toWorkspaceAccount(workspaceAccount);
        return {
          status: 'migrated',
          account: publicAccount,
          workspaceAccount: publicAccount,
        };
      }

      const storedCredentials = await vault.load();
      if (!storedCredentials) {
        return { status: 'missing', account: null, workspaceAccount: null };
      }
      if (storedCredentials.did !== workspaceAccount.did) {
        await vault.clear();
        return { status: 'mismatch', account: null, workspaceAccount: null };
      }
      return {
        status: 'restored',
        account: toWorkspaceAccount(workspaceAccount),
        workspaceAccount: toWorkspaceAccount(workspaceAccount),
      };
    }

    return {
      clear: () => vault.clear(),
      initialize,
      toWorkspaceAccount,
    };
  }

  global.SocialDeckBlueskySessionRuntime = {
    createBlueskySessionRuntime,
    toWorkspaceAccount,
  };
})(window);
