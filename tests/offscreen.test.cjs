const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
for (const succeeds of [true, false]) test(`offscreen copy ${succeeds ? 'succeeds' : 'rejects'} and clears temporary text`, () => {
  let listener;
  const field = { value: '', select() { this.selected = true; }, blur() {} };
  const context = vm.createContext({ setTimeout, clearTimeout, chrome: { runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } } } }, document: { getElementById() { return field; }, execCommand(command) { assert.equal(command, 'copy'); assert.equal(field.value, 'chrome://settings/'); assert.equal(field.selected, true); return succeeds; } } });
  vm.runInContext(fs.readFileSync(require.resolve('../offscreen.js'), 'utf8'), context);
  let response;
  listener({ target: 'offscreen', type: 'copy-url', text: 'chrome://settings/' }, { id: 'test' }, result => { response = result; });
  assert.equal(response.ok, succeeds);
  assert.equal(field.value, '');
  response = undefined;
  listener({ target: 'offscreen', type: 'copy-url', text: 'ignored' }, { id: 'foreign' }, result => { response = result; });
  assert.equal(response, undefined);
});
