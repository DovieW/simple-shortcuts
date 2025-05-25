// Function to ensure offscreen document exists for clipboard access
async function ensureOffscreenDocument() {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  });

  if (existingContexts.length > 0) {
    return; // Offscreen document already exists
  }

  // Create offscreen document
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['CLIPBOARD'],
    justification: 'Read clipboard content for URL/search functionality'
  });
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
  } else if (command === 'open-clipboard-url') {
    try {
      // Ensure offscreen document exists
      await ensureOffscreenDocument();
      
      // Send message to offscreen document to read clipboard
      const response = await chrome.runtime.sendMessage({ action: 'readClipboard' });
      
      if (response.success) {
        const clipboardContent = response.text.trim();
        
        if (clipboardContent) {
          let url;
          
          // Check if clipboard content is a valid URL
          try {
            new URL(clipboardContent);
            url = clipboardContent;
          } catch {
            // If not a valid URL, treat as search query
            // Use Google search as default search engine
            url = `https://www.google.com/search?q=${encodeURIComponent(clipboardContent)}`;
          }
          
          // Create new tab with the URL
          chrome.tabs.create({ url: url, active: true });
        }
      } else {
        console.error('Failed to read clipboard:', response.error);
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
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
      moveTabs(highlightedTabs, -1, cmd);
      break;
    case MOVE_FRONT:
      let offset = 0;
      const window = await chrome.windows.getCurrent({populate: true});
      const activeTab = window.tabs.filter(tab => tab.active);
      if (!activeTab[0].pinned) {
        offset = await chrome.tabs.query({ currentWindow: true, pinned: true });
        offset = offset.length;
      }
      moveTabs(highlightedTabs, offset, cmd);
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
