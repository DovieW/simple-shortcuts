const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./chrome-mock.cjs');

const unloaded = h => h.tabs.filter(tab => tab.discarded).map(tab => tab.id);
const discardedCalls = h => h.calls.filter(call => call[0] === 'discard').map(call => call[1]);
const metadata = tabs => tabs.map(({ id, index, windowId, url, pinned, groupId }) => ({ id, index, windowId, url, pinned, groupId }));

test('unload a sole active tab by opening a new tab, preserving its URL, pin and group', async () => {
  for (const properties of [{}, { pinned: true }, { groupId: 0 }]) {
    const h = createHarness({ tabs: [{ id: 1, active: true, ...properties }], groups: [{ id: 0, windowId: 1 }] });
    const original = metadata(h.tabs);
    await h.run('discard-tabs');
    assert.deepEqual(unloaded(h), [1]);
    assert.deepEqual(metadata(h.tabs.filter(tab => tab.id === 1)), original);
    assert.equal(h.tabs.find(tab => tab.active).url, 'chrome://newtab/');
    assert.equal(h.tabs.find(tab => tab.active).groupId, -1);
    assert.equal(h.calls.some(call => call[0] === 'remove'), false);
  }
});

test('unload every originally highlighted tab across pinned/grouped/noncontiguous selections, in one window only', async () => {
  const h = createHarness({
    windows: [{ id: 1, type: 'normal', focused: true, incognito: false }, { id: 2, type: 'normal', incognito: true }],
    tabs: [{ id: 1, active: true, pinned: true }, { id: 2 }, { id: 3, highlighted: true, groupId: 5 },
      { id: 4, groupId: 5 }, { id: 5, highlighted: true }, { id: 6, windowId: 2, active: true, incognito: true }],
    groups: [{ id: 5, windowId: 1 }]
  });
  const original = metadata(h.tabs);
  await h.run('discard-tabs');
  assert.deepEqual(discardedCalls(h), [1, 3, 5]);
  assert.deepEqual(unloaded(h), [1, 3, 5]);
  assert.equal(h.tabs.find(tab => tab.id === 2).active, true);
  assert.equal(h.tabs.find(tab => tab.id === 6).active, true);
  assert.deepEqual(metadata(h.tabs), original);
  assert.equal(h.calls.some(call => ['create', 'remove', 'move', 'group', 'ungroup'].includes(call[0])), false);
});

test('selecting every tab unloads all originals and leaves one new tab active', async () => {
  const h = createHarness({ tabs: [1, 2, 3].map(id => ({ id, active: id === 1, highlighted: true })) });
  await h.run('discard-tabs');
  assert.deepEqual(unloaded(h), [1, 2, 3]);
  assert.equal(h.tabs.length, 4);
  assert.equal(h.tabs.find(tab => tab.active).id, 4);
});

test('already unloaded tabs are not reloaded or discarded again to park focus', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true }, { id: 2, highlighted: true, discarded: true }, { id: 3, discarded: true }] });
  await h.run('discard-tabs');
  assert.deepEqual(discardedCalls(h), [1]);
  assert.deepEqual(unloaded(h), [1, 2, 3]);
  assert.equal(h.tabs.find(tab => tab.active).id, 4);
});

test('parking focus does not expand unrelated collapsed groups', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true }, { id: 2, groupId: 5 }], groups: [{ id: 5, windowId: 1, collapsed: true }] });
  await h.run('discard-tabs');
  assert.equal(h.tabs.find(tab => tab.active).id, 3);
  assert.equal(h.groups[0].collapsed, true);
  assert.deepEqual(unloaded(h), [1]);
});

test('an inactive-only selection leaves the unselected active tab alone', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true, highlighted: false }, { id: 2, highlighted: true }, { id: 3, highlighted: true }] });
  await h.run('discard-tabs');
  assert.deepEqual(unloaded(h), [2, 3]);
  assert.equal(h.tabs.find(tab => tab.active).id, 1);
  assert.equal(h.calls.some(call => ['update', 'create'].includes(call[0])), false);
});

test('Chrome refusal attempts the remaining targets and reports a fixed partial-failure code', async () => {
  const h = createHarness({ failDiscardIds: [1], tabs: [1, 2, 3, 4].map(id => ({ id, active: id === 1, highlighted: id !== 4 })) });
  await assert.rejects(h.run('discard-tabs'), { code: 'discard_partial' });
  assert.deepEqual(discardedCalls(h), [1, 2, 3]);
  assert.deepEqual(unloaded(h), [2, 3]);
  await h.chrome.tabs.highlight({ windowId: 1, tabs: [0, 1, 2] });
  h.chrome.commands.onCommand.fire('discard-tabs');
  await h.evaluate('commandQueue');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.session.lastError.code, 'discard_partial');
  assert.equal(h.session.lastError.command, 'discard-tabs');
  assert.equal(h.calls.at(-1)[0], 'badge');
  assert.equal(h.calls.at(-1)[1].text, '!');
});

test('a selected tab closed during the focus change is skipped', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true }, { id: 2 }, { id: 3, highlighted: true }] });
  const update = h.chrome.tabs.update;
  h.chrome.tabs.update = async (id, props) => {
    const result = await update(id, props);
    if (id === 2 && props.active) await h.chrome.tabs.remove(3);
    return result;
  };
  await h.run('discard-tabs');
  assert.deepEqual(discardedCalls(h), [1]);
  assert.deepEqual(unloaded(h), [1]);
});

test('a selected tab moved to another window during the focus change is not unloaded', async () => {
  const h = createHarness({
    windows: [{ id: 1, type: 'normal', focused: true, incognito: false }, { id: 2, type: 'normal', incognito: false }],
    tabs: [{ id: 1, active: true }, { id: 2 }, { id: 3, highlighted: true }, { id: 4, windowId: 2, active: true }]
  });
  const update = h.chrome.tabs.update;
  h.chrome.tabs.update = async (id, props) => {
    const result = await update(id, props);
    if (id === 2 && props.active) await h.chrome.tabs.move(3, { windowId: 2, index: -1 });
    return result;
  };
  await assert.rejects(h.run('discard-tabs'), { code: 'discard_partial' });
  assert.deepEqual(discardedCalls(h), [1]);
  assert.equal(h.tabs.find(tab => tab.id === 3).discarded, undefined);
});

test('failed new-tab creation still unloads inactive selected tabs without closing the active original', async () => {
  const h = createHarness({ failCreate: true, tabs: [{ id: 1, active: true }, { id: 2, highlighted: true }] });
  await assert.rejects(h.run('discard-tabs'), { code: 'discard_partial' });
  assert.deepEqual(unloaded(h), [2]);
  assert.equal(h.tabs.find(tab => tab.id === 1).active, true);
  assert.equal(h.calls.some(call => call[0] === 'remove'), false);
});

test('an unverified discard result is a partial failure rather than a claimed success', async () => {
  const h = createHarness({ tabs: [{ id: 1, active: true }, { id: 2 }] });
  h.chrome.tabs.discard = async () => undefined;
  await assert.rejects(h.run('discard-tabs'), { code: 'discard_partial' });
  assert.deepEqual(unloaded(h), []);
});

test('a tab the user reactivates mid-command is not forcibly switched away again', async () => {
  const h = createHarness({ tabs: [1, 2, 3, 4].map(id => ({ id, active: id === 1, highlighted: id !== 4 })) });
  const discard = h.chrome.tabs.discard;
  h.chrome.tabs.discard = async id => {
    const result = await discard(id);
    if (id === 1) await h.chrome.tabs.update(2, { active: true });
    return result;
  };
  await assert.rejects(h.run('discard-tabs'), { code: 'discard_partial' });
  assert.deepEqual(unloaded(h), [1, 3]);
  assert.equal(h.tabs.find(tab => tab.active).id, 2);
});

test('discard replacements preserve recent history and Last active tab reloads the unloaded tab', async () => {
  const h = createHarness({ discardReplacesTab: true, tabs: [{ id: 1, active: true }, { id: 2 }] });
  await h.drain();
  await h.run('discard-tabs');
  await h.drain();
  const replacement = h.tabs.find(tab => tab.discarded);
  assert.notEqual(replacement.id, 1);
  assert.ok(h.session.tabHistory.some(entry => entry.tabId === replacement.id));
  assert.equal(h.session.tabHistory.some(entry => entry.tabId === 1), false);
  await h.run('switch-to-last-tab');
  assert.equal(h.tabs.find(tab => tab.active).id, replacement.id);
  assert.equal(replacement.discarded, false);
});

test('background tab replacement updates a saved recent-tab walk without changing its order or cursor', async () => {
  const h = createHarness({ session: {
    tabHistory: [{ tabId: 1, windowId: 1, incognito: false }, { tabId: 2, windowId: 1, incognito: false }],
    tabHistoryWalk: { ids: [1, 2], index: 0, currentTabId: 1, incognito: false }
  } });
  h.chrome.tabs.onReplaced.fire(20, 2);
  await h.drain();
  assert.deepEqual(h.session.tabHistory.map(entry => entry.tabId), [1, 20]);
  assert.deepEqual(h.session.tabHistoryWalk.ids, [1, 20]);
  assert.equal(h.session.tabHistoryWalk.index, 0);
  assert.equal(h.session.tabHistoryWalk.currentTabId, 1);
});
