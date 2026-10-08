'use strict';
importScripts('command-errors.js');

const NONE = -1;
const HISTORY_KEY = 'tabHistory';
const HISTORY_WALK_KEY = 'tabHistoryWalk';
const MAX_HISTORY = 32;
const MEDIA_ORIGINS = ['http://*/*', 'https://*/*'];
let commandQueue = Promise.resolve();
let historyQueue = Promise.resolve();
let creatingOffscreen;

// Queues remain usable after a failure; every command has one error boundary.
function enqueueCommand(task) {
  const result = commandQueue.then(task);
  commandQueue = result.catch(() => {});
  return result;
}

function enqueueHistory(task) {
  const result = historyQueue.then(task);
  historyQueue = result.catch(() => {});
  return result;
}

async function reportError(command, error) {
  // Store no URLs, tab titles, or raw browser errors.
  console.error(`Simple Shortcuts: ${command} failed`);
  await chrome.storage.session.set({ lastError: { command, code: commandErrorCode(error), at: Date.now() } });
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#b42318' });
}

async function clearError() {
  await chrome.storage.session.remove('lastError');
  await chrome.action.setBadgeText({ text: '' });
}

async function normalWindows() {
  return (await chrome.windows.getAll({ windowTypes: ['normal'] }))
    .filter(window => window.type === 'normal');
}

async function resolveWindow() {
  const windows = await normalWindows();
  if (!windows.length) throw commandError('no_window');
  const focused = windows.filter(window => window.focused);
  if (focused.length === 1) return focused[0];
  // Chrome maintains focus order, including across worker restarts.
  // During a cross-window transition snapshots can mark both windows focused.
  const lastFocused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  return windows.find(window => window.id === lastFocused.id) || windows[0];
}

async function commandContext() {
  const window = await resolveWindow();
  await chrome.windows.update(window.id, { focused: true });
  const tabs = await chrome.tabs.query({ windowId: window.id });
  tabs.sort((a, b) => a.index - b.index);
  return { window, tabs, active: tabs.find(tab => tab.active), selected: tabs.filter(tab => tab.highlighted) };
}

async function safeGetTab(id) {
  try { return await chrome.tabs.get(id); } catch { return null; }
}

async function recordTab(tab) {
  if (!tab) return;
  const window = await chrome.windows.get(tab.windowId);
  if (window.type !== 'normal') return;
  const { [HISTORY_KEY]: stored = [] } = await chrome.storage.session.get(HISTORY_KEY);
  const { [HISTORY_WALK_KEY]: walk } = await chrome.storage.session.get(HISTORY_WALK_KEY);
  // Manual tab/window selection starts a new traversal. Our own switches save
  // their destination before activation events are processed by this queue.
  if (walk && walk.currentTabId !== tab.id) await chrome.storage.session.remove(HISTORY_WALK_KEY);
  const history = stored.filter(entry => entry.tabId !== tab.id);
  history.unshift({ tabId: tab.id, windowId: tab.windowId, incognito: tab.incognito });
  await chrome.storage.session.set({ [HISTORY_KEY]: history.slice(0, MAX_HISTORY) });
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  enqueueHistory(async () => {
    const window = await chrome.windows.get(windowId);
    // A background window can have an active tab without being the user's last tab.
    const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (window.type === 'normal' && window.focused && focused.id === windowId) await recordTab(await safeGetTab(tabId));
  }).catch(() => {}); // Closed tabs/windows are expected during activation events.
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  enqueueHistory(async () => {
    const window = await chrome.windows.get(windowId);
    if (window.type !== 'normal') return;
    const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (focused.id !== windowId) return; // Ignore a delayed event from a prior window.
    const [tab] = await chrome.tabs.query({ windowId, active: true });
    await recordTab(tab);
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  enqueueHistory(async () => {
    const { [HISTORY_KEY]: history = [] } = await chrome.storage.session.get(HISTORY_KEY);
    await chrome.storage.session.set({ [HISTORY_KEY]: history.filter(entry => entry.tabId !== tabId) });
  }).catch(() => {});
});

async function switchToLastTab(context) {
  if (!context.active) throw commandError('no_tab');
  // Synchronously enqueue the entire read/modify/switch to prevent lost activation writes.
  await enqueueHistory(async () => {
    const { [HISTORY_KEY]: history = [] } = await chrome.storage.session.get(HISTORY_KEY);
    const valid = [];
    const windows = await normalWindows();
    for (const entry of history) {
      const tab = await safeGetTab(entry.tabId);
      if (tab && tab.incognito === context.window.incognito && windows.some(window => window.id === tab.windowId)) valid.push(tab);
    }
    const target = valid.find(tab => tab.id !== context.active.id);
    await recordTab(context.active);
    if (!target) throw commandError('no_previous_tab');
    if (target.groupId !== NONE) await chrome.tabGroups.update(target.groupId, { collapsed: false });
    await chrome.windows.update(target.windowId, { focused: true });
    await chrome.tabs.update(target.id, { active: true });
    await recordTab(target);
  });
}

async function walkRecentTabs(context, direction = 1) {
  if (!context.active) throw commandError('no_tab');
  await enqueueHistory(async () => {
    const stored = await chrome.storage.session.get([HISTORY_KEY, HISTORY_WALK_KEY]);
    let walk = stored[HISTORY_WALK_KEY];
    if (!walk || walk.currentTabId !== context.active.id || walk.incognito !== context.window.incognito) {
      const ids = [...new Set([context.active.id, ...(stored[HISTORY_KEY] || []).map(entry => entry.tabId)])].slice(0, MAX_HISTORY);
      walk = { ids, index: 0, currentTabId: context.active.id, incognito: context.window.incognito };
    }
    // Keep the cursor on the current tab, including walks saved by 0.5.0 after
    // reaching its end. Reversing direction must immediately leave that tab.
    walk.index = walk.ids.indexOf(context.active.id);
    const windows = await normalWindows();
    for (let index = walk.index + direction; index >= 0 && index < walk.ids.length; index += direction) {
      const tab = await safeGetTab(walk.ids[index]);
      if (!tab || tab.incognito !== walk.incognito || !windows.some(window => window.id === tab.windowId)) continue;
      try {
        if (tab.groupId !== NONE) await chrome.tabGroups.update(tab.groupId, { collapsed: false });
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(tab.id, { active: true });
      } catch (error) {
        // A tab can close while its group/window is being focused.
        if (!await safeGetTab(tab.id)) continue;
        await chrome.storage.session.remove(HISTORY_WALK_KEY);
        throw error;
      }
      await chrome.storage.session.set({ [HISTORY_WALK_KEY]: { ...walk, index, currentTabId: tab.id } });
      await recordTab(tab);
      return;
    }
    await chrome.storage.session.set({ [HISTORY_WALK_KEY]: walk });
    throw commandError(direction > 0 ? 'history_end' : 'history_start');
  });
}

function isBlankTab(tab) {
  return !!tab && !tab.pinned && tab.status === 'complete' && !tab.pendingUrl &&
    ['chrome://newtab/', 'chrome://newtab', 'chrome://new-tab-page/', 'chrome://new-tab-page'].includes(tab.url);
}

async function createNewTab(context, position) {
  if (!context.active) return;
  const groupId = position !== 'end' ? context.active.groupId : NONE;
  const groupTabs = context.tabs.filter(tab => tab.groupId === groupId);
  const index = position === 'end' ? context.tabs.length :
    position === 'group' && groupId !== NONE ? groupTabs.at(-1).index + 1 : context.active.index + 1;
  const candidate = position === 'near' || (position === 'group' && groupId === NONE) ? context.tabs[index] : context.tabs[index - 1];
  const reusable = isBlankTab(candidate) && candidate.groupId === groupId;
  // Create and group before closing anything: one-tab windows/groups stay alive.
  const created = await chrome.tabs.create({ windowId: context.window.id, index: reusable ? candidate.index : index, active: true });
  if (groupId !== NONE) await chrome.tabs.group({ groupId, tabIds: created.id });
  else await chrome.tabs.ungroup(created.id);
  if (reusable) {
    const fresh = await safeGetTab(candidate.id);
    if (isBlankTab(fresh) && fresh.groupId === groupId && fresh.windowId === context.window.id) {
      await chrome.tabs.remove(candidate.id);
    }
  }
}

async function highlightIds(windowId, ids, activeId = ids[0]) {
  const tabs = await chrome.tabs.query({ windowId });
  const selected = ids.map(id => tabs.find(tab => tab.id === id)).filter(Boolean);
  selected.sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId));
  if (selected.length) await chrome.tabs.highlight({ windowId, tabs: selected.map(tab => tab.index) });
}

async function duplicateTabs(context) {
  const ids = [];
  for (const original of context.selected) {
    const source = await chrome.tabs.get(original.id);
    const duplicate = await chrome.tabs.duplicate(source.id);
    if (!duplicate) throw new Error('Duplication failed');
    ids.push(duplicate.id);
    await chrome.tabs.update(duplicate.id, { pinned: source.pinned });
    if (source.groupId !== NONE) await chrome.tabs.group({ groupId: source.groupId, tabIds: duplicate.id });
    else if (!source.pinned) await chrome.tabs.ungroup(duplicate.id);
    const refreshed = await chrome.tabs.get(source.id);
    await chrome.tabs.move(duplicate.id, { index: refreshed.index + 1 });
  }
  await highlightIds(context.window.id, ids);
}

async function setPinned(tabs, pinned) {
  for (const tab of pinned ? tabs : [...tabs].reverse()) await chrome.tabs.update(tab.id, { pinned });
}

// Move one tab at a time to avoid Chromium's multi-tab rightward ordering bug.
async function moveBlock(tabs, index, direction) {
  if (!tabs.length) return;
  const ordered = direction > 0 ? [...tabs].reverse() : tabs;
  for (const tab of ordered) {
    const offset = tabs.findIndex(item => item.id === tab.id);
    await chrome.tabs.move(tab.id, { index: index + offset });
  }
}

function sections(tabs, allTabs) {
  const result = new Map();
  for (const tab of tabs) {
    const boundary = !tab.pinned && tab.groupId === NONE ? (allTabs.slice(0, tab.index).findLast(item => item.groupId !== NONE)?.id ?? NONE) : NONE;
    const key = `${tab.pinned}:${tab.groupId}:${boundary}`;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(tab);
  }
  return [...result.values()];
}

async function moveSide(context, direction, bounded = false) {
  const selected = context.selected;
  if (!selected.length) return;
  const parts = sections(selected, context.tabs);
  if (parts.length > 1 && !bounded) {
    // Mixed selections stay within their existing pin/group sections.
    for (const part of direction > 0 ? [...parts].reverse() : parts) {
      const tabs = await chrome.tabs.query({ windowId: context.window.id });
      await moveSide({ ...context, tabs, selected: part.map(tab => tabs.find(item => item.id === tab.id)).filter(Boolean) }, direction, true);
    }
    await highlightIds(context.window.id, selected.map(tab => tab.id), context.active?.id);
    return;
  }
  const first = selected[0];
  const last = selected.at(-1);
  const selectedIds = new Set(selected.map(tab => tab.id));
  let index = direction < 0 ? first.index - 1 : last.index + 1;
  let neighbor = context.tabs[index];
  if (bounded) {
    const within = tab => tab.pinned === first.pinned && tab.groupId === first.groupId;
    if (!neighbor || !within(neighbor)) return;
  }
  if (!neighbor) {
    if (!bounded && first.groupId !== NONE) await chrome.tabs.ungroup(selected.map(tab => tab.id));
    return;
  }
  if (neighbor.pinned !== first.pinned) {
    if (!bounded) await setPinned(selected, neighbor.pinned);
    return;
  }
  if (first.groupId !== NONE && neighbor.groupId !== first.groupId) {
    if (!bounded) await chrome.tabs.ungroup(selected.map(tab => tab.id));
    return;
  }
  const groups = await chrome.tabGroups.query({ windowId: context.window.id });
  const collapsed = new Set(groups.filter(group => group.collapsed).map(group => group.id));
  let skipped = false;
  while (index >= 0 && index < context.tabs.length && collapsed.has(context.tabs[index].groupId) && context.tabs[index].groupId !== first.groupId) {
    skipped = true;
    index += direction;
  }
  neighbor = context.tabs[index];
  if (!skipped && neighbor && !neighbor.pinned && first.groupId === NONE && neighbor.groupId !== NONE && !collapsed.has(neighbor.groupId)) {
    await chrome.tabs.group({ groupId: neighbor.groupId, tabIds: selected.map(tab => tab.id) });
  } else {
    // Insertion indices are computed after removing the selected tabs.
    const remaining = context.tabs.filter(tab => !selectedIds.has(tab.id));
    let insertion;
    if (direction < 0) insertion = remaining.filter(tab => skipped ? tab.index <= index : tab.index < index).length;
    else insertion = remaining.filter(tab => skipped ? tab.index < index : tab.index <= index).length;
    insertion = Math.max(first.pinned ? 0 : remaining.filter(tab => tab.pinned).length, insertion);
    await moveBlock(selected, insertion, direction);
  }
  await highlightIds(context.window.id, selected.map(tab => tab.id), context.active?.id);
}

async function moveEdge(context, back) {
  if (!context.selected.length) return;
  const command = back ? 'move-tabs-to-back' : 'move-tabs-to-front';
  const { lastAction } = await chrome.storage.session.get('lastAction');
  const ids = context.selected.map(tab => tab.id);
  const repeat = lastAction?.command === command && lastAction.windowId === context.window.id &&
    Date.now() - lastAction.at < 2000 && JSON.stringify(lastAction.ids) === JSON.stringify(ids);
  const parts = sections(context.selected, context.tabs);
  for (const part of back ? [...parts].reverse() : parts) {
    const all = await chrome.tabs.query({ windowId: context.window.id });
    const first = part[0];
    let domain = all.filter(tab => first.pinned ? tab.pinned : first.groupId !== NONE ? tab.groupId === first.groupId : !tab.pinned);
    if (parts.length > 1 && !first.pinned && first.groupId === NONE) {
      // Restrict ungrouped selections to the contiguous segment containing them.
      const low = all.slice(0, first.index).findLast(tab => tab.pinned || tab.groupId !== NONE)?.index ?? -1;
      const high = all.slice(first.index + 1).find(tab => tab.groupId !== NONE)?.index ?? all.length;
      domain = domain.filter(tab => tab.index > low && tab.index < high);
      if (!part.every(tab => domain.some(item => item.id === tab.id))) continue;
    }
    const index = back ? domain.at(-1).index - part.length + 1 : domain[0].index;
    const atEdge = part.every((tab, i) => all.find(item => item.id === tab.id)?.index === index + i);
    if (repeat && parts.length === 1 && atEdge && first.groupId !== NONE) await chrome.tabs.ungroup(part.map(tab => tab.id));
    else if (repeat && parts.length === 1 && atEdge && ((!back && !first.pinned) || (back && first.pinned))) await setPinned(part, !back);
    else {
      await moveBlock(part, index, back ? 1 : -1);
      if (first.groupId === NONE && !first.pinned) await chrome.tabs.ungroup(part.map(tab => tab.id));
    }
  }
  await chrome.storage.session.set({ lastAction: { command, windowId: context.window.id, ids, at: Date.now() } });
  await highlightIds(context.window.id, ids, context.active?.id);
}

async function cycleGroups(context) {
  if (!context.selected.length) return;
  const groups = await chrome.tabGroups.query({ windowId: context.window.id });
  groups.sort((a, b) => context.tabs.find(tab => tab.groupId === a.id).index - context.tabs.find(tab => tab.groupId === b.id).index);
  if (!groups.length) throw commandError('no_group');
  const current = groups.findIndex(group => group.id === context.active?.groupId);
  const target = groups[(current + 1) % groups.length];
  await setPinned(context.selected.filter(tab => tab.pinned), false);
  await chrome.tabs.group({ groupId: target.id, tabIds: context.selected.map(tab => tab.id) });
  await chrome.tabGroups.update(target.id, { collapsed: false });
  await highlightIds(context.window.id, context.selected.map(tab => tab.id), context.active?.id);
}

async function cycleWindows(context, move) {
  const windows = (await normalWindows()).filter(window => window.incognito === context.window.incognito).sort((a, b) => a.id - b.id);
  if (windows.length < 2) throw commandError('no_other_window');
  const target = windows[(windows.findIndex(window => window.id === context.window.id) + 1) % windows.length];
  if (move) {
    // Cross-window tab groups cannot retain their IDs. Recreate their metadata.
    const groups = await chrome.tabGroups.query({ windowId: context.window.id });
    const moved = [];
    for (const tab of context.selected) {
      await chrome.tabs.move(tab.id, { windowId: target.id, index: tab.pinned ? (await chrome.tabs.query({ windowId: target.id, pinned: true })).length : -1 });
      moved.push(tab.id);
    }
    for (const group of groups) {
      const ids = context.selected.filter(tab => tab.groupId === group.id).map(tab => tab.id);
      if (!ids.length) continue;
      const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: target.id } });
      await chrome.tabGroups.update(groupId, { title: group.title, color: group.color, collapsed: false });
    }
    await highlightIds(target.id, moved, context.active?.id);
  }
  await chrome.windows.update(target.id, { focused: true });
}

async function moveAllGroups(context) {
  const groups = await chrome.tabGroups.query({ windowId: context.window.id });
  groups.sort((a, b) => context.tabs.find(tab => tab.groupId === a.id).index - context.tabs.find(tab => tab.groupId === b.id).index);
  if (!groups.length) throw commandError('no_group');
  const grouped = context.tabs.filter(tab => tab.groupId !== NONE);
  const ungrouped = context.tabs.filter(tab => tab.groupId === NONE && !tab.pinned);
  const atBack = !ungrouped.length || Math.min(...grouped.map(tab => tab.index)) > Math.max(...ungrouped.map(tab => tab.index));
  for (const group of atBack ? [...groups].reverse() : groups) {
    await chrome.tabGroups.move(group.id, { index: atBack ? context.tabs.filter(tab => tab.pinned).length : -1 });
  }
}

async function writeClipboard(type, payload) {
  try {
    const url = chrome.runtime.getURL('offscreen.html');
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (!contexts.length) {
      if (!creatingOffscreen) creatingOffscreen = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CLIPBOARD', 'BLOBS', 'IFRAME_SCRIPTING'], justification: 'Copy selected tab links or a captured PNG image to the clipboard.' }).finally(() => { creatingOffscreen = null; });
      await creatingOffscreen;
    }
    const response = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...payload });
    if (!response?.ok) throw commandError('clipboard_failed');
  } catch { throw commandError('clipboard_failed'); }
}

async function copyUrls(context) {
  const selected = context.selected.length ? context.selected : [context.active].filter(Boolean);
  if (!selected.length) throw commandError('no_tab');
  if (selected.some(tab => !tab.url)) throw commandError('no_url');
  await writeClipboard('copy-url', { text: selected.map(tab => tab.url).join('\n') });
}

async function assertScreenshotTarget(tab) {
  const [active] = await chrome.tabs.query({ windowId: tab.windowId, active: true });
  if (active?.id !== tab.id || active.url !== tab.url || active.pendingUrl) throw commandError('screenshot_changed');
}

async function copyScreenshot(context, _granted, invokedTab) {
  const tab = context.active;
  if (!tab) throw commandError('no_tab');
  if (invokedTab && (invokedTab.id !== tab.id || invokedTab.url !== tab.url)) throw commandError('screenshot_changed');
  await assertScreenshotTarget(tab);
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(context.window.id, { format: 'png' });
  } catch (error) {
    if (/activeTab|<all_urls>|permission|Cannot access/i.test(error.message || '')) throw commandError('screenshot_permission');
    if (/MAX_CAPTURE_VISIBLE_TAB|too many|quota|exceeded/i.test(error.message || '')) throw commandError('screenshot_busy');
    if (commandErrorCode(error) === 'no_tab') throw commandError('no_tab');
    throw commandError('screenshot_failed');
  }
  // Never put a capture of a newly activated/navigated tab on the clipboard.
  await assertScreenshotTarget(tab);
  if (!dataUrl?.startsWith('data:image/png;base64,')) throw commandError('screenshot_failed');
  await writeClipboard('copy-image', { dataUrl });
}

function pauseMedia() {
  let paused = 0;
  function visit(root) {
    for (const media of root.querySelectorAll('audio, video')) {
      if (!media.paused) { media.pause(); paused++; }
    }
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) visit(element.shadowRoot);
  }
  visit(document);
  return paused;
}

async function pauseAllTabs(context, granted) {
  if (!granted) throw commandError('permission_denied');
  const windows = (await normalWindows()).filter(window => window.incognito === context.window.incognito);
  const ids = new Set(windows.map(window => window.id));
  const tabs = (await chrome.tabs.query({})).filter(tab => ids.has(tab.windowId) && /^https?:/.test(tab.url || '') && !tab.discarded);
  const results = await Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: pauseMedia })));
  const failed = results.filter(result => result.status === 'rejected').length;
  await chrome.storage.session.set({ mediaResult: { tabs: tabs.length - failed, failed, at: Date.now() } });
  if (failed) throw commandError('media_partial');
}

const handlers = {
  'duplicate-tab': duplicateTabs,
  'pin-tab': context => setPinned(context.selected, !context.selected.every(tab => tab.pinned)),
  'go-incognito': async context => {
    const urls = context.selected.map(tab => tab.url).filter(url => /^https?:/.test(url || ''));
    if (!urls.length) throw commandError('no_web_url');
    await chrome.windows.create({ url: urls, incognito: true, focused: true, state: 'maximized' });
  },
  'open-tab-near': context => createNewTab(context, 'near'),
  'add-tab-to-current-group': context => createNewTab(context, 'group'),
  'open-tab-at-end': context => createNewTab(context, 'end'),
  'move-tabs-left': context => moveSide(context, -1),
  'move-tabs-right': context => moveSide(context, 1),
  'move-tabs-to-front': context => moveEdge(context, false),
  'move-tabs-to-back': context => moveEdge(context, true),
  'switch-windows': context => cycleWindows(context, false),
  'move-tabs-to-window': context => cycleWindows(context, true),
  'toggle-collapse-groups': async context => {
    const groups = await chrome.tabGroups.query({ windowId: context.window.id });
    if (!groups.length) throw commandError('no_group');
    const collapsed = !groups.every(group => group.collapsed);
    for (const group of groups) await chrome.tabGroups.update(group.id, { collapsed });
  },
  'switch-to-last-tab': switchToLastTab,
  'walk-recent-tabs': context => walkRecentTabs(context, 1),
  'walk-recent-tabs-forward': context => walkRecentTabs(context, -1),
  'copy-url': copyUrls,
  'copy-screenshot': copyScreenshot,
  'move-all-groups': moveAllGroups,
  'go-home': async context => {
    if (!context.active?.url || !/^https?:/.test(context.active.url)) throw commandError('no_web_url');
    await chrome.tabs.update(context.active.id, { url: new URL(context.active.url).origin + '/' });
  },
  'cycle-tab-groups': cycleGroups,
  'pause-all-tabs': pauseAllTabs,
};

async function runCommand(command, granted, invokedTab) {
  if (!Object.hasOwn(handlers, command)) throw commandError('unknown_command');
  const context = await commandContext();
  if (!['walk-recent-tabs', 'walk-recent-tabs-forward'].includes(command)) await enqueueHistory(() => chrome.storage.session.remove(HISTORY_WALK_KEY));
  if (!['move-tabs-to-front', 'move-tabs-to-back'].includes(command)) await chrome.storage.session.remove('lastAction');
  await handlers[command](context, granted, invokedTab);
  await clearError();
}

chrome.commands.onCommand.addListener((command, tab) => {
  // Request in the user gesture, before awaiting context or the command queue.
  const permission = command === 'pause-all-tabs' ? chrome.permissions.request({ origins: MEDIA_ORIGINS }).catch(() => false) : Promise.resolve(undefined);
  enqueueCommand(async () => runCommand(command, await permission, tab)).catch(error => reportError(command, error).catch(() => {}));
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'background' || sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  enqueueCommand(async () => {
    if (message.type === 'run-command') {
      const granted = message.command === 'pause-all-tabs' ? await chrome.permissions.contains({ origins: MEDIA_ORIGINS }) : undefined;
      await runCommand(message.command, granted);
    } else if (message.type === 'focus-tab' || message.type === 'mute-tab') {
      const context = await commandContext();
      const tab = await chrome.tabs.get(message.tabId);
      const window = await chrome.windows.get(tab.windowId);
      if (window.type !== 'normal' || window.incognito !== context.window.incognito) throw commandError('invalid_target');
      if (message.type === 'focus-tab') {
        if (tab.groupId !== NONE) await chrome.tabGroups.update(tab.groupId, { collapsed: false });
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(tab.id, { active: true });
      } else await chrome.tabs.update(tab.id, { muted: !tab.mutedInfo.muted });
      await clearError();
    } else throw commandError('unknown_command');
    respond({ ok: true });
  }).catch(async error => {
    await reportError(message.command || message.type, error).catch(() => {});
    respond({ ok: false, code: commandErrorCode(error) });
  });
  return true;
});

// Seed the current browser session once, so the first switch after loading the
// extension can return to a tab that was already active before listeners existed.
enqueueHistory(async () => {
  const { [HISTORY_KEY]: stored } = await chrome.storage.session.get(HISTORY_KEY);
  if (Array.isArray(stored)) return;
  const windows = await normalWindows();
  const normalIds = new Set(windows.map(window => window.id));
  const focusedId = windows.find(window => window.focused)?.id;
  const tabs = (await chrome.tabs.query({})).filter(tab => normalIds.has(tab.windowId));
  tabs.sort((a, b) => Number(b.active && b.windowId === focusedId) - Number(a.active && a.windowId === focusedId) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  await chrome.storage.session.set({ [HISTORY_KEY]: tabs.slice(0, MAX_HISTORY).map(tab => ({ tabId: tab.id, windowId: tab.windowId, incognito: tab.incognito })) });
}).catch(() => {});
