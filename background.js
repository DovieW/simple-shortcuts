// Helper function to check if a tab is blank (new tab)
function isBlankTab(tab) {
  // Check for various forms of blank/new tab URLs
  return tab.url === 'chrome://newtab/' ||
         tab.url === 'about:blank' ||
         tab.url === '' ||
         tab.url === 'chrome://newtab' ||
         tab.title === 'New Tab' ||
         (tab.url.startsWith('chrome://newtab') && tab.title === 'New Tab');
}

// Helper function to close all blank tabs in the window except for a specified tab
async function closeOtherBlankTabs(exceptTabId) {
  try {
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const blankTabsToClose = allTabs.filter(tab =>
      tab.id !== exceptTabId && isBlankTab(tab)
    );

    if (blankTabsToClose.length > 0) {
      const tabIds = blankTabsToClose.map(tab => tab.id);
      await chrome.tabs.remove(tabIds);
    }
  } catch (error) {
    // Silently ignore errors (e.g., if tabs are already closed)
  }
}

// Replace a reusable blank tab with a *freshly created* new tab at the same logical spot.
// This is the most reliable way to get Chrome to auto-select the omnibox.
// Rationale: Simply re-activating an existing New Tab does not always re-select the URL bar
// if the user had interacted with it previously. Creating a brand new NTP almost always does.
async function replaceBlankTabWithFresh(blankTab, { groupId = null } = {}) {
  if (!blankTab) return;
  const index = blankTab.index;
  const targetWindowId = blankTab.windowId;
  const inGroup = groupId != null && groupId > 0;

  // Remove the old blank tab (ignore errors if already gone)
  try { await chrome.tabs.remove(blankTab.id); } catch (e) {}

  // Create the new tab; Chrome will usually auto-focus omnibox for a brand new NTP.
  const newTab = await chrome.tabs.create({ index, windowId: targetWindowId });
  if (inGroup) {
    try { await chrome.tabs.group({ groupId, tabIds: newTab.id }); } catch (e) {}
  }
  // Ensure window focused (paranoid reinforcement for omnibox focus)
  try { await chrome.windows.update(targetWindowId, { focused: true }); } catch (e) {}
  return newTab;
}

// Helper function to find or create a tab at a specific position
async function findOrCreateTabAtPosition(targetIndex, options = {}) {
  const tabs = await chrome.tabs.query({ currentWindow: true });

  // Check if there's already a tab at the target position
  if (targetIndex < tabs.length) {
    const tabAtPosition = tabs[targetIndex];
    if (isBlankTab(tabAtPosition)) {
      // Switch to the existing blank tab instead of creating a new one
      chrome.tabs.update(tabAtPosition.id, { active: true });
      return tabAtPosition;
    }
  }

  // No blank tab at position, create a new one
  return chrome.tabs.create({ index: targetIndex, ...options });
}

const LAST_ACTIVE_STORAGE_KEY = 'lastActiveTabHistory';
const LEGACY_LAST_ACTIVE_KEY = 'lastActiveTabs';
const MAX_LAST_ACTIVE_ENTRIES = 8;
const ACTIVATION_CONFIRM_DELAY = 1000;

function normalizeHistoryEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  const seen = new Set();
  const normalized = [];

  for (const entry of rawEntries) {
    if (entry == null) continue;

    if (typeof entry === 'number') {
      if (seen.has(entry)) continue;
      seen.add(entry);
      normalized.push({ tabId: entry, windowId: null, lastActiveAt: 0 });
      continue;
    }

    if (typeof entry === 'object') {
      const tabId = typeof entry.tabId === 'number' ? entry.tabId : null;
      if (tabId == null || seen.has(tabId)) continue;
      seen.add(tabId);
      normalized.push({
        tabId,
        windowId: typeof entry.windowId === 'number' ? entry.windowId : null,
        lastActiveAt: typeof entry.lastActiveAt === 'number' ? entry.lastActiveAt : 0,
      });
    }
  }

  return normalized;
}

async function fetchLastActiveHistory() {
  const data = await chrome.storage.local.get([LAST_ACTIVE_STORAGE_KEY, LEGACY_LAST_ACTIVE_KEY]);
  let history = normalizeHistoryEntries(data[LAST_ACTIVE_STORAGE_KEY]);

  if (!history.length && Array.isArray(data[LEGACY_LAST_ACTIVE_KEY])) {
    history = normalizeHistoryEntries(data[LEGACY_LAST_ACTIVE_KEY]);
    if (history.length) {
      await chrome.storage.local.set({ [LAST_ACTIVE_STORAGE_KEY]: history });
    }
  }

  return history;
}

async function storeLastActiveHistory(entries) {
  await chrome.storage.local.set({
    [LAST_ACTIVE_STORAGE_KEY]: entries.slice(0, MAX_LAST_ACTIVE_ENTRIES),
  });
}

async function recordConfirmedActiveTab(tab) {
  let history = await fetchLastActiveHistory();
  history = history.filter((entry) => entry.tabId !== tab.id);
  history.unshift({ tabId: tab.id, windowId: tab.windowId, lastActiveAt: Date.now() });
  await storeLastActiveHistory(history);
}

async function removeTabFromHistory(tabId) {
  const history = await fetchLastActiveHistory();
  const filtered = history.filter((entry) => entry.tabId !== tabId);
  if (filtered.length !== history.length) {
    await storeLastActiveHistory(filtered);
  }
}

async function safeGetTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (error) {
    return null;
  }
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'duplicate-tab') {
    chrome.tabs.query({ highlighted: true, currentWindow: true }, (tabs) => {
      tabs.forEach(tab => {
        if (tab.pinned) {
          chrome.tabs.create({ url: tab.url, index: tab.index + 1, active: true, pinned: true });
        } else {
          chrome.tabs.create({ url: tab.url, index: tab.index + 1, active: true }, (newTab) => {
            if (tab.groupId > 0) {
              chrome.tabs.group({ groupId: tab.groupId, tabIds: newTab.id });
            }
          });
        }
      });
    });
  } else if (command === 'pin-tab') {
    chrome.tabs.query({ highlighted: true, currentWindow: true }, (tabs) => {
      const shouldPin = !tabs.every(tab => tab.pinned);
      if (!shouldPin) tabs = tabs.reverse();
      tabs.forEach(tab => {
        chrome.tabs.update(tab.id, { pinned: !tabs.every(tab => tab.pinned) });
      });
    });
  } else if (command === 'go-incognito') {
    chrome.tabs.query({ highlighted: true, currentWindow: true }, (tabs) => {
      const urls = tabs.map(tab => tab.url);
      if(urls.length > 0) {
        chrome.windows.create({ url: urls, incognito: true, focused: true, state: 'maximized' });
      }
    });
  } else if (command === 'open-tab-near') {
    chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
      const tab = tabs[0];
      const targetIndex = tab.index + 1;

      // Check if there's already a blank tab at the target position
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      if (targetIndex < allTabs.length) {
        const tabAtPosition = allTabs[targetIndex];

        // Only reuse the blank tab if it's in the same group (or both are ungrouped)
        const sameGroup = (tab.groupId === tabAtPosition.groupId) ||
                         (tab.groupId <= 0 && tabAtPosition.groupId <= 0);

        if (isBlankTab(tabAtPosition) && sameGroup) {
          const newTab = await replaceBlankTabWithFresh(tabAtPosition, {
            groupId: tab.groupId > 0 ? tab.groupId : null,
          });
          // Close other blank tabs after creating the new tab
          await closeOtherBlankTabs(newTab ? newTab.id : null);
          return;
        }
      }

      // No suitable blank tab at position, create a new one
      chrome.tabs.create({ index: targetIndex, pinned: false }, async (newTab) => {
        if (tab.groupId > 0) {
          chrome.tabs.group({ groupId: tab.groupId, tabIds: newTab.id });
        }
        // Close other blank tabs after creating the new tab
        await closeOtherBlankTabs(newTab.id);
      });
    });
  } else if (command === 'open-tab-at-end') {
    chrome.tabs.query({ currentWindow: true }, async (tabs) => {
      const lastIndex = tabs.length - 1;

      // Debug logging
      if (tabs.length > 0) {
        const lastTab = tabs[lastIndex];
      }

      // We only want to "reuse" (refresh) an existing blank tab at the end
      // if it is NOT inside a group. If the last tab is a blank tab that is
      // grouped, we must ignore it and instead create a brand new ungrouped
      // tab after all tabs. Previous behavior ungrouped the tab (by replacing
      // it without re-adding to the group), which was undesirable.
      if (tabs.length > 0) {
        const lastTab = tabs[lastIndex];
        const isUngrouped =
          lastTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE ||
          lastTab.groupId <= 0;
        const isReusableBlank = isBlankTab(lastTab) && isUngrouped;

        if (isReusableBlank) {
          // Safe to replace to trigger omnibox focus; remains ungrouped.
          const newTab = await replaceBlankTabWithFresh(lastTab, { groupId: null });
          // Close other blank tabs after creating the new tab
          await closeOtherBlankTabs(newTab ? newTab.id : null);
          return;
        }
      }

      // Either there was no tab, or the last tab was grouped (blank or not),
      // or it was a non-blank tab. Create a brand new ungrouped tab at end.
      const newTab = await chrome.tabs.create({ index: lastIndex + 1 });
      // Close other blank tabs after creating the new tab
      await closeOtherBlankTabs(newTab.id);
    });
  } else if (command === 'add-tab-to-current-group') {
    if (tab.groupId > 0) {
      chrome.tabs.query({ currentWindow: true }, async (allTabs) => {
        // Get all tabs in the current group
        const groupTabs = allTabs.filter(t => t.groupId === tab.groupId);
        const lastGroupTabIndex = Math.max(...groupTabs.map(t => t.index));
        const lastGroupTab = allTabs.find(t => t.index === lastGroupTabIndex);

        // Check if the last tab in the group is already a blank tab
        if (isBlankTab(lastGroupTab)) {
          const newTab = await replaceBlankTabWithFresh(lastGroupTab, { groupId: tab.groupId });
          // Close other blank tabs after creating the new tab
          await closeOtherBlankTabs(newTab ? newTab.id : null);
        } else {
          // Create a new tab at the end of the group
          const targetIndex = lastGroupTabIndex + 1;
          chrome.tabs.create({ index: targetIndex }, async (newTab) => {
            chrome.tabs.group({ groupId: tab.groupId, tabIds: newTab.id });
            // Close other blank tabs after creating the new tab
            await closeOtherBlankTabs(newTab.id);
          });
        }
      });
    } else {
    }
  } else if (command === "switch-windows") {
    chrome.windows.getAll({populate: false, windowTypes: ["normal"]}, (windows) => {
      if (windows.length < 2) return;

      chrome.windows.getCurrent((currentWindow) => {
        let currentIndex = windows.findIndex(w => w.id === currentWindow.id);
        let nextIndex = (currentIndex + 1) % windows.length;

        chrome.windows.update(windows[nextIndex].id, { focused: true });
      });
    });
  } else if (command === "toggle-collapse-groups") {
    chrome.tabGroups.query({windowId: chrome.windows.WINDOW_ID_CURRENT}, (groups) => {
      if (groups.length === 0) return;
      groups.forEach(group => {
        chrome.tabGroups.update(group.id, { collapsed: !groups.every(group => group.collapsed)});
      });
    });
  } else if (command === "switch-to-last-tab") {
    await handleSwitchToLastTab();
  } else if (command === 'copy-url') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const currentTab = tabs[0];
        chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: () => {
            navigator.clipboard.writeText(window.location.href);
          }
        });
      }
    });
  } else if (command === 'move-tabs-to-window') {
    chrome.tabs.query({ highlighted: true, currentWindow: true }, (highlightedTabs) => {
      if (highlightedTabs.length === 0) return;

      chrome.windows.getAll({ populate: false, windowTypes: ["normal"] }, (windows) => {
        if (windows.length < 2) return; // Need at least 2 windows to move tabs

        chrome.windows.getCurrent((currentWindow) => {
          // Find current window index
          let currentIndex = windows.findIndex(w => w.id === currentWindow.id);
          // Calculate next window index (cycle)
          let nextIndex = (currentIndex + 1) % windows.length;
          let targetWindow = windows[nextIndex];

          // Move tabs to target window first
          const tabIds = highlightedTabs.map(tab => tab.id);
          const firstTabId = tabIds[0]; // Store the first tab ID to activate

          chrome.tabs.move(tabIds, { windowId: targetWindow.id, index: -1 }, () => {
            // Focus the target window first
            chrome.windows.update(targetWindow.id, { focused: true }, () => {
              // If multiple tabs were moved, highlight them all using chrome.tabs.highlight
              if (tabIds.length > 1) {
                // Query the target window to get the indices of moved tabs
                chrome.tabs.query({ windowId: targetWindow.id }, (windowTabs) => {
                  const movedTabIndices = [];
                  tabIds.forEach(tabId => {
                    const tab = windowTabs.find(t => t.id === tabId);
                    if (tab) {
                      movedTabIndices.push(tab.index);
                    }
                  });

                  // Highlight all moved tabs by their indices
                  if (movedTabIndices.length > 0) {
                    chrome.tabs.highlight({
                      windowId: targetWindow.id,
                      tabs: movedTabIndices
                    });
                  }
                });
              } else {
                // Single tab, just make it active
                chrome.tabs.update(firstTabId, { active: true });
              }
            });
          });
        });
      });
    });
  } else if (command === 'move-all-groups') {
    handleMoveAllGroups();
  } else if (command === 'go-home') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const currentTab = tabs[0];
        try {
          const url = new URL(currentTab.url);
          const homeUrl = url.origin + '/';
          if (currentTab.url !== homeUrl) {
            chrome.tabs.update(currentTab.id, { url: homeUrl });
          }
        } catch (e) {
          // Invalid URL, ignore
        }
      }
    });
  } else if (command === 'pause-or-show-audio-tabs') {
    await handlePauseOrShowAudioTabs();
  }
});

// Track tab activation with a delay to avoid rapid switching issues
let tabActivationTimer = null;

chrome.tabs.onActivated.addListener((activeInfo) => {
  const activatedTabId = activeInfo.tabId;

  if (tabActivationTimer) {
    clearTimeout(tabActivationTimer);
  }

  tabActivationTimer = setTimeout(async () => {
    try {
      const tab = await safeGetTab(activatedTabId);
      if (!tab || !tab.active) {
        return;
      }
      await recordConfirmedActiveTab(tab);
    } finally {
      tabActivationTimer = null;
    }
  }, ACTIVATION_CONFIRM_DELAY);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabFromHistory(tabId).catch(() => {});
});

// Track window focus changes to record cross-window tab switches
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  // Clear any pending same-window activation timer since we're switching windows
  if (tabActivationTimer) {
    clearTimeout(tabActivationTimer);
    tabActivationTimer = null;
  }

  // Start a new timer for the active tab in the newly focused window
  tabActivationTimer = setTimeout(async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, windowId });
      if (tabs.length === 0) return;
      const tab = tabs[0];
      if (!tab.active) return;
      await recordConfirmedActiveTab(tab);
    } finally {
      tabActivationTimer = null;
    }
  }, ACTIVATION_CONFIRM_DELAY);
});

chrome.commands.onCommand.addListener(async (cmd) => {
  const MOVE_LEFT = 'move-tabs-left';
  const MOVE_RIGHT = 'move-tabs-right';
  const MOVE_FRONT = 'move-tabs-to-front';
  const MOVE_BACK = 'move-tabs-to-back';

  let highlightedTabs = await chrome.tabs.query({ currentWindow: true, highlighted: true});

  switch (cmd) {
    case MOVE_LEFT:
      moveTabs(highlightedTabs, highlightedTabs[0].index - 1, cmd);
      break;
    case MOVE_RIGHT:
      moveTabs(highlightedTabs, highlightedTabs[highlightedTabs.length - 1].index + 1, cmd);
      break;
    case MOVE_BACK:
      await handleMoveToBack(highlightedTabs);
      break;
    case MOVE_FRONT:
      await handleMoveToFront(highlightedTabs);
      break;
    default:
  }
});

async function moveTabs(tabs, destIndex, cmd) {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  // const { skipClosedGroups } = await chrome.storage.sync.get({ skipClosedGroups: true });
  const skipClosedGroups = true;
  let tabsGoingRight = cmd === 'move-tabs-right' || cmd === 'move-tabs-to-back';
  const tabIds = tabs.map((tab) => tab.id);
  const firstTab = tabs[0];
  const goingToFrontOrBack = cmd === 'move-tabs-to-front' || cmd === 'move-tabs-to-back';
  let groupSkipped = false;
  let isTabInGroup = firstTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
  let tabToBeReplaced = allTabs[destIndex]; // If undefined, then the tab is being moved to the end

  if (tabToBeReplaced) {
    // if (tabToBeReplaced.pinned && cmd === 'move-tabs-to-front') {
    //   tabToBeReplaced = allTabs[destIndex + 1];
    // }

    if (tabToBeReplaced.pinned && !firstTab.pinned) {
      for (tabId of tabIds) {
        chrome.tabs.update(tabId, { pinned: true });
      }
      return;
    } else if (!tabToBeReplaced.pinned && firstTab.pinned) {
      for (tabId of tabIds.reverse()) {
        chrome.tabs.update(tabId, { pinned: false });
      }
      return;
    }
  }

  if (!goingToFrontOrBack && (destIndex < 0 || destIndex >= allTabs.length)) {
    if (isTabInGroup) {
      chrome.tabs.ungroup(tabIds);
    }
    return;
  }

  let isTabToBeReplacedInGroup = (!goingToFrontOrBack && tabToBeReplaced && destIndex !== -1 && tabToBeReplaced.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) || false;
  let group;
  if (isTabToBeReplacedInGroup) group = await chrome.tabGroups.get(tabToBeReplaced.groupId);

  if (isTabInGroup && !isTabToBeReplacedInGroup) {
    chrome.tabs.ungroup(tabIds);
    if (!goingToFrontOrBack) return;
  } else if (skipClosedGroups && isTabToBeReplacedInGroup) {
    if (!isTabInGroup && isTabToBeReplacedInGroup && !group.collapsed) {
      chrome.tabs.group({ tabIds: tabIds, groupId: tabToBeReplaced.groupId });
      return;
    }

    while (destIndex >= 0 && destIndex < allTabs.length) {
      tabToBeReplaced = allTabs[destIndex];

      if (tabToBeReplaced.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE || tabToBeReplaced.groupId === firstTab.groupId) {
        break;
      }

      group = await chrome.tabGroups.get(tabToBeReplaced.groupId);
      if (!group.collapsed) {
        break;
      }

      groupSkipped = true;
      tabsGoingRight ? destIndex++ : destIndex--;
      destIndex = Math.max(0, destIndex);
    }
  }

  if (groupSkipped) tabsGoingRight ? destIndex-- : destIndex++; // Move tab just outside the group
  chrome.tabs.move(tabIds, { index: destIndex });
}

// Enhanced move to front handler with group-aware and pin/unpin logic
async function handleMoveToFront(highlightedTabs) {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const pinnedTabs = allTabs.filter(tab => tab.pinned);
  const firstHighlightedTab = highlightedTabs[0];
  const tabIds = highlightedTabs.map(tab => tab.id);
  const isTabInGroup = firstHighlightedTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;

  // Get the last action from storage to detect consecutive calls
  const { lastAction } = await chrome.storage.local.get({ lastAction: null });
  const currentAction = {
    command: 'move-tabs-to-front',
    tabIds: tabIds,
    timestamp: Date.now()
  };

  // Check if this is a consecutive call (within 2 seconds) with the same tabs
  const isConsecutiveCall = lastAction &&
    lastAction.command === 'move-tabs-to-front' &&
    Date.now() - lastAction.timestamp < 2000 &&
    arraysEqual(lastAction.tabIds, tabIds);

  if (firstHighlightedTab.pinned) {
    // If tabs are already pinned, just move them to the front of pinned tabs
    moveTabs(highlightedTabs, 0, 'move-tabs-to-front');
  } else if (isTabInGroup) {
    // Handle grouped tabs
    const groupTabs = allTabs.filter(tab => tab.groupId === firstHighlightedTab.groupId);
    const firstGroupTabIndex = Math.min(...groupTabs.map(tab => tab.index));

    // Check if tabs are already at the front of the group
    const isAtFrontOfGroup = highlightedTabs.every((tab, i) => tab.index === firstGroupTabIndex + i);

    if (isAtFrontOfGroup && isConsecutiveCall) {
      // Second call: ungroup tabs without moving them
      chrome.tabs.ungroup(tabIds);
    } else {
      // First call or not at front of group: move to front of group
      chrome.tabs.move(tabIds, { index: firstGroupTabIndex });
    }
  } else {
    // Handle ungrouped tabs
    // Check if tabs are already at the front (right after pinned tabs)
    const expectedIndex = pinnedTabs.length;
    const isAtFront = highlightedTabs.every((tab, i) => tab.index === expectedIndex + i);

    if (isAtFront && isConsecutiveCall) {
      // Second call: pin the tabs
      for (const tabId of tabIds) {
        await chrome.tabs.update(tabId, { pinned: true });
      }
    } else {
      // First call or not at front: move to front (after pinned tabs)
      const offset = pinnedTabs.length;
      moveTabs(highlightedTabs, offset, 'move-tabs-to-front');
    }
  }

  // Store the current action
  await chrome.storage.local.set({ lastAction: currentAction });
}

// Enhanced move to back handler with group-aware and pin/unpin logic
async function handleMoveToBack(highlightedTabs) {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const firstHighlightedTab = highlightedTabs[0];
  const tabIds = highlightedTabs.map(tab => tab.id);
  const isTabInGroup = firstHighlightedTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;

  // Get the last action from storage to detect consecutive calls
  const { lastAction } = await chrome.storage.local.get({ lastAction: null });
  const currentAction = {
    command: 'move-tabs-to-back',
    tabIds: tabIds,
    timestamp: Date.now()
  };

  // Check if this is a consecutive call (within 2 seconds) with the same tabs
  const isConsecutiveCall = lastAction &&
    lastAction.command === 'move-tabs-to-back' &&
    Date.now() - lastAction.timestamp < 2000 &&
    arraysEqual(lastAction.tabIds, tabIds);

  if (firstHighlightedTab.pinned) {
    // Check if pinned tabs are already at the end of pinned tabs
    const pinnedTabs = allTabs.filter(tab => tab.pinned);
    const lastPinnedIndex = pinnedTabs.length - 1;
    const isAtEndOfPinned = highlightedTabs.every((tab, i) =>
      tab.index === lastPinnedIndex - (highlightedTabs.length - 1) + i
    );

    if (isAtEndOfPinned && isConsecutiveCall) {
      // Second call: unpin the tabs
      for (const tabId of tabIds.reverse()) {
        await chrome.tabs.update(tabId, { pinned: false });
      }
    } else {
      // First call or not at end: move to end of pinned tabs
      const pinnedCount = pinnedTabs.length;
      const targetIndex = pinnedCount - highlightedTabs.length;
      moveTabs(highlightedTabs, Math.max(0, targetIndex), 'move-tabs-to-back');
    }
  } else if (isTabInGroup) {
    // Handle grouped tabs
    const groupTabs = allTabs.filter(tab => tab.groupId === firstHighlightedTab.groupId);
    const lastGroupTabIndex = Math.max(...groupTabs.map(tab => tab.index));

    // Check if tabs are already at the back of the group
    const isAtBackOfGroup = highlightedTabs.every((tab, i) =>
      tab.index === lastGroupTabIndex - (highlightedTabs.length - 1) + i
    );

    if (isAtBackOfGroup && isConsecutiveCall) {
      // Second call: ungroup tabs without moving them
      chrome.tabs.ungroup(tabIds);
    } else {
      // First call or not at back of group: move to back of group
      const targetIndex = lastGroupTabIndex - highlightedTabs.length + 1;
      chrome.tabs.move(tabIds, { index: targetIndex });
    }
  } else {
    // Handle ungrouped tabs - just move to the back
    moveTabs(highlightedTabs, -1, 'move-tabs-to-back');
  }

  // Store the current action
  await chrome.storage.local.set({ lastAction: currentAction });
}

// Handle moving all groups to front or back
async function handleMoveAllGroups() {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });

  if (groups.length === 0) {
    return; // No groups to move
  }

  // Get all tabs that are in groups
  const groupedTabs = allTabs.filter(tab => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);
  const ungroupedTabs = allTabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
  const pinnedTabs = allTabs.filter(tab => tab.pinned);

  if (groupedTabs.length === 0) {
    return; // No grouped tabs to move
  }

  // Get the last action from storage to detect consecutive calls
  const { lastAction } = await chrome.storage.local.get({ lastAction: null });
  const currentAction = {
    command: 'move-all-groups',
    timestamp: Date.now()
  };

  // Check if this is a consecutive call (within 2 seconds)
  const isConsecutiveCall = lastAction &&
    lastAction.command === 'move-all-groups' &&
    Date.now() - lastAction.timestamp < 2000;

  // Check if all groups are at the front (right after pinned tabs)
  const firstGroupedIndex = Math.min(...groupedTabs.map(tab => tab.index));
  const lastGroupedIndex = Math.max(...groupedTabs.map(tab => tab.index));
  const allGroupsAtFront = firstGroupedIndex === pinnedTabs.length;

  // Check if all groups are at the back (no ungrouped tabs after them)
  const lastUngroupedIndex = Math.max(...ungroupedTabs.map(tab => tab.index), -1);
  const allGroupsAtBack = lastGroupedIndex > lastUngroupedIndex;

  // Decide whether to move to front or back
  // Default is to move to back, unless groups are already at back
  const moveToFront = allGroupsAtBack;

  if (moveToFront) {
    // Move all groups to the front (after pinned tabs)
    const targetIndex = pinnedTabs.length;

    // Sort groups by their current position to maintain relative order
    const sortedGroups = groups.sort((a, b) => {
      const aFirstTab = groupedTabs.find(tab => tab.groupId === a.id);
      const bFirstTab = groupedTabs.find(tab => tab.groupId === b.id);
      return aFirstTab.index - bFirstTab.index;
    });

    // Move groups in reverse order so they end up in the correct order
    // When we move to the same index, each group gets inserted at that position,
    // pushing previously moved groups to the right
    for (let i = sortedGroups.length - 1; i >= 0; i--) {
      const group = sortedGroups[i];
      await chrome.tabGroups.move(group.id, { index: targetIndex });
    }
  } else {
    // Move all groups to the back
    // Sort groups by their current position to maintain relative order
    const sortedGroups = groups.sort((a, b) => {
      const aFirstTab = groupedTabs.find(tab => tab.groupId === a.id);
      const bFirstTab = groupedTabs.find(tab => tab.groupId === b.id);
      return aFirstTab.index - bFirstTab.index;
    });

    // Move groups to the end in forward order to maintain their relative positions
    // When using index: -1, each group gets appended to the end, so we move in forward order
    for (let i = 0; i < sortedGroups.length; i++) {
      const group = sortedGroups[i];
      await chrome.tabGroups.move(group.id, { index: -1 });
    }
  }

  // Store the current action
  await chrome.storage.local.set({ lastAction: currentAction });
}

async function handleSwitchToLastTab() {
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = activeTabs[0];
  if (!activeTab) return;

  const history = await fetchLastActiveHistory();
  if (!history.length) return;

  const validatedEntries = [];
  for (const entry of history) {
    const tab = await safeGetTab(entry.tabId);
    if (!tab) continue;
    validatedEntries.push({
      tab,
      entry: {
        tabId: tab.id,
        windowId: tab.windowId,
        lastActiveAt: entry.lastActiveAt || 0,
      },
    });
  }

  if (!validatedEntries.length) {
    await storeLastActiveHistory([]);
    return;
  }

  await storeLastActiveHistory(validatedEntries.map((item) => item.entry));

  const currentIndex = validatedEntries.findIndex((item) => item.tab.id === activeTab.id);
  let targetRecord = null;

  if (currentIndex === 0) {
    targetRecord = validatedEntries[1];
  } else if (currentIndex > 0) {
    targetRecord = validatedEntries[0];
  } else {
    targetRecord = validatedEntries[0];
  }

  if (!targetRecord || targetRecord.tab.id === activeTab.id) {
    return;
  }

  await chrome.windows.update(targetRecord.tab.windowId, { focused: true });
  await chrome.tabs.update(targetRecord.tab.id, { active: true });
}

// Helper function to compare arrays
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}

// Handle pause or show audio tabs command
async function handlePauseOrShowAudioTabs() {
  // Query all tabs to find those playing audio
  const allTabs = await chrome.tabs.query({});
  const audibleTabs = allTabs.filter(tab => tab.audible);

  if (audibleTabs.length === 0) {
    // No tabs are playing audio, do nothing
    return;
  }

  // Try to pause audio in all audible tabs in parallel
  const pauseResults = await Promise.allSettled(
    audibleTabs.map(async (tab) => {
      try {
        // Inject a script to pause all audio and video elements
        // Note: This only works for HTML5 <audio> and <video> elements.
        // It cannot pause Web Audio API, WebRTC, or embedded Flash content.
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const mediaElements = document.querySelectorAll('audio, video');
            let paused = false;
            mediaElements.forEach(el => {
              if (!el.paused) {
                el.pause();
                paused = true;
              }
            });
            return paused;
          }
        });
        // Check if any media was actually paused
        return results?.[0]?.result === true;
      } catch (error) {
        // Script injection failed (e.g., chrome:// or other protected pages)
        return false;
      }
    })
  );

  // Count how many tabs actually had media paused
  const pausedCount = pauseResults.filter(
    result => result.status === 'fulfilled' && result.value === true
  ).length;

  // If we couldn't pause any tabs, switch to the first audible tab to show it to the user
  if (pausedCount === 0 && audibleTabs.length > 0) {
    const firstAudibleTab = audibleTabs[0];
    await chrome.windows.update(firstAudibleTab.windowId, { focused: true });
    await chrome.tabs.update(firstAudibleTab.id, { active: true });
  }
}
