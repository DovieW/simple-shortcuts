const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
  const stored = {};
  const context = vm.createContext({ TextEncoder, chrome: { storage: { sync: {
    async get(keys) { return Object.fromEntries(keys.filter(key => Object.hasOwn(stored, key)).map(key => [key, structuredClone(stored[key])])); },
    async set(data) { Object.assign(stored, structuredClone(data)); }
  } } } });
  vm.runInContext(fs.readFileSync(require.resolve('../shortcut-memory.js'), 'utf8'), context);
  return { stored, context, evaluate(code) { return vm.runInContext(code, context); } };
}
test('snapshot retains explicit unassigned keys and ignores the reserved action command', () => {
  const h = harness();
  const snapshot = h.evaluate("makeShortcutSnapshot([{name:'copy-url',shortcut:'Ctrl+Shift+C'},{name:'toggle-pin-tab',shortcut:''},{name:'_execute_action',shortcut:'Alt+A'}],'linux',123)");
  assert.equal(snapshot.bindings['copy-url'], 'Ctrl+Shift+C');
  assert.equal(snapshot.bindings['toggle-pin-tab'], '');
  assert.equal(Object.hasOwn(snapshot.bindings, '_execute_action'), false);
  assert.equal(snapshot.savedAt, 123);
});
test('comparison distinguishes matching, missing, changed and newly added commands', () => {
  const h = harness();
  h.evaluate("globalThis.snapshot=makeShortcutSnapshot([{name:'copy-url',shortcut:'Ctrl+Shift+C'},{name:'toggle-pin-tab',shortcut:''}],'linux',123)");
  for (const [name, shortcut, expected] of [ ['copy-url', 'Ctrl+Shift+C', 'matching'], ['copy-url', '', 'missing'], ['copy-url', 'Alt+C', 'changed'], ['toggle-pin-tab', '', 'matching'], ['toggle-pin-tab', 'Alt+N', 'changed'], ['copy-screenshot', '', 'new'] ]) {
    h.context.command = { name, shortcut };
    assert.equal(h.evaluate('shortcutDifference(command,snapshot)'), expected);
  }
  assert.equal(h.evaluate("snapshotDifferences([{name:'copy-url',shortcut:''},{name:'copy-screenshot',shortcut:''},{name:'toggle-pin-tab',shortcut:''}],snapshot).length"), 1);
});
test('platform snapshots coexist and empty bindings from another browser do not overwrite them on read', async () => {
  const h = harness();
  await h.evaluate("saveShortcutSnapshot(makeShortcutSnapshot([{name:'copy-url',shortcut:'Ctrl+Shift+C'}],'linux',123))");
  await h.evaluate("saveShortcutSnapshot(makeShortcutSnapshot([{name:'copy-url',shortcut:'Command+Shift+C'}],'mac',456))");
  const snapshots = await h.evaluate('readShortcutSnapshots()');
  assert.equal(snapshots.linux.bindings['copy-url'], 'Ctrl+Shift+C');
  assert.equal(snapshots.mac.bindings['copy-url'], 'Command+Shift+C');
  h.context.current = { name: 'copy-url', shortcut: '' };
  h.context.snapshot = snapshots.linux;
  assert.equal(h.evaluate('shortcutDifference(current,snapshot)'), 'missing');
  assert.equal(h.stored['shortcutSnapshotV1-linux'].bindings['copy-url'], 'Ctrl+Shift+C');
});
test('backup round trip validates; malformed and oversize data are rejected', () => {
  const h = harness();
  const snapshot = h.evaluate("makeShortcutSnapshot([{name:'copy-url',shortcut:'Ctrl+Shift+C'}],'linux',123)");
  h.context.raw = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(JSON.parse(JSON.stringify(h.evaluate('validateShortcutSnapshot(raw)'))), JSON.parse(JSON.stringify(snapshot)));
  for (const raw of [null, {}, { ...snapshot, version: 2 }, { ...snapshot, platform: 'unknown' }, { ...snapshot, savedAt: -1 }, { ...snapshot, bindings: [] }, { ...snapshot, bindings: { 'copy-url': 42 } }, { ...snapshot, bindings: { '<script>': 'Alt+A' } }, { ...snapshot, bindings: { 'copy-url': 'A'.repeat(101) } }, { ...snapshot, bindings: Object.fromEntries(Array.from({length:100},(_,i)=>[`command-${i}`,'A'.repeat(100)])) }]) {
    h.context.raw = raw;
    assert.throws(() => h.evaluate('validateShortcutSnapshot(raw)'));
  }
});
test('malformed sync entries are ignored without changing stored data', async () => {
  const h = harness();
  h.stored['shortcutSnapshotV1-linux'] = { version: 999 };
  h.stored['shortcutSnapshotV1-mac'] = { version: 1, platform: 'linux', savedAt: 123, bindings: {} };
  const snapshots = await h.evaluate('readShortcutSnapshots()');
  assert.equal(Object.keys(snapshots).length, 0);
  assert.equal(h.stored['shortcutSnapshotV1-linux'].version, 999);
});
