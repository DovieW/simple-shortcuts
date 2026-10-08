const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./chrome-mock.cjs');
const ids = h => h.tabs.map(tab => tab.id);
const selected = h => h.tabs.filter(tab => tab.highlighted).map(tab => tab.id);

test('blank detection excludes websites, about:blank, empty, loading, pending, and pinned tabs', () => {
  const h = createHarness();
  for (const tab of [ { url: 'https://example.test/', title: 'New Tab' }, { url: 'about:blank' }, { url: '' }, { url: 'chrome://newtab/', status: 'loading' }, { url: 'chrome://newtab/', pendingUrl: 'https://example.test/' }, { url: 'chrome://newtab/', pinned: true } ]) {
    h.context.tab = { status: 'complete', ...tab };
    assert.equal(h.evaluate('isBlankTab(tab)'), false);
  }
  assert.equal(h.evaluate("isBlankTab({url:'chrome://newtab/',status:'complete'})"), true);
});

test('new-tab actions never clean up unrelated tabs', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true }, { id: 2, title: 'New Tab' }, { id: 3, url: 'chrome://newtab/', groupId: 5 }, { id: 4, url: 'chrome://newtab/', pinned: true }], groups: [{ id: 5, windowId: 1 }] });
  await h.run('open-tab-near');
  for (const id of [1, 2, 3, 4]) assert.ok(h.tabs.some(tab => tab.id === id));
  assert.equal(h.calls.some(call => call[0] === 'remove'), false);
});

test('only new tab is replaced without closing its window', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true, url: 'chrome://newtab/' }] });
  await h.run('open-tab-at-end');
  assert.equal(h.windows.length, 1);
  assert.equal(h.tabs.length, 1);
  assert.ok(h.calls.findIndex(call => call[0] === 'create') < h.calls.findIndex(call => call[0] === 'remove'));
});

test('only tab in group is grouped before old tab is removed, including group ID zero', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true, url: 'chrome://newtab/', groupId: 0 }], groups: [{ id: 0, windowId: 1 }] });
  await h.run('add-tab-to-current-group');
  assert.equal(h.tabs[0].groupId, 0);
  assert.equal(h.groups.length, 1);
  assert.ok(h.calls.findIndex(call => call[0] === 'group') < h.calls.findIndex(call => call[0] === 'remove'));
});

test('failed creation or grouping never removes original blank tab', async () => {
  for (const failure of ['failCreate', 'failGroup']) {
    const h = createHarness({ [failure]: true, tabs: [{ id: 1, active: true, url: 'chrome://newtab/', groupId: 5 }], groups: [{ id: 5, windowId: 1 }] });
    await assert.rejects(h.run('add-tab-to-current-group'));
    assert.ok(h.tabs.some(tab => tab.id === 1));
    assert.equal(h.calls.some(call => call[0] === 'remove'), false);
  }
});

test('end tab is ungrouped; ungrouped group shortcut falls back to near tab', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true, groupId: 5 }], groups: [{ id: 5, windowId: 1 }] });
  await h.run('open-tab-at-end');
  assert.equal(h.tabs.at(-1).groupId, -1);
  await h.run('add-tab-to-current-group');
  assert.equal(h.tabs.length, 3);
});

for (const [command, tabs, expected] of [
  ['move-tabs-right', [1, 2, 3, 4, 5], [1, 4, 2, 3, 5]],
  ['move-tabs-left', [1, 2, 3, 4, 5], [2, 3, 1, 4, 5]]
]) test(`contiguous ${command} preserves selection order`, async () => {
  const h = createHarness({ tabs: tabs.map(id => ({ id, active: id === 2, highlighted: [2, 3].includes(id) })) });
  await h.run(command);
  assert.deepEqual(ids(h), expected);
  assert.deepEqual(selected(h).sort(), [2, 3]);
});

test('noncontiguous selection moving right compacts in source order', async () => {
  const h = createHarness({ tabs: [1, 2, 3, 4, 5, 6].map(id => ({ id, active: id === 2, highlighted: [2, 4].includes(id) })) });
  await h.run('move-tabs-right');
  assert.deepEqual(ids(h), [1, 3, 5, 2, 4, 6]);
});

for (const direction of [-1, 1]) test(`skip collapsed group at ${direction < 0 ? 'start' : 'end'} without infinite loop`, async () => {
  const tabs = direction < 0 ? [{ id: 1, groupId: 5 }, { id: 2, groupId: 5 }, { id: 3, active: true }] : [{ id: 3, active: true }, { id: 1, groupId: 5 }, { id: 2, groupId: 5 }];
  const h = createHarness({ tabs, groups: [{ id: 5, windowId: 1, collapsed: true }] });
  await h.run(direction < 0 ? 'move-tabs-left' : 'move-tabs-right');
  assert.deepEqual(ids(h), direction < 0 ? [3, 1, 2] : [1, 2, 3]);
  assert.equal(h.tabs.find(tab => tab.id === 3).groupId, -1);
});

test('left/right joins expanded neighboring group and leaves own group first', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true }, { id: 2, groupId: 5 }], groups: [{ id: 5, windowId: 1, collapsed: false }] });
  await h.run('move-tabs-right');
  assert.equal(h.tabs[0].groupId, 5);
  await h.run('move-tabs-left');
  assert.equal(h.tabs[0].groupId, -1);
});

test('mixed pinned and grouped selection moves within its existing sections', async () => {
  const h = createHarness({ tabs: [{ id: 1, pinned: true, active: true }, { id: 2, pinned: true }, { id: 3, groupId: 5, highlighted: true }, { id: 4, groupId: 5 }], groups: [{ id: 5, windowId: 1 }] });
  await h.run('move-tabs-right');
  assert.deepEqual(ids(h), [2, 1, 4, 3]);
  assert.equal(h.tabs.find(tab => tab.id === 1).pinned, true);
  assert.equal(h.tabs.find(tab => tab.id === 3).groupId, 5);
});

test('native duplication preserves pin/group metadata, history, relative order and selection', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true, pinned: true, historyMarker: 'back' }, { id: 2, highlighted: true, groupId: 5, historyMarker: 'forward' }, { id: 3, groupId: 5 }], groups: [{ id: 5, windowId: 1 }] });
  await h.run('duplicate-tab');
  const duplicates = h.tabs.filter(tab => ![1, 2, 3].includes(tab.id));
  assert.equal(duplicates.length, 2);
  assert.equal(duplicates[0].pinned, true);
  assert.equal(duplicates[0].historyMarker, 'back');
  assert.equal(duplicates[1].groupId, 5);
  assert.equal(duplicates[1].historyMarker, 'forward');
  assert.deepEqual(h.calls.filter(call => call[0] === 'duplicate').map(call => call[1]), [1, 2]);
  assert.equal(h.tabs.findIndex(tab => tab.id === duplicates[1].id), h.tabs.findIndex(tab => tab.id === 2) + 1);
  assert.equal(selected(h).length, 2);
});

test('rapid last-tab shortcut toggles C-A-C', async () => {
  const h = createHarness({ tabs: [1, 2, 3].map(id => ({ id, active: id === 1 })) });
  await h.activate(1); await h.activate(3);
  await h.run('switch-to-last-tab'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 1);
  await h.run('switch-to-last-tab'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 3);
});

test('history queue preserves rapid activations and removes closed tabs', async () => {
  const h = createHarness({ tabs: [1, 2, 3].map(id => ({ id, active: id === 1 })) });
  await h.chrome.tabs.update(1, { active: true });
  await h.chrome.tabs.update(2, { active: true });
  await h.chrome.tabs.update(3, { active: true });
  await h.drain();
  assert.deepEqual(h.session.tabHistory.map(entry => entry.tabId), [3, 2, 1]);
  await h.chrome.tabs.remove(2); await h.drain();
  assert.deepEqual(h.session.tabHistory.map(entry => entry.tabId), [3, 1]);
});

test('last-tab repeatedly toggles across windows and reveals collapsed target groups', async () => {
  const h = createHarness({ windows: [{ id: 1, type: 'normal', focused: true, incognito: false }, { id: 2, type: 'normal', focused: false, incognito: false }], tabs: [{ id: 1, active: true }, { id: 2, active: true, windowId: 2, groupId: 5 }], groups: [{ id: 5, windowId: 2, collapsed: true }], session: { tabHistory: [{ tabId: 1 }, { tabId: 2 }] } });
  for (let i = 0; i < 10; i++) {
    await h.run('switch-to-last-tab');
    await h.drain();
    assert.equal(h.windows.find(window => window.focused).id, i % 2 === 0 ? 2 : 1);
    assert.equal(h.session.tabHistory[0].tabId, i % 2 === 0 ? 2 : 1);
  }
  assert.equal(h.groups[0].collapsed, false);
});

test('rapid queued last-tab commands preserve the toggle pair', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true }, { id: 2 }] });
  await h.activate(2);
  await Promise.all(Array.from({ length: 11 }, () => h.run('switch-to-last-tab')));
  await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 1);
  assert.deepEqual(h.session.tabHistory.slice(0, 2).map(entry => entry.tabId), [1, 2]);
});

test('recent-tab walk traverses a stable list, skips closed tabs, and stops without wrapping', async () => {
  const h = createHarness({ tabs: [1, 2, 3, 4, 5].map(id => ({ id, active: id === 1 })) });
  for (const id of [1, 2, 3, 4, 5]) await h.activate(id);
  await h.run('walk-recent-tabs'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 4);
  await h.chrome.tabs.remove(3);
  await h.run('walk-recent-tabs'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 2);
  await h.run('walk-recent-tabs'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 1);
  for (let i = 0; i < 2; i++) await assert.rejects(h.run('walk-recent-tabs'), { code: 'history_end' });
  assert.equal(h.tabs.find(tab => tab.active).id, 1);
});

test('recent-tab walk reverses direction without reordering and stops at both ends', async () => {
  const h = createHarness({ tabs: [1, 2, 3, 4].map(id => ({ id, active: id === 1 })) });
  for (const id of [1, 2, 3, 4]) await h.activate(id);
  await assert.rejects(h.run('walk-recent-tabs-forward'), { code: 'history_start' });
  const steps = [ ['walk-recent-tabs', 3], ['walk-recent-tabs', 2], ['walk-recent-tabs-forward', 3], ['walk-recent-tabs', 2], ['walk-recent-tabs', 1] ];
  for (const [command, expected] of steps) {
    await h.run(command); await h.drain();
    assert.equal(h.tabs.find(tab => tab.active).id, expected);
    assert.deepEqual(h.session.tabHistoryWalk.ids, [4, 3, 2, 1]);
  }
  await assert.rejects(h.run('walk-recent-tabs'), { code: 'history_end' });
  for (const expected of [2, 3, 4]) {
    await h.run('walk-recent-tabs-forward'); await h.drain();
    assert.equal(h.tabs.find(tab => tab.active).id, expected);
  }
  await assert.rejects(h.run('walk-recent-tabs-forward'), { code: 'history_start' });
  assert.equal(h.tabs.find(tab => tab.active).id, 4);
  await h.run('walk-recent-tabs'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 3);
});

test('newer recent tab skips closed entries after restart and accepts an old end cursor', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true }, { id: 3 }, { id: 4 }], session: { tabHistory: [1, 3, 4].map(tabId => ({ tabId })), tabHistoryWalk: { ids: [4, 3, 2, 1], index: 4, currentTabId: 1, incognito: false } } });
  await h.run('walk-recent-tabs-forward'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 3);
  await h.run('walk-recent-tabs-forward'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 4);
});

test('rapid mixed history directions share a stable cursor and newer resets after manual selection', async () => {
  const h = createHarness({ tabs: [1, 2, 3, 4].map(id => ({ id, active: id === 1 })) });
  for (const id of [1, 2, 3, 4]) await h.activate(id);
  await Promise.all(['walk-recent-tabs', 'walk-recent-tabs', 'walk-recent-tabs-forward', 'walk-recent-tabs', 'walk-recent-tabs-forward', 'walk-recent-tabs-forward'].map(command => h.run(command)));
  await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 4);
  await h.activate(1);
  await assert.rejects(h.run('walk-recent-tabs-forward'), { code: 'history_start' });
  assert.equal(h.tabs.find(tab => tab.active).id, 1);
});

test('recent-tab walk resets after manual selection or last-active toggle', async () => {
  const h = createHarness({ tabs: [1, 2, 3, 4].map(id => ({ id, active: id === 1 })) });
  for (const id of [1, 2, 3, 4]) await h.activate(id);
  await h.run('walk-recent-tabs'); await h.drain();
  await h.activate(1);
  await h.run('walk-recent-tabs'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 3);
  await h.run('switch-to-last-tab'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 1);
  assert.equal(h.session.tabHistoryWalk, undefined);
  await h.run('walk-recent-tabs'); await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 3);
});

test('recent-tab walk preserves cursor across worker restart and excludes private/app tabs', async () => {
  const options = { windows: [{ id: 1, type: 'normal', focused: true, incognito: false }, { id: 2, type: 'normal', focused: false, incognito: false }, { id: 3, type: 'normal', focused: false, incognito: true }, { id: 4, type: 'popup', focused: false, incognito: false }], tabs: [{ id: 1, active: true }, { id: 2, windowId: 3, incognito: true }, { id: 3, windowId: 4 }, { id: 4, windowId: 2, active: true, groupId: 5 }, { id: 5, windowId: 1 }], groups: [{ id: 5, windowId: 2, collapsed: true }], session: { tabHistory: [1, 2, 3, 4, 5].map(tabId => ({ tabId })) } };
  const h = createHarness(options);
  await h.run('walk-recent-tabs'); await h.drain();
  assert.equal(h.session.tabHistoryWalk.currentTabId, 4);
  assert.equal(h.groups[0].collapsed, false);
  const restarted = createHarness({ windows: h.windows, tabs: h.tabs, groups: h.groups, session: h.session });
  await restarted.run('walk-recent-tabs'); await restarted.drain();
  assert.equal(restarted.session.tabHistoryWalk.currentTabId, 5);
  await restarted.run('walk-recent-tabs-forward'); await restarted.drain();
  assert.equal(restarted.session.tabHistoryWalk.currentTabId, 4);
  await restarted.run('walk-recent-tabs-forward'); await restarted.drain();
  assert.equal(restarted.session.tabHistoryWalk.currentTabId, 1);
});

test('rapid recent-tab walk stops at the 32-entry limit', async () => {
  const h = createHarness({ tabs: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, active: i === 0 })) });
  for (let id = 1; id <= 40; id++) await h.activate(id);
  assert.equal(h.session.tabHistory.length, 32);
  await Promise.all(Array.from({ length: 31 }, () => h.run('walk-recent-tabs')));
  await h.drain();
  assert.equal(h.tabs.find(tab => tab.active).id, 9);
  await assert.rejects(h.run('walk-recent-tabs'), { code: 'history_end' });
});

test('normal window targeted when app has focus; app excluded from history', async () => {
  const h = createHarness({ windows: [{ id: 1, type: 'normal', focused: false, incognito: false }, { id: 2, type: 'popup', focused: true, incognito: false }], tabs: [{ id: 1, active: true }, { id: 2, active: true, windowId: 2 }], lastFocused: 1 });
  h.chrome.windows.onFocusChanged.fire(2); await h.drain();
  assert.deepEqual(h.session.tabHistory.map(entry => entry.tabId), [1]);
  await h.run('open-tab-near');
  assert.ok(h.calls.some(call => call[0] === 'create' && call[1].windowId === 1));
  assert.equal(h.windows.find(window => window.id === 1).focused, true);
});

test('ambiguous focused-window snapshots use Chrome last-focused order', async () => {
  const h = createHarness({ windows: [{ id: 1, type: 'normal', focused: true, incognito: false }, { id: 2, type: 'normal', focused: true, incognito: false }], tabs: [{ id: 1, active: true }, { id: 2, windowId: 2, active: true }], lastFocused: 2 });
  assert.equal((await h.evaluate('resolveWindow()')).id, 2);
});

test('delayed focus and activation events from another window do not disturb history traversal', async () => {
  const h = createHarness({ windows: [{ id: 1, type: 'normal', focused: true, incognito: false }, { id: 2, type: 'normal', focused: true, incognito: false }], tabs: [{ id: 1, active: true }, { id: 2, windowId: 2, active: true }], lastFocused: 2, session: { tabHistory: [{ tabId: 2 }, { tabId: 1 }], tabHistoryWalk: { ids: [1, 2], index: 1, currentTabId: 2, incognito: false } } });
  h.chrome.windows.onFocusChanged.fire(1);
  h.chrome.tabs.onActivated.fire({ tabId: 1, windowId: 1 });
  await h.drain();
  assert.equal(h.session.tabHistory[0].tabId, 2);
  assert.equal(h.session.tabHistoryWalk.currentTabId, 2);
});

test('last-tab skips apps, closed IDs and other privacy contexts', async () => {
  const h = createHarness({ windows: [{ id: 1, type: 'normal', focused: true, incognito: false }, { id: 2, type: 'popup', focused: false, incognito: false }, { id: 3, type: 'normal', focused: false, incognito: true }], tabs: [{ id: 1, active: true }, { id: 2, windowId: 2 }, { id: 3, windowId: 3, incognito: true }, { id: 4 }], session: { tabHistory: [{ tabId: 2 }, { tabId: 3 }, { tabId: 99 }, { tabId: 4 }] } });
  await h.run('switch-to-last-tab');
  assert.equal(h.tabs.find(tab => tab.windowId === 1 && tab.active).id, 4);
});

test('cycle groups follows strip order and expands destination', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true, groupId: 5 }, { id: 2, groupId: 8 }], groups: [{ id: 8, windowId: 1, collapsed: true }, { id: 5, windowId: 1, collapsed: false }] });
  await h.run('cycle-tab-groups');
  assert.equal(h.tabs.find(tab => tab.id === 1).groupId, 8);
  assert.equal(h.groups.find(group => group.id === 8).collapsed, false);
});

test('front repeated press pins, back repeated press unpins, unrelated action resets repeat', async () => {
  const h = createHarness({ tabs: [{ id: 1 }, { id: 2, active: true }] });
  await h.run('move-tabs-to-front'); await h.run('move-tabs-to-front');
  assert.equal(h.tabs.find(tab => tab.id === 2).pinned, true);
  await h.run('move-tabs-to-back'); await h.run('move-tabs-to-back');
  assert.equal(h.tabs.find(tab => tab.id === 2).pinned, false);
  await h.run('move-tabs-to-front'); await h.run('copy-url'); await h.run('move-tabs-to-front');
  assert.equal(h.tabs.find(tab => tab.id === 2).pinned, false);
});

test('copy URL uses offscreen document even for chrome:// and reuses it', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true, url: 'chrome://settings/' }] });
  await h.run('copy-url'); await h.run('copy-url');
  assert.equal(h.calls.filter(call => call[0] === 'offscreen').length, 1);
  assert.equal(h.calls.find(call => call[0] === 'message')[1].text, 'chrome://settings/');
  assert.equal(h.calls.some(call => call[0] === 'execute'), false);
});

test('clipboard rejection propagates; queue recovers for next command', async () => {
  const h = createHarness({ failClipboard: true });
  await assert.rejects(h.run('copy-url'));
  await h.run('open-tab-near');
  assert.equal(h.tabs.length, 2);
});

test('no normal window fails without editing app tabs', async () => {
  const h = createHarness({ windows: [{ id: 1, type: 'popup', focused: true, incognito: false }] });
  await assert.rejects(h.run('pin-tab'));
  assert.equal(h.calls.some(call => call[0] === 'update'), false);
});

test('pause-all targets normal web pages only, matching privacy context', async () => {
  const h = createHarness({ windows: [{ id: 1, type: 'normal', focused: true, incognito: false }, { id: 2, type: 'popup', focused: false, incognito: false }, { id: 3, type: 'normal', focused: false, incognito: true }], tabs: [{ id: 1, active: true }, { id: 2, url: 'chrome://settings/' }, { id: 3, windowId: 2 }, { id: 4, windowId: 3, incognito: true }, { id: 5, discarded: true }] });
  await h.run('pause-all-tabs');
  assert.deepEqual(h.calls.filter(call => call[0] === 'execute').map(call => call[1].tabId), [1]);
  assert.equal(h.session.mediaResult.failed, 0);
});

test('pause-all permission denial executes no scripts; partial errors are surfaced', async () => {
  const denied = createHarness();
  await assert.rejects(denied.evaluate("runCommand('pause-all-tabs',false)"));
  assert.equal(denied.calls.some(call => call[0] === 'execute'), false);
  const failed = createHarness({ failScript: true });
  await assert.rejects(failed.run('pause-all-tabs'));
  assert.equal(failed.session.mediaResult.failed, 1);
});

test('window cycling does not target incognito or apps', async () => {
  const h = createHarness({ windows: [{ id: 1, type: 'normal', focused: true, incognito: false }, { id: 2, type: 'normal', focused: false, incognito: true }, { id: 3, type: 'popup', focused: false, incognito: false }, { id: 4, type: 'normal', focused: false, incognito: false }] });
  await h.run('switch-windows');
  assert.equal(h.windows.find(window => window.focused).id, 4);
});

test('empty selections are safe no-ops', async () => {
  const h = createHarness({ tabs: [] });
  for (const command of ['move-tabs-left', 'move-tabs-right', 'move-tabs-to-front', 'move-tabs-to-back', 'duplicate-tab']) await h.run(command);
  assert.equal(h.calls.some(call => call[0] === 'move'), false);
});

test('fresh session seeds existing active tab; first activation can switch back', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true }, { id: 2 }] });
  await h.drain();
  await h.activate(2);
  await h.run('switch-to-last-tab');
  assert.equal(h.tabs.find(tab => tab.active).id, 1);
});

test('worker restart preserves existing session history', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true }, { id: 2 }], session: { tabHistory: [{ tabId: 1 }, { tabId: 2 }] } });
  await h.drain();
  assert.deepEqual(h.session.tabHistory.map(entry => entry.tabId), [1, 2]);
  await h.run('switch-to-last-tab');
  assert.equal(h.tabs.find(tab => tab.active).id, 2);
});

test('extension popup can mute a normal tab; external senders cannot dispatch commands', async () => {
  const h = createHarness();
  const handler = h.chrome.runtime.onMessage.listeners[0];
  assert.equal(handler({ target: 'background', type: 'run-command', command: 'pin-tab' }, { id: 'foreign', url: 'https://example.test/' }, () => {}), undefined);
  assert.equal(h.tabs[0].pinned, false);
  const result = await new Promise(resolve => handler({ target: 'background', type: 'mute-tab', tabId: 1 }, { id: h.chrome.runtime.id, url: h.chrome.runtime.getURL('popup.html') }, resolve));
  assert.equal(result.ok, true);
  assert.equal(h.tabs[0].mutedInfo.muted, true);
});

test('failure is surfaced as a privacy-safe badge and command status', async () => {
  const h = createHarness();
  await h.evaluate("reportError('copy-url')");
  assert.deepEqual(Object.keys(h.session.lastError).sort(), ['at', 'code', 'command']);
  assert.equal(h.session.lastError.command, 'copy-url');
  assert.ok(h.calls.some(call => call[0] === 'badge' && call[1].text === '!'));
  await h.run('open-tab-near');
  assert.equal(h.session.lastError, undefined);
});

test('copy links preserves tab-strip order, duplicate URLs, and window isolation', async () => {
  const h = createHarness({ windows: [{id:1,type:'normal',focused:true}, {id:2,type:'normal',focused:false}], tabs: [
    {id:1,highlighted:true,pinned:true,url:'chrome://settings/'},
    {id:2,url:'https://unselected.test/'},
    {id:3,active:true,groupId:5,url:'https://same.test/'},
    {id:4,highlighted:true,groupId:5,url:'https://same.test/'},
    {id:5,windowId:2,highlighted:true,url:'https://other-window.test/'}
  ] });
  await h.run('copy-url');
  assert.equal(h.calls.find(call => call[0] === 'message')[1].text, 'chrome://settings/\nhttps://same.test/\nhttps://same.test/');
});

test('missing selected URL leaves the clipboard untouched', async () => {
  const h = createHarness({tabs:[{id:1,active:true}, {id:2,highlighted:true,url:''}]});
  await assert.rejects(h.run('copy-url'), {code:'no_url'});
  assert.equal(h.calls.some(call => call[0] === 'message'), false);
});

test('screenshot captures the active tab once and sends PNG without storing image data', async () => {
  const h = createHarness();
  await h.run('copy-screenshot');
  assert.deepEqual(h.calls.find(call => call[0] === 'capture'), ['capture',1,{format:'png'}]);
  assert.equal(h.calls.find(call => call[0] === 'message')[1].type, 'copy-image');
  assert.equal(h.calls.find(call => call[0] === 'message')[1].dataUrl, 'data:image/png;base64,test');
  assert.equal(JSON.stringify(h.session).includes('data:image'), false);
});

test('screenshot rejects changed active tabs and navigation without writing the clipboard', async () => {
  for (const afterCapture of [chrome => chrome.tabs.update(2,{active:true}), chrome => chrome.tabs.update(1,{url:'https://changed.test/'})]) {
    const h = createHarness({tabs:[{id:1,active:true},{id:2}],afterCapture});
    await assert.rejects(h.run('copy-screenshot'), {code:'screenshot_changed'});
    assert.equal(h.calls.some(call => call[0] === 'message'), false);
  }
  const h = createHarness({tabs:[{id:1,active:true},{id:2}]});
  await assert.rejects(h.evaluate("runCommand('copy-screenshot',undefined,{id:2,url:'https://example.test/'})"), {code:'screenshot_changed'});
  assert.equal(h.calls.some(call => call[0] === 'capture'), false);
});

test('screenshot distinguishes capture permission, rate limit, capture, and clipboard failures', async () => {
  for (const [captureError, code] of [['Either the <all_urls> or activeTab permission is required.', 'screenshot_permission'], ['MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded', 'screenshot_busy'], ['Capture failed: https://private.test/', 'screenshot_failed']]) {
    const h = createHarness({captureError});
    await assert.rejects(h.run('copy-screenshot'), {code});
    assert.equal(h.calls.some(call => call[0] === 'message'), false);
  }
  await assert.rejects(createHarness({failClipboard:true}).run('copy-screenshot'), {code:'clipboard_failed'});
});

test('keyboard failures store only a safe reason and do not block the queue', async () => {
  const h = createHarness({captureError:'Capture failed: https://private.test/ Secret title'});
  h.chrome.commands.onCommand.fire('copy-screenshot');
  await h.evaluate('commandQueue');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.session.lastError.code, 'screenshot_failed');
  assert.equal(JSON.stringify(h.session.lastError).includes('private'), false);
  await h.run('copy-url');
  assert.equal(h.session.lastError, undefined);
});

test('unavailable destinations and permission denial have useful error codes', async () => {
  await assert.rejects(createHarness().run('switch-windows'), {code:'no_other_window'});
  await assert.rejects(createHarness().run('cycle-tab-groups'), {code:'no_group'});
  await assert.rejects(createHarness().run('switch-to-last-tab'), {code:'no_previous_tab'});
  await assert.rejects(createHarness({windows:[]}).run('copy-url'), {code:'no_window'});
  await assert.rejects(createHarness().evaluate("runCommand('pause-all-tabs',false)"), {code:'permission_denied'});
});
