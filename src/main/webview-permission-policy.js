const configuredSessions = new WeakSet();

function denyWebviewPermissions(targetSession) {
  if (!targetSession || typeof targetSession !== 'object') return false;
  if (configuredSessions.has(targetSession)) return false;
  if (typeof targetSession.setPermissionCheckHandler !== 'function') return false;
  if (typeof targetSession.setPermissionRequestHandler !== 'function') return false;

  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  configuredSessions.add(targetSession);
  return true;
}

module.exports = { denyWebviewPermissions };
