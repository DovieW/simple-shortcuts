// Real Chromium checks in a disposable profile; never connects to your browser.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-shortcuts-browser-'));
  const extension = path.resolve(process.env.SHORTCUTS_TEST_EXTENSION || path.join(__dirname, '..'));
  const artifacts = process.env.SHORTCUTS_TEST_ARTIFACTS || path.join(profile, 'artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: process.env.SHORTCUTS_HEADED !== '1',
    args: ['--ozone-platform=x11', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required']
  });
  let server;
  try {
    server = http.createServer((request, response) => {
      response.writeHead(200, {'Content-Type':'text/html'});
      response.end(`<title>${request.url}</title><p>Local browser fixture ${request.url}</p>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = worker.url().split('/')[2];
    const evaluate = (fn, argument) => worker.evaluate(fn, argument);
    const run = command => evaluate(command => enqueueCommand(() => runCommand(command)), command);
    async function waitForUrl(id, part) {
      for (let i = 0; i < 200; i++) {
        const tab = await evaluate(id => chrome.tabs.get(id), id);
        if (tab.url.includes(part) && tab.status === 'complete') return tab;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw Error(`Tab did not finish loading ${part}`);
    }
    const snapshot = () => evaluate(async () => (await chrome.tabs.query({ windowId: (await resolveWindow()).id })).sort((a, b) => a.index - b.index));
    async function reset(count = 4) {
      return evaluate(async count => {
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        const windowId = windows[0].id;
        const original = await chrome.tabs.query({ windowId });
        const created = [];
        for (let i = 0; i < count; i++) created.push(await chrome.tabs.create({ windowId, url: 'about:blank', active: false }));
        await chrome.tabs.remove(original.map(tab => tab.id));
        for (const window of windows.slice(1)) await chrome.windows.remove(window.id);
        await chrome.windows.update(windowId, { focused: true });
        await chrome.tabs.update(created[0].id, { active: true });
        await historyQueue;
        await chrome.storage.session.clear();
        await enqueueHistory(() => recordTab(created[0]));
        return { ids: created.map(tab => tab.id), windowId };
      }, count);
    }
    async function check(name, task) {
      await task(); console.log(`PASS ${name}`);
    }
    console.log(`Chromium ${context.browser().version()}; ${await evaluate(async () => (await chrome.commands.getAll()).length)} commands loaded`);

    await check('screenshot requires a user-granted capture permission', async () => {
      await reset(1);
      await assert.rejects(run('copy-screenshot'), /capture access/);
    });

    await check('multi-tab right/left preserves order and highlighting', async () => {
      const { ids, windowId } = await reset(5);
      await evaluate(({ windowId }) => chrome.tabs.highlight({ windowId, tabs: [1, 2] }), { windowId });
      await run('move-tabs-right');
      assert.deepEqual((await snapshot()).map(tab => tab.id), [ids[0], ids[3], ids[1], ids[2], ids[4]]);
      assert.deepEqual((await snapshot()).filter(tab => tab.highlighted).map(tab => tab.id), [ids[1], ids[2]]);
      await run('move-tabs-left');
      assert.deepEqual((await snapshot()).map(tab => tab.id), ids);
    });
    await check('noncontiguous multi-tab right compacts in original order', async () => {
      const { ids, windowId } = await reset(6);
      await evaluate(({ windowId }) => chrome.tabs.highlight({ windowId, tabs: [1, 3] }), { windowId });
      await run('move-tabs-right');
      assert.deepEqual((await snapshot()).map(tab => tab.id), [ids[0], ids[2], ids[4], ids[1], ids[3], ids[5]]);
    });
    await check('collapsed group at index zero skips without hanging', async () => {
      const { ids } = await reset(3);
      const groupId = await evaluate(async ids => {
        const groupId = await chrome.tabs.group({ tabIds: ids.slice(0, 2) });
        await chrome.tabs.update(ids[2], { active: true });
        await chrome.tabGroups.update(groupId, { collapsed: true });
        return groupId;
      }, ids);
      await run('move-tabs-left');
      const tabs = await snapshot();
      assert.deepEqual(tabs.map(tab => tab.id), [ids[2], ids[0], ids[1]]);
      assert.equal(tabs[0].groupId, -1);
      assert.equal((await evaluate(id => chrome.tabGroups.get(id), groupId)).collapsed, true);
    });
    await check('native duplicate preserves back history and grouping', async () => {
      const { ids } = await reset(2);
        // Navigate the source tab through two URLs without leaving the local fixture.
      const sourceId = await evaluate(async ({ids, base}) => {
        await chrome.tabs.update(ids[0], { url: base + '/First' }); return ids[0];
      }, {ids, base});
      await waitForUrl(sourceId, '/First');
      const sourcePage = context.pages().find(page => page.url() === base + '/First');
      assert.ok(sourcePage);
      await sourcePage.goto(base + '/Second');
      await waitForUrl(sourceId, '/Second');
      const groupId = await evaluate(ids => chrome.tabs.group({ tabIds: ids }), ids);
      await run('duplicate-tab');
      let duplicate = (await snapshot()).find(tab => tab.highlighted);
      for (let i = 0; i < 100 && !duplicate.url.includes('Second'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
        duplicate = await evaluate(id => chrome.tabs.get(id), duplicate.id);
      }
      assert.ok(!ids.includes(duplicate.id));
      assert.equal(duplicate.groupId, groupId);
      assert.ok(duplicate.url.includes('Second'));
      await evaluate(id => chrome.tabs.goBack(id), duplicate.id);
      await waitForUrl(duplicate.id, '/First');
    });
    await check('mixed pinned/grouped multi-tab duplication preserves membership and ordering', async () => {
      const { ids, windowId } = await reset(5);
      const groupId = await evaluate(async ({ ids, windowId }) => {
        await chrome.tabs.update(ids[0], { pinned: true });
        const groupId = await chrome.tabs.group({ tabIds: ids.slice(2, 4) });
        await chrome.tabs.highlight({ windowId, tabs: [0, 2, 3] });
        return groupId;
      }, { ids, windowId });
      await run('duplicate-tab');
      const tabs = await snapshot();
      const copies = tabs.filter(tab => !ids.includes(tab.id));
      assert.equal(copies.length, 3);
      assert.equal(copies[0].pinned, true);
      assert.equal(copies[1].groupId, groupId);
      assert.equal(copies[2].groupId, groupId);
      for (const [i, source] of [ids[0], ids[2], ids[3]].entries()) assert.equal(tabs.findIndex(tab => tab.id === copies[i].id), tabs.findIndex(tab => tab.id === source) + 1);
      assert.deepEqual(tabs.filter(tab => tab.highlighted).map(tab => tab.id), copies.map(tab => tab.id));
    });
    await check('grouped multi-tab movement retains the existing group', async () => {
      const { ids, windowId } = await reset(5);
      const groupId = await evaluate(async ({ ids, windowId }) => {
        const groupId = await chrome.tabs.group({ tabIds: ids });
        await chrome.tabs.highlight({ windowId, tabs: [1, 2] });
        return groupId;
      }, { ids, windowId });
      await run('move-tabs-right');
      assert.deepEqual((await snapshot()).map(tab => tab.id), [ids[0], ids[3], ids[1], ids[2], ids[4]]);
      assert.ok((await snapshot()).every(tab => tab.groupId === groupId));
      await run('move-tabs-to-back');
      assert.deepEqual((await snapshot()).map(tab => tab.id), [ids[0], ids[3], ids[4], ids[1], ids[2]]);
      assert.ok((await snapshot()).every(tab => tab.groupId === groupId));
    });
    await check('move-all-groups gathers interleaved groups and retains relative order', async () => {
      const { ids } = await reset(6);
      await evaluate(async ids => {
        await chrome.tabs.update(ids[0], { pinned: true });
        await chrome.tabs.group({ tabIds: ids[1] });
        await chrome.tabs.group({ tabIds: ids[3] });
      }, ids);
      await run('move-all-groups');
      assert.deepEqual((await snapshot()).map(tab => tab.id), [ids[0], ids[2], ids[4], ids[5], ids[1], ids[3]]);
      await run('move-all-groups');
      assert.deepEqual((await snapshot()).map(tab => tab.id), [ids[0], ids[1], ids[3], ids[2], ids[4], ids[5]]);
    });
    await check('single new-tab window and singleton group replacement survive loading races', async () => {
      const { ids, windowId } = await reset(1);
      await evaluate(id => chrome.tabs.update(id, { url: 'chrome://newtab/' }), ids[0]);
      await waitForUrl(ids[0], 'chrome://newtab/');
      async function replaceAndObserve(command) {
        return evaluate(async command => {
          const check = isBlankTab;
          const observations = [];
          isBlankTab = tab => { const reusable = check(tab); observations.push(reusable); return reusable; };
          try {
            await enqueueCommand(() => runCommand(command));
            return { observations, tabs: await chrome.tabs.query({ windowId: (await resolveWindow()).id }) };
          } finally { isBlankTab = check; }
        }, command);
      }
      const first = await replaceAndObserve('open-tab-at-end');
      assert.equal(first.tabs.length, first.observations.length === 2 && first.observations[1] ? 1 : 2);
      assert.ok(first.tabs.some(tab => tab.id !== ids[0]));
      assert.ok(first.tabs.every(tab => tab.windowId === windowId));
      // Establish a single completed grouped new tab for the second case.
      const keep = first.tabs.find(tab => tab.active);
      const extra = first.tabs.filter(tab => tab.id !== keep.id).map(tab => tab.id);
      if (extra.length) await evaluate(ids => chrome.tabs.remove(ids), extra);
      const groupId = await evaluate(id => chrome.tabs.group({ tabIds: id }), keep.id);
      await waitForUrl(keep.id, 'chrome://newtab/');
      const second = await replaceAndObserve('add-tab-to-current-group');
      assert.equal(second.tabs.length, second.observations.length === 2 && second.observations[1] ? 1 : 2);
      assert.ok(second.tabs.every(tab => tab.groupId === groupId));
      assert.ok(second.tabs.some(tab => tab.id !== keep.id));
    });
    await check('real pages titled New Tab and unrelated new tabs survive', async () => {
      const { ids } = await reset(3);
      await evaluate(async ({ids, base}) => {
        await chrome.tabs.update(ids[1], { url: base + '/New%20Tab' });
        await chrome.tabs.update(ids[2], { url: 'chrome://newtab/' });
        await chrome.tabs.update(ids[0], { active: true });
      }, {ids, base});
      await run('open-tab-near');
      const tabs = await snapshot();
      assert.ok(tabs.some(tab => tab.id === ids[1]));
      assert.ok(tabs.some(tab => tab.id === ids[2]));
    });
    await check('rapid C-A-C toggle uses immediate history', async () => {
      const { ids } = await reset(3);
      await evaluate(async ids => {
        await chrome.tabs.update(ids[0], { active: true }); await historyQueue;
        await chrome.tabs.update(ids[2], { active: true }); await historyQueue;
      }, ids);
      await run('switch-to-last-tab');
      assert.equal((await snapshot()).find(tab => tab.active).id, ids[0]);
      await run('switch-to-last-tab');
      assert.equal((await snapshot()).find(tab => tab.active).id, ids[2]);
    });
    await check('recent-tab walk uses a stable list, skips closures, stops, and resets', async () => {
      const { ids } = await reset(6);
      await evaluate(async ids => {
        for (const id of ids) {
          await chrome.tabs.update(id, { active: true });
          await historyQueue;
        }
      }, ids);
      await run('walk-recent-tabs');
      assert.equal((await snapshot()).find(tab => tab.active).id, ids[4]);
      await evaluate(id => chrome.tabs.remove(id), ids[3]);
      for (const id of [ids[2], ids[1], ids[0]]) {
        await run('walk-recent-tabs');
        assert.equal((await snapshot()).find(tab => tab.active).id, id);
      }
      await assert.rejects(run('walk-recent-tabs'), /oldest available tab/);
      assert.equal((await snapshot()).find(tab => tab.active).id, ids[0]);
      // Reversing immediately after exhaustion skips the current endpoint and
      // retraces the original list, including a tab closed during the walk.
      for (const id of [ids[1], ids[2], ids[4], ids[5]]) {
        await run('walk-recent-tabs-forward');
        assert.equal((await snapshot()).find(tab => tab.active).id, id);
      }
      await assert.rejects(run('walk-recent-tabs-forward'), /newest available tab/);
      await run('walk-recent-tabs');
      assert.equal((await snapshot()).find(tab => tab.active).id, ids[4]);
      await evaluate(async id => { await chrome.tabs.update(id, { active: true }); await historyQueue; }, ids[5]);
      await run('walk-recent-tabs');
      assert.equal((await snapshot()).find(tab => tab.active).id, ids[4]);
      await run('switch-to-last-tab');
      assert.equal((await snapshot()).find(tab => tab.active).id, ids[5]);
    });
    await check('last active skips multiple closed recent tabs and keeps toggling', async () => {
      const { ids } = await reset(6);
      await evaluate(async ids => {
        for (const id of ids) {
          await chrome.tabs.update(id, { active: true });
          await historyQueue;
        }
        await chrome.tabs.remove(ids.slice(2, 5));
        // Invoke without waiting for removal bookkeeping to settle.
      }, ids);
      await run('switch-to-last-tab');
      assert.equal((await snapshot()).find(tab => tab.active).id, ids[1]);
      await run('switch-to-last-tab');
      assert.equal((await snapshot()).find(tab => tab.active).id, ids[5]);
    });
    await check('last active handles bulk closing including the active tab', async () => {
      const { ids } = await reset(6);
      await evaluate(async ids => {
        for (const id of ids) {
          await chrome.tabs.update(id, { active: true });
          await historyQueue;
        }
        await chrome.tabs.remove(ids.slice(2));
      }, ids);
      const current = (await snapshot()).find(tab => tab.active).id;
      const expected = ids.slice(0, 2).find(id => id !== current);
      await run('switch-to-last-tab');
      assert.equal((await snapshot()).find(tab => tab.active).id, expected);
      await run('switch-to-last-tab');
      assert.equal((await snapshot()).find(tab => tab.active).id, current);
      await evaluate(id => chrome.tabs.remove(id), current);
      await assert.rejects(run('switch-to-last-tab'), /No previous tab/);
      assert.equal((await snapshot()).find(tab => tab.active).id, expected);
    });
    await check('last active and history walk cross windows and reveal collapsed groups', async () => {
      const { ids, windowId } = await reset(2);
      const fromWindow = (command, id) => process.env.SHORTCUTS_HEADED === '1' ? run(command) : evaluate(async ({ command, id }) => {
        // Headless Chromium can mark both windows focused and retain an old
        // getLastFocused result. Exercise handlers with the known source;
        // the optional headed run verifies native context resolution as well.
        const window = await chrome.windows.get(id);
        const tabs = await chrome.tabs.query({ windowId: id });
        await enqueueCommand(() => handlers[command]({ window, tabs, active: tabs.find(tab => tab.active), selected: tabs.filter(tab => tab.highlighted) }));
      }, { command, id });
      const other = await evaluate(async () => {
        const window = await chrome.windows.create({ url: 'about:blank', focused: true });
        const [tab] = await chrome.tabs.query({ windowId: window.id, active: true });
        const groupId = await chrome.tabs.group({ tabIds: tab.id });
        await chrome.tabs.create({ windowId: window.id, active: true, url: 'about:blank' });
        await chrome.tabGroups.update(groupId, { collapsed: true });
        await historyQueue;
        return { windowId: window.id, tabId: tab.id, groupId };
      });
      await evaluate(({ id, url }) => chrome.tabs.update(id, { url }), { id: ids[0], url: base + '/history-current' });
      await waitForUrl(ids[0], '/history-current');
      await context.pages().find(page => page.url().includes('/history-current')).bringToFront();
      await evaluate(async ({ windowId, current, previous }) => {
        await chrome.windows.update(windowId, { focused: true });
        await chrome.tabs.update(current, { active: true });
        await historyQueue;
        await enqueueHistory(() => chrome.storage.session.set({ tabHistory: [{ tabId: current }, { tabId: previous }] }));
      }, { windowId, current: ids[0], previous: other.tabId });
      for (let i = 0; i < 6; i++) {
        await fromWindow('switch-to-last-tab', i % 2 === 0 ? windowId : other.windowId);
        const expectedWindow = i % 2 === 0 ? other.windowId : windowId;
        // Native window focus is delivered asynchronously by Chromium.
        for (let attempt = 0; attempt < 100; attempt++) {
          if (await evaluate(async id => (await chrome.windows.get(id)).focused, expectedWindow)) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        const active = await evaluate(async id => {
          await historyQueue;
          const [tab] = await chrome.tabs.query({ windowId: id, active: true });
          return tab.id;
        }, expectedWindow);
        assert.equal(active, i % 2 === 0 ? other.tabId : ids[0]);
      }
      assert.equal((await evaluate(id => chrome.tabGroups.get(id), other.groupId)).collapsed, false);
      await evaluate(async ({ current, previous, older }) => {
        await historyQueue;
        await chrome.storage.session.remove(HISTORY_WALK_KEY);
        await chrome.storage.session.set({ tabHistory: [{ tabId: current }, { tabId: previous }, { tabId: older }] });
      }, { current: ids[0], previous: other.tabId, older: ids[1] });
      await fromWindow('walk-recent-tabs', windowId);
      await evaluate(async id => {
        for (let i = 0; i < 100 && !(await chrome.windows.get(id)).focused; i++) await new Promise(resolve => setTimeout(resolve, 20));
        await historyQueue;
      }, other.windowId);
      assert.equal(await evaluate(async () => (await chrome.storage.session.get(HISTORY_WALK_KEY))[HISTORY_WALK_KEY]?.currentTabId), other.tabId);
      await fromWindow('walk-recent-tabs', other.windowId);
      assert.equal((await evaluate(async id => chrome.tabs.query({ windowId: id, active: true }), windowId))[0].id, ids[1]);
      await fromWindow('walk-recent-tabs-forward', windowId);
      assert.equal((await evaluate(async id => chrome.tabs.query({ windowId: id, active: true }), other.windowId))[0].id, other.tabId);
    });
    await check('group cycling expands destination and preserves selection', async () => {
      const { ids } = await reset(4);
      const groupId = await evaluate(async ids => {
        await chrome.tabs.group({ tabIds: ids.slice(0, 2) });
        const groupId = await chrome.tabs.group({ tabIds: ids.slice(2) });
        await chrome.tabGroups.update(groupId, { collapsed: true });
        await chrome.tabs.update(ids[0], { active: true });
        return groupId;
      }, ids);
      await run('cycle-tab-groups');
      assert.equal((await snapshot()).find(tab => tab.id === ids[0]).groupId, groupId);
      assert.equal((await evaluate(id => chrome.tabGroups.get(id), groupId)).collapsed, false);
    });
    await check('global context excludes popup windows and returns to normal window', async () => {
      const { windowId } = await reset(1);
      const popup = await evaluate(() => chrome.windows.create({ type: 'popup', url: 'about:blank', focused: true }));
      await run('open-tab-near');
      const windows = await evaluate(() => chrome.windows.getAll());
      assert.equal(windows.find(window => window.focused).id, windowId);
      assert.equal((await evaluate(id => chrome.tabs.query({ windowId: id }), popup.id)).length, 1);
      await evaluate(id => chrome.windows.remove(id), popup.id);
    });
    await check('front/back repeated presses pin and unpin', async () => {
      const { ids } = await reset(3);
      await evaluate(id => chrome.tabs.update(id, { active: true }), ids[1]);
      await run('move-tabs-to-front'); await run('move-tabs-to-front');
      assert.equal((await snapshot()).find(tab => tab.id === ids[1]).pinned, true);
      await run('move-tabs-to-back'); await run('move-tabs-to-back');
      assert.equal((await snapshot()).find(tab => tab.id === ids[1]).pinned, false);
    });
    await check('cross-window selected grouped tabs preserve order and group metadata', async () => {
      const { ids, windowId } = await reset(3);
      const { targetId, groupId } = await evaluate(async ({ ids, windowId }) => {
        const groupId = await chrome.tabs.group({ tabIds: ids.slice(0, 2) });
        await chrome.tabGroups.update(groupId, { title: 'Work', color: 'green' });
        const target = await chrome.windows.create({ url: 'about:blank', focused: false });
        await chrome.windows.update(windowId, { focused: true });
        await chrome.tabs.highlight({ windowId, tabs: [0, 1] });
        return { targetId: target.id, groupId };
      }, { ids, windowId });
      await run('move-tabs-to-window');
      const moved = await evaluate(id => chrome.tabs.query({ windowId: id }), targetId);
      assert.deepEqual(moved.filter(tab => ids.includes(tab.id)).map(tab => tab.id), ids.slice(0, 2));
      const group = await evaluate(id => chrome.tabGroups.get(id), moved.find(tab => tab.id === ids[0]).groupId);
      assert.equal(group.title, 'Work'); assert.equal(group.color, 'green');
    });
    await check('extension-owned clipboard copies internal URL', async () => {
      const { ids } = await reset(1);
      await evaluate(id => chrome.tabs.update(id, { url: 'chrome://settings/' }), ids[0]);
      await run('copy-url');
      const contexts = await evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
      assert.equal(contexts.length, 1);
      const offscreen = context.pages().find(page => page.url().endsWith('/offscreen.html'));
      if (offscreen) {
        // Chromium may deny reading without clipboardRead, but writing must succeed.
        assert.equal(await offscreen.evaluate(() => document.title), 'Clipboard');
      }
    });
    await check('popup renders read-only command rows and search', async () => {
      await reset(2);
      const popup = await context.newPage();
      const errors = [];
      popup.on('pageerror', error => errors.push(error.message));
      await popup.goto(`chrome-extension://${id}/popup.html`);
      await popup.locator('.shortcut-item').first().waitFor();
      assert.equal(await popup.locator('.shortcut-item').count(), 22);
      assert.equal(await popup.locator('#backupTools').isVisible(), false);
      assert.equal(await popup.locator('#audioSection').isVisible(), false);
      assert.equal(await popup.locator('body').evaluate(element => element.scrollHeight <= element.clientHeight), true);
      for (const name of ['Pause all media', 'Manage keyboard shortcuts', 'Remember current shortcuts', 'Backup options']) assert.equal(await popup.getByRole('button',{name,exact:true}).count(),1);
      await popup.locator('#search').fill('copy');
      assert.equal(await popup.locator('.shortcut-item').count(), 2);
      await popup.locator('#search').fill('copy-url');
      assert.equal(await popup.locator('.shortcut-item').evaluate(element => element.tagName), 'DIV');
      assert.equal(await popup.locator('.shortcut-item button').count(), 0);
      await popup.locator('#search').fill('');
      await popup.emulateMedia({ colorScheme: 'dark' });
      await popup.locator('body').screenshot({ path: path.join(artifacts, 'popup-dark.png') });
      await popup.emulateMedia({ colorScheme: 'light' });
      await popup.locator('body').screenshot({ path: path.join(artifacts, 'popup-light.png') });
      assert.deepEqual(errors, []);
      await popup.close();
    });
    await check('shortcut memory persists, flags missing/changed keys, and protects the saved setup', async () => {
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup.html`);
      await popup.locator('#memorySummary').filter({hasText:'No saved setup'}).waitFor();
      await popup.locator('#rememberShortcuts').click();
      await popup.locator('#memorySummary').filter({hasText:/^Saved$/}).waitFor();
      const platform = await evaluate(async () => (await chrome.runtime.getPlatformInfo()).os);
      const key = `shortcutSnapshotV1-${platform}`;
      const original = await evaluate(async key => (await chrome.storage.sync.get(key))[key], key);
      assert.equal(Object.keys(original.bindings).length, 22);
      await popup.reload();
      await popup.locator('#memorySummary').filter({hasText:/^Saved$/}).waitFor();
      const remembered = structuredClone(original);
      remembered.bindings['duplicate-tab'] = 'Alt+Shift+X';
      remembered.bindings['go-home'] = 'Alt+Shift+H';
      remembered.savedAt++;
      await evaluate(({key, remembered}) => chrome.storage.sync.set({[key]:remembered}), {key,remembered});
      await popup.locator('#memorySummary').filter({hasText:'1 missing · 1 changed'}).waitFor();
      assert.equal(await popup.locator('.shortcut-item.missing').count(), 1);
      assert.equal(await popup.locator('.shortcut-item.changed').count(), 1);
      await popup.locator('#onlyDifferences').check();
      assert.equal(await popup.locator('.shortcut-item').count(), 2);
      await popup.locator('#search').fill('Alt+Shift+H');
      assert.equal(await popup.locator('.shortcut-item').count(), 1);
      await popup.locator('#search').fill('');
      await popup.locator('#rememberShortcuts').click();
      await popup.locator('#replaceSnapshot').waitFor();
      assert.deepEqual(await evaluate(async key => (await chrome.storage.sync.get(key))[key], key), remembered);
      await popup.locator('#cancelSnapshot').click();
      assert.deepEqual(await evaluate(async key => (await chrome.storage.sync.get(key))[key], key), remembered);
      await popup.locator('#moreTools').click();
      const downloadPromise = popup.waitForEvent('download');
      await popup.locator('#exportShortcuts').click();
      const download = await downloadPromise;
      const backup = path.join(artifacts, download.suggestedFilename());
      await download.saveAs(backup);
      assert.deepEqual(JSON.parse(await fs.readFile(backup,'utf8')), remembered);
      await popup.locator('#backupFile').setInputFiles({ name:'restore.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(original)) });
      await popup.locator('#replaceSnapshot').waitFor();
      assert.deepEqual(await evaluate(async key => (await chrome.storage.sync.get(key))[key], key), remembered);
      await popup.locator('#confirmSnapshot').click();
      await popup.locator('#memorySummary').filter({hasText:/^Saved$/}).waitFor();
      assert.deepEqual(await evaluate(async key => (await chrome.storage.sync.get(key))[key], key), original);
      await popup.locator('#backupFile').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{invalid json}')});
      await popup.getByText('This backup could not be imported.', {exact:false}).waitFor();
      assert.deepEqual(await evaluate(async key => (await chrome.storage.sync.get(key))[key], key), original);
      const mac = { ...original, platform: platform==='mac' ? 'linux' : 'mac', savedAt: original.savedAt+1 };
      await popup.locator('#backupFile').setInputFiles({name:'other-platform.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(mac))});
      await popup.locator('#memorySummary').filter({hasText:platform==='mac' ? 'Linux' : 'macOS'}).waitFor();
      assert.ok((await popup.locator('#memorySummary').getAttribute('title')).includes('Keys may differ'));
      assert.deepEqual(await evaluate(async key => (await chrome.storage.sync.get(key))[key], key), original);
      await popup.locator('#snapshotPlatform').selectOption(platform);
      await popup.locator('#memorySummary').filter({hasText:/^Saved$/}).waitFor();
      await evaluate(({key, remembered}) => chrome.storage.sync.set({[key]:remembered}),{key,remembered});
      await popup.locator('#memorySummary').filter({hasText:'1 missing · 1 changed'}).waitFor();
      await popup.locator('#moreTools').click();
      await popup.emulateMedia({colorScheme:'dark'});
      await popup.locator('body').screenshot({path:path.join(artifacts,'shortcut-memory.png')});
      await popup.close();
    });
    console.log(`Browser artifacts: ${artifacts}`);
  } finally {
    if (server) server.close();
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
