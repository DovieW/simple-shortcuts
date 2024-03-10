chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'duplicate-tab') {
    chrome.tabs.query({ active: true }, (tabs) => {
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
      tabs.forEach(tab => {
        chrome.tabs.update(tab.id, { pinned: !tab.pinned });
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
    chrome.tabs.create({ index: tab.index + 1 }, (newTab) => {
      if (tab.groupId > 0) {
        chrome.tabs.group({ groupId: tab.groupId, tabIds: newTab.id });
      }
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
  }
});
