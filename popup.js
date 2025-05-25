// Command descriptions mapping
const commandDescriptions = {
  'duplicate-tab': 'Duplicate tab(s)',
  'pin-tab': 'Pin tab(s)',
  'go-incognito': 'Open the current tab(s) in incognito',
  'open-tab-near': 'Open tab near current and in same group',
  'add-tab-to-current-group': 'Open tab at the end of the current group',
  'open-tab-at-end': 'Open tab at the end of all tabs',
  'move-tabs-left': 'Move highlighted tab(s) left',
  'move-tabs-right': 'Move highlighted tab(s) right',
  'move-tabs-to-front': 'Move highlighted tab(s) to the front',
  'move-tabs-to-back': 'Move highlighted tab(s) to the back',
  'switch-windows': 'Switch between windows',
  'toggle-collapse-groups': 'Toggle collapse all tab groups',
  'switch-to-last-tab': 'Switch to the last active tab',
  'copy-url': 'Copy current tab URL to clipboard',
  'open-clipboard-url': 'Open new tab with clipboard content as URL or search'
};

// Format shortcut keys for display
function formatShortcut(shortcut) {
  if (!shortcut) return null;
  
  return shortcut
    .replace(/Ctrl/g, 'Ctrl')
    .replace(/Alt/g, 'Alt')
    .replace(/Shift/g, 'Shift')
    .replace(/\+/g, ' + ')
    .replace(/MacCtrl/g, 'Cmd');
}

// Create shortcut item element
function createShortcutItem(command, shortcut, description) {
  const item = document.createElement('div');
  item.className = 'shortcut-item';
  
  const descriptionElement = document.createElement('div');
  descriptionElement.className = 'shortcut-description';
  descriptionElement.textContent = description;
  
  const shortcutElement = document.createElement('div');
  if (shortcut) {
    shortcutElement.className = 'shortcut-key';
    shortcutElement.textContent = formatShortcut(shortcut);
  } else {
    shortcutElement.className = 'shortcut-key no-shortcut';
    shortcutElement.textContent = 'No shortcut set';
  }
  
  item.appendChild(descriptionElement);
  item.appendChild(shortcutElement);
  
  return item;
}

// Load and display shortcuts
async function loadShortcuts() {
  try {
    const container = document.getElementById('shortcutsContainer');
    
    // Get all commands for this extension
    const commands = await chrome.commands.getAll();
    
    // Clear loading message
    container.innerHTML = '';
    
    // Sort commands by whether they have shortcuts assigned
    const sortedCommands = commands.sort((a, b) => {
      if (a.shortcut && !b.shortcut) return -1;
      if (!a.shortcut && b.shortcut) return 1;
      return 0;
    });
    
    // Create shortcut items
    sortedCommands.forEach(command => {
      const description = commandDescriptions[command.name] || command.description || command.name;
      const item = createShortcutItem(command.name, command.shortcut, description);
      container.appendChild(item);
    });
    
    // If no commands found, show message
    if (commands.length === 0) {
      container.innerHTML = '<div class="loading">No shortcuts found</div>';
    }
    
  } catch (error) {
    console.error('Error loading shortcuts:', error);
    document.getElementById('shortcutsContainer').innerHTML = 
      '<div class="loading">Error loading shortcuts</div>';
  }
}

// Handle manage shortcuts link
function setupManageShortcutsLink() {
  const link = document.getElementById('manageShortcuts');
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
  });
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  loadShortcuts();
  setupManageShortcutsLink();
});
