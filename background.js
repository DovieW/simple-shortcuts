chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'duplicate-tab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.create({ url: tabs[0].url, index: tabs[0].index + 1 });
    });
  } else if (command === 'pin-tab') {
    chrome.tabs.query({ highlighted: true, currentWindow: true }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.update(tab.id, { pinned: !tab.pinned });
      });
    });
  } else if (command === 'go-incognito') {
    chrome.windows.create({ url: tab.url, incognito: true, focused: true, state: 'maximized' });
  } else if (command === 'open-tab-near') {
    // Create a new tab near the current one
    chrome.tabs.create({ index: tab.index + 1 }, (newTab) => {
      // If the current tab is part of a group, add the new tab to the same group
      if (tab.groupId > 0) {
        chrome.tabs.group({ groupId: tab.groupId, tabIds: newTab.id });
      }
    });
  }
});
