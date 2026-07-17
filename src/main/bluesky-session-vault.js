const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const MAX_TOKEN_LENGTH = 16_384;
const MAX_HANDLE_LENGTH = 256;
const MAX_DID_LENGTH = 512;

function readBoundedString(value, { name, maxLength, required = true }) {
  if (typeof value !== 'string') throw new Error(`Invalid Bluesky ${name}`);
  if ((required && !value) || value.length > maxLength) {
    throw new Error(`Invalid Bluesky ${name}`);
  }
  return value;
}

function normalizeSession(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid Bluesky session');
  return {
    handle: readBoundedString(value.handle, { name: 'handle', maxLength: MAX_HANDLE_LENGTH }),
    did: readBoundedString(value.did, { name: 'DID', maxLength: MAX_DID_LENGTH }),
    accessJwt: readBoundedString(value.accessJwt, { name: 'access token', maxLength: MAX_TOKEN_LENGTH }),
    refreshJwt: readBoundedString(value.refreshJwt, {
      name: 'refresh token',
      maxLength: MAX_TOKEN_LENGTH,
      required: false,
    }),
  };
}

function createBlueskySessionVault({ filePath, safeStorage, fsImpl = fs } = {}) {
  if (!filePath || !safeStorage) throw new Error('Bluesky Session Vault requires secure storage');

  function assertEncryptionAvailable() {
    if (!safeStorage.isEncryptionAvailable?.()) {
      throw new Error('Bluesky session encryption is unavailable');
    }
  }

  function save(value) {
    assertEncryptionAvailable();
    const session = normalizeSession(value);
    const payload = JSON.stringify({ version: 1, session });
    const encrypted = safeStorage.encryptString(payload);
    if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
      throw new Error('Bluesky session encryption failed');
    }

    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      fsImpl.writeFileSync(temporaryPath, encrypted, { mode: 0o600 });
      fsImpl.renameSync(temporaryPath, filePath);
    } catch (error) {
      try { fsImpl.unlinkSync(temporaryPath); } catch {}
      throw error;
    }
    return session;
  }

  function load() {
    if (!fsImpl.existsSync(filePath)) return null;
    assertEncryptionAvailable();
    try {
      const encrypted = fsImpl.readFileSync(filePath);
      const payload = JSON.parse(safeStorage.decryptString(encrypted));
      if (payload?.version !== 1) throw new Error('Unsupported Vault version');
      return normalizeSession(payload.session);
    } catch {
      throw new Error('Bluesky session Vault could not be read');
    }
  }

  function clear() {
    try {
      fsImpl.unlinkSync(filePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return true;
  }

  return { clear, load, save };
}

module.exports = {
  createBlueskySessionVault,
  normalizeSession,
};
