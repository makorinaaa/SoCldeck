const MAX_ERROR_MESSAGE_LENGTH = 1_000;
const MAX_ERROR_CODE_LENGTH = 128;

function boundedString(value, fallback, maxLength) {
  if (typeof value !== 'string' || !value) return fallback;
  return value.slice(0, maxLength);
}

function toOperationError(error) {
  return {
    name: error?.name === 'AtprotoError' ? 'AtprotoError' : 'Error',
    message: boundedString(error?.message, 'Bluesky operation failed', MAX_ERROR_MESSAGE_LENGTH),
    status: Number.isInteger(error?.status) ? error.status : 0,
    code: boundedString(error?.code, '', MAX_ERROR_CODE_LENGTH),
  };
}

async function executeBlueskyOperation(gateway, operation, payload) {
  try {
    return { ok: true, data: await gateway.execute(operation, payload) };
  } catch (error) {
    return { ok: false, error: toOperationError(error) };
  }
}

module.exports = {
  executeBlueskyOperation,
  toOperationError,
};
