const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  AUTO_CHECK_DELAY_MS,
  AUTO_CHECK_INTERVAL_MS,
  createAppUpdater,
} = require('../src/main/app-updater');

function setup({ packaged = true, shouldInstallFromPrompt = false } = {}) {
  const updater = new EventEmitter();
  const sent = [];
  const prompts = [];
  const timeouts = [];
  const intervals = [];
  updater.checkForUpdates = async () => {};
  updater.quitAndInstall = (...args) => {
    updater.installed = true;
    updater.installArgs = args;
  };
  const controller = createAppUpdater({
    autoUpdater: updater,
    app: { isPackaged: packaged },
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (channel, value) => sent.push({ channel, value }) },
    }),
    showUpdatePrompt: async details => {
      prompts.push(details);
      return shouldInstallFromPrompt;
    },
    setTimeoutFn: (fn, delay) => timeouts.push({ fn, delay }),
    setIntervalFn: (fn, delay) => intervals.push({ fn, delay }),
  });
  return { updater, controller, sent, prompts, timeouts, intervals };
}

test('starts delayed and periodic checks only for packaged builds', () => {
  const packaged = setup();
  packaged.controller.start();
  assert.equal(packaged.timeouts[0].delay, AUTO_CHECK_DELAY_MS);
  assert.equal(packaged.intervals[0].delay, AUTO_CHECK_INTERVAL_MS);

  const development = setup({ packaged: false });
  development.controller.start();
  assert.equal(development.timeouts.length, 0);
  assert.equal(development.intervals.length, 0);
});

test('reports a downloaded update and installs only after download', () => {
  const { updater, controller, sent } = setup();
  controller.start();
  assert.equal(controller.install(), false);
  updater.emit('update-downloaded', { version: '2.1.1' });
  assert.deepEqual(sent.at(-1), {
    channel: 'update-status',
    value: { status: 'downloaded', version: '2.1.1' },
  });
  assert.equal(controller.install(), true);
  assert.equal(updater.installed, true);
  assert.deepEqual(updater.installArgs, [true, true]);
});

test('prompts once for a downloaded startup update and installs only when accepted', async () => {
  const accepted = setup({ shouldInstallFromPrompt: true });
  accepted.controller.start();
  accepted.updater.emit('update-downloaded', { version: '2.4.5' });
  accepted.updater.emit('update-downloaded', { version: '2.4.5' });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(accepted.prompts, [{ version: '2.4.5' }]);
  assert.equal(accepted.updater.installed, true);

  const deferred = setup();
  deferred.controller.start();
  deferred.updater.emit('update-downloaded', { version: '2.4.5' });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(deferred.prompts, [{ version: '2.4.5' }]);
  assert.equal(deferred.updater.installed, undefined);
  assert.equal(deferred.controller.install(), true);
});

test('shows errors for manual checks but keeps automatic failures quiet', async () => {
  const { updater, controller, sent } = setup();
  updater.checkForUpdates = async () => { throw new Error('offline'); };
  await controller.check();
  assert.equal(sent.length, 0);
  await controller.check({ manual: true });
  assert.equal(sent[0].value.status, 'checking');
  assert.equal(sent[1].value.status, 'error');
});
