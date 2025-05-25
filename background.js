chrome.commands.onCommand.addListener((command, tab) => {
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
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tab = tabs[0];

      // chrome.tabs.create({ index: tab.index + 1, pinned: tab.pinned }, (newTab) => {
      chrome.tabs.create({ index: tab.index + 1, pinned: false }, (newTab) => {
        if (tab.groupId > 0) {
          chrome.tabs.group({ groupId: tab.groupId, tabIds: newTab.id });
        }
      });
    });
  } else if (command === 'open-tab-at-end') {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const lastIndex = tabs.length - 1;
      chrome.tabs.create({ index: lastIndex + 1 });
    });
  } else if (command === 'add-tab-to-current-group') {
    if (tab.groupId > 0) {
      chrome.tabs.query({ groupId: tab.groupId }, (groupTabs) => {
        const lastGroupTabIndex = Math.max(...groupTabs.map(t => t.index));
        chrome.tabs.create({ index: lastGroupTabIndex + 1 }, (newTab) => {
          chrome.tabs.group({ groupId: tab.groupId, tabIds: newTab.id });
        });
      });
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
    chrome.storage.local.get("lastActiveTabs", (data) => {
      const lastActiveTabs = data.lastActiveTabs || [null, null];
      const lastTabId = lastActiveTabs[1];

      if (lastTabId) chrome.tabs.update(lastTabId, { active: true });
    });
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
  };
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.storage.local.get("lastActiveTabs", (data) => {
    const lastActiveTabs = data.lastActiveTabs || [null, null];

    lastActiveTabs[1] = lastActiveTabs[0];
    lastActiveTabs[0] = activeInfo.tabId;

    chrome.storage.local.set({ lastActiveTabs: lastActiveTabs });
  });
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

// Enhanced move to front handler with pin/unpin logic
async function handleMoveToFront(highlightedTabs) {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const pinnedTabs = allTabs.filter(tab => tab.pinned);
  const firstHighlightedTab = highlightedTabs[0];
  const tabIds = highlightedTabs.map(tab => tab.id);
  
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
  } else {
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

// Enhanced move to back handler with pin/unpin logic
async function handleMoveToBack(highlightedTabs) {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const firstHighlightedTab = highlightedTabs[0];
  const tabIds = highlightedTabs.map(tab => tab.id);
  
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
  } else {
    // For unpinned tabs, just move to the back
    moveTabs(highlightedTabs, -1, 'move-tabs-to-back');
  }
  
  // Store the current action
  await chrome.storage.local.set({ lastAction: currentAction });
}

// Helper function to compare arrays
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}
