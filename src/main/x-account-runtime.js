const LEGACY_X_PARTITION = 'persist:x';

function isXPartition(partition) {
  return typeof partition === 'string' && /^persist:x(?:-\d+)?$/.test(partition);
}

function createXAccountRuntime({ getSession, applyAdBlock, logger = console }) {
  let partitions = new Set([LEGACY_X_PARTITION]);
  const adBlockApplied = new Set();
  let adBlockEnabled = false;

  function getPartitions() {
    return [...partitions];
  }

  function applyAdBlockSafely(partition) {
    if (!adBlockEnabled || adBlockApplied.has(partition)) return;
    try {
      applyAdBlock(getSession(partition));
      adBlockApplied.add(partition);
    } catch (error) {
      logger.error('[XAccountRuntime] AdBlock apply failed', partition, error);
    }
  }

  function sync(nextPartitions = []) {
    partitions = new Set([
      LEGACY_X_PARTITION,
      ...nextPartitions.filter(isXPartition),
    ]);
    partitions.forEach(applyAdBlockSafely);
    return getPartitions();
  }

  function register(partition) {
    if (!isXPartition(partition)) return false;
    partitions.add(partition);
    applyAdBlockSafely(partition);
    return true;
  }

  function enableAdBlock() {
    adBlockEnabled = true;
    partitions.forEach(applyAdBlockSafely);
  }

  async function clearPartitionData(partition) {
    if (!isXPartition(partition)) return false;
    try {
      const targetSession = getSession(partition);
      await targetSession.clearStorageData();
      await targetSession.clearCache();
      await targetSession.clearAuthCache();
      if (partition !== LEGACY_X_PARTITION) partitions.delete(partition);
      return true;
    } catch (error) {
      logger.error('[XAccountRuntime] Data clear failed', partition, error);
      return false;
    }
  }

  async function clearAll() {
    const results = await Promise.all(getPartitions().map(clearPartitionData));
    partitions = new Set([LEGACY_X_PARTITION]);
    return results.every(Boolean);
  }

  async function clearCaches() {
    const results = await Promise.all(getPartitions().map(async partition => {
      try {
        await getSession(partition).clearCache();
        return true;
      } catch (error) {
        logger.error('[XAccountRuntime] Cache clear failed', partition, error);
        return false;
      }
    }));
    return results.every(Boolean);
  }

  return {
    sync,
    register,
    enableAdBlock,
    clearPartitionData,
    clearAll,
    clearCaches,
    getPartitions,
  };
}

module.exports = {
  LEGACY_X_PARTITION,
  isXPartition,
  createXAccountRuntime,
};
