const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./chrome-mock.cjs');
const active = h => h.tabs.find(t => t.active && h.windows.find(w => w.id === t.windowId).focused)?.id;
const history = h => h.session.tabHistory.map(entry => entry.tabId);

async function setup(settings = {}) {
  const h = createHarness({ tabs: [1, 2, 3, 4].map(id => ({ id, active: id === 1 })) });
  h.context.now = 10000;
  h.evaluate('Date.now = () => now');
  h.context.settings = settings;
  await h.evaluate('saveTabSettings(settings)');
  for (const id of [1, 2, 3, 4]) await h.activate(id);
  return h;
}
async function older(h) { await h.run('walk-recent-tabs'); await h.drain(); }
async function newer(h) { await h.run('walk-recent-tabs-forward'); await h.drain(); }

test('default pause commits the chosen tab and the next press returns to the origin', async () => {
  const h = await setup();
  await older(h); assert.equal(active(h), 3);
  h.context.now += 1499;
  await older(h); assert.equal(active(h), 2);
  assert.deepEqual(history(h), [4, 3, 2, 1], 'previews do not reshuffle recent history');
  h.context.now += 1500;
  await older(h); assert.equal(active(h), 4, 'fresh switch returns to D, not preview C');
  assert.deepEqual(h.session.tabHistoryWalk.ids, [2, 4, 3, 1]);
});

test('short and long configured pauses apply at the exact boundary', async () => {
  for (const pauseMs of [250, 2750, 10000]) {
    const h = await setup({ pauseMs });
    await older(h);
    h.context.now += pauseMs - 1;
    await older(h); assert.equal(active(h), 2);
    h.context.now += pauseMs;
    await older(h); assert.equal(active(h), 4);
  }
});

test('disabling the pause preserves a reversible walk indefinitely', async () => {
  const h = await setup({ resetAfterPause: false });
  await older(h);
  h.context.now += 86400000;
  await older(h); assert.equal(active(h), 2);
  await newer(h); assert.equal(active(h), 3);
});

test('boundaries renew the session for reversal, but newer after expiry starts fresh', async () => {
  const h = await setup({ pauseMs: 250 });
  await older(h); await older(h); await older(h);
  h.context.now += 249;
  await assert.rejects(older(h), { code: 'history_end' });
  h.context.now += 249;
  await newer(h); assert.equal(active(h), 2);
  h.context.now += 250;
  await assert.rejects(newer(h), { code: 'history_start' });
  assert.equal(active(h), 2);
  assert.deepEqual(h.session.tabHistoryWalk.ids, [2, 4, 3, 1]);
});

test('copy links and pinning do not reset or extend a walk', async () => {
  const h = await setup();
  await older(h);
  h.context.now += 100;
  await h.run('copy-url'); await h.run('pin-tab'); await h.drain();
  assert.equal(h.session.tabHistoryWalk.lastStepAt, 10000);
  await older(h); assert.equal(active(h), 2);
  h.context.now += 1500;
  await h.run('copy-url');
  await older(h); assert.equal(active(h), 4);
});

test('manual selection commits the final preview, while last-active returns to the origin', async () => {
  const h = await setup();
  await older(h); await older(h);
  await h.activate(1);
  assert.deepEqual(history(h), [1, 2, 4, 3]);
  assert.equal(h.session.tabHistoryWalk, undefined);
  const toggle = await setup();
  await older(toggle); await older(toggle);
  await toggle.run('switch-to-last-tab'); await toggle.drain();
  assert.equal(active(toggle), 4);
  await toggle.run('switch-to-last-tab'); await toggle.drain();
  assert.equal(active(toggle), 2);
});

test('optional preview recording restores every-visited-tab recency', async () => {
  const h = await setup({ rememberPreviews: true });
  await older(h); await older(h);
  assert.deepEqual(history(h), [2, 3, 4, 1]);
  h.context.now += 1500;
  await older(h); assert.equal(active(h), 3);
});

test('wrap reverses across both ends, skips closed entries, and handles one survivor', async () => {
  const h = await setup({ wrap: true });
  await newer(h); assert.equal(active(h), 1);
  await older(h); assert.equal(active(h), 4);
  await h.chrome.tabs.remove([1, 3]); await h.drain();
  await newer(h); assert.equal(active(h), 2);
  await older(h); assert.equal(active(h), 4);
  await h.chrome.tabs.remove(2); await h.drain();
  await assert.rejects(older(h), { code: 'history_end' });
  assert.equal(active(h), 4);
});

test('window scope and wrap exclude other windows, private tabs and app windows', async () => {
  const h = createHarness({
    windows: [{ id: 1, type: 'normal', focused: true, incognito: false }, { id: 2, type: 'normal', focused: false, incognito: false }, { id: 3, type: 'normal', focused: false, incognito: true }, { id: 4, type: 'popup', focused: false, incognito: false }],
    tabs: [{ id: 1, active: true }, { id: 2, windowId: 2 }, { id: 3, windowId: 3, incognito: true }, { id: 4, windowId: 4 }, { id: 5 }],
    session: { tabHistory: [1, 2, 3, 4, 5].map(tabId => ({ tabId })) }
  });
  await h.evaluate('saveTabSettings({ includeOtherWindows: false, wrap: true })');
  await older(h); assert.equal(active(h), 5);
  await older(h); assert.equal(active(h), 1);
  await newer(h); assert.equal(active(h), 5);
});

test('worker restart retains timing and settings; expired sessions and clock rollback reset', async () => {
  for (const elapsed of [100, 2000, -100]) {
    const h = await setup();
    await older(h);
    const restarted = createHarness({ tabs: h.tabs, session: h.session, sync: h.sync });
    restarted.context.now = 10000 + elapsed;
    restarted.evaluate('Date.now = () => now');
    await older(restarted);
    assert.equal(active(restarted), elapsed === 100 ? 2 : 4);
  }
});

test('legacy walks without timing migrate to a fresh session', async () => {
  const h = await setup();
  await older(h);
  delete h.session.tabHistoryWalk.lastStepAt;
  delete h.session.tabHistoryWalk.settings;
  await older(h); assert.equal(active(h), 4);
});

test('synced settings are read on the next shortcut and changes start a fresh session', async () => {
  const h = await setup();
  await older(h);
  await h.chrome.storage.sync.set({ 'tabSwitchingV1-pauseMs': 5000 });
  await older(h); assert.equal(active(h), 4);
  h.context.now += 4000;
  await older(h); assert.equal(active(h), 2);
});

test('Chrome storage reordering object keys does not reset a walk', async () => {
  const h = await setup();
  await older(h);
  const settings = h.session.tabHistoryWalk.settings;
  h.session.tabHistoryWalk.settings = Object.fromEntries(Object.keys(settings).sort().map(name => [name, settings[name]]));
  await older(h); assert.equal(active(h), 2);
  await newer(h); assert.equal(active(h), 3);
});

test('sync settings validate fields, preserve unrelated keys and restore defaults', async () => {
  const h = await setup({ pauseMs: 2750, wrap: true });
  h.sync['shortcutSnapshotV1-linux'] = { bindings: { 'copy-url': 'Alt+C' } };
  h.sync['tabSwitchingV1-futureSetting'] = true;
  await h.evaluate('saveTabSettings({ includeOtherWindows: false })');
  assert.equal(h.sync['tabSwitchingV1-pauseMs'], 2750);
  assert.equal(h.sync['tabSwitchingV1-wrap'], true);
  for (const patch of [{ pauseMs: 0 }, { pauseMs: 10001 }, { pauseMs: '1500' }, { wrap: 1 }]) {
    h.context.patch = patch;
    await assert.rejects(h.evaluate('saveTabSettings(patch)'));
  }
  h.sync['tabSwitchingV1-pauseMs'] = 'corrupt';
  assert.equal((await h.evaluate('readTabSettings()')).pauseMs, 1500);
  await h.evaluate('saveTabSettings(TAB_SETTINGS_DEFAULTS)');
  assert.equal(h.sync['tabSwitchingV1-wrap'], false);
  assert.equal(h.sync['tabSwitchingV1-futureSetting'], true);
  assert.deepEqual(h.sync['shortcutSnapshotV1-linux'], { bindings: { 'copy-url': 'Alt+C' } });
});
