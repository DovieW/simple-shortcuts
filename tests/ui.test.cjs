const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require.resolve('../shortcut-ui.js'), 'utf8'), context);

test('Mac Control and Command are distinct', () => {
  assert.equal(vm.runInContext("formatShortcut('MacCtrl+Shift+K')", context), 'Control + Shift + K');
  assert.equal(vm.runInContext("formatShortcut('Command+K')", context), 'Cmd + K');
  assert.equal(vm.runInContext("formatShortcut('Ctrl+Shift+K')", context), 'Ctrl + Shift + K');
});
test('search matches command descriptions, keys and categories', () => {
  assert.equal(vm.runInContext("matchesCommand({name:'copy-url',description:'Copy current tab URL',shortcut:'Ctrl+Shift+C'},'navigation')", context), true);
  assert.equal(vm.runInContext("matchesCommand({name:'copy-url',description:'Copy current tab URL',shortcut:'Ctrl+Shift+C'},'  COPY  ')", context), true);
  assert.equal(vm.runInContext("matchesCommand({name:'copy-url',description:'Copy current tab URL'},'media')", context), false);
});
test('every manifest command has a handler and at most four defaults', () => {
  const manifest = JSON.parse(fs.readFileSync(require.resolve('../manifest.json'), 'utf8'));
  const { createHarness } = require('./chrome-mock.cjs');
  const h = createHarness();
  for (const name of Object.keys(manifest.commands)) assert.equal(h.evaluate(`typeof handlers[${JSON.stringify(name)}]`), 'function', name);
  assert.ok(Object.values(manifest.commands).filter(command => command.suggested_key).length <= 4);
  assert.equal(manifest.permissions.includes('activeTab'), true);
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
});
