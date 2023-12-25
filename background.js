chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'duplicate-tab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.create({ url: tabs[0].url, index: tabs[0].index + 1 });
    });
  } else if (command === 'pin-tab') {
    // Query for all highlighted tabs in the current window
    chrome.tabs.query({ highlighted: true, currentWindow: true }, (tabs) => {
      // Iterate through the tabs and toggle the pinned state
      tabs.forEach(tab => {
        chrome.tabs.update(tab.id, { pinned: !tab.pinned });
      });
    });
  } else if (command === 'go-incognito') {
    chrome.windows.create({ url: tab.url, incognito: true, focused: true, state: 'maximized' });
  }
});
