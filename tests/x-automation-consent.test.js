const assert = require('node:assert/strict');
const test = require('node:test');

const load = () => import('../src/renderer/x-automation-consent.mjs');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function createDocument() {
  const elements = new Map();
  return {
    elements,
    getElementById: id => elements.get(id) || null,
    createElement: () => {
      const element = {
        id: '', className: '', innerHTML: '',
        remove() { elements.delete(element.id); },
      };
      return element;
    },
    body: { appendChild: element => elements.set(element.id, element) },
  };
}

test('keeps the decision apart from the workspace and starts undecided', async () => {
  const { createXAutomationSetting } = await load();
  const storage = createStorage();
  const setting = createXAutomationSetting({ storage });

  assert.equal(setting.get(), 'unset');
  assert.equal(setting.isEnabled(), false);
  setting.set('enabled');
  assert.equal(storage.values.get('socialdeck_x_automation'), 'enabled');
  assert.equal(setting.isEnabled(), true);
  setting.set('nonsense');
  assert.equal(setting.get(), 'enabled');

  assert.equal(createXAutomationSetting({ storage: createStorage({ socialdeck_x_automation: 'broken' }) }).get(), 'unset');
  assert.equal(createXAutomationSetting({ storage: createStorage(), fallback: 'disabled' }).get(), 'disabled');
  assert.equal(createXAutomationSetting({ storage: createStorage({ socialdeck_x_automation: 'enabled' }), fallback: 'disabled' }).get(), 'enabled');
  assert.equal(createXAutomationSetting({ storage: { getItem() { throw new Error('denied'); } } }).get(), 'unset');
});

test('asks once when there is an X account and no decision yet', async () => {
  const { needsXAutomationDecision } = await load();

  assert.equal(needsXAutomationDecision('unset', [{ username: '@a' }]), true);
  assert.equal(needsXAutomationDecision('unset', []), false);
  assert.equal(needsXAutomationDecision('disabled', [{ username: '@a' }]), false);
  assert.equal(needsXAutomationDecision('enabled', [{ username: '@a' }]), false);
});

test('explains the risk, links X rules and offers both choices', async () => {
  const { createXAutomationConsent } = await load();
  const documentRef = createDocument();
  const consent = createXAutomationConsent({ documentRef, getDecision: () => 'disabled' });

  consent.open();
  const html = documentRef.getElementById('x-automation-ov').innerHTML;
  assert.match(html, /API 以外の自動化/);
  assert.match(html, /永久凍結/);
  assert.match(html, /href="https:\/\/help\.x\.com\/en\/rules-and-policies\/x-automation"/);
  assert.match(html, /href="https:\/\/x\.com\/en\/tos"/);
  assert.match(html, /data-action="decide-x-automation" data-decision="enabled"/);
  assert.match(html, /data-action="decide-x-automation" data-decision="disabled"/);
  assert.match(html, /現在: 使わない/);

  consent.close();
  assert.equal(documentRef.getElementById('x-automation-ov'), null);
});
