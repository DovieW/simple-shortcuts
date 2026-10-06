'use strict';
// Shared with the popup and dependency-free tests.
function formatShortcut(shortcut) {
  return (shortcut || '').split('+').map(key => ({ MacCtrl: 'Control', Command: 'Cmd', Option: 'Option' }[key] || key)).join(' + ');
}
function commandCategory(name) {
  if (['copy-url', 'copy-screenshot', 'go-home'].includes(name)) return 'Navigation';
  if (name === 'pause-all-tabs') return 'Media';
  if (name.includes('window')) return 'Windows';
  if (name.includes('group')) return 'Groups';
  return 'Tabs';
}
function matchesCommand(command, query) {
  return `${command.description} ${command.name} ${command.shortcut || ''} ${commandCategory(command.name)}`.toLowerCase().includes(query.trim().toLowerCase());
}

function shortCommandLabel(command) {
  const labels = {
    'duplicate-tab': 'Duplicate tabs', 'pin-tab': 'Pin / unpin tabs', 'go-incognito': 'Open in incognito',
    'open-tab-near': 'New tab nearby', 'add-tab-to-current-group': 'New tab in group', 'open-tab-at-end': 'New tab at end',
    'move-tabs-left': 'Move left', 'move-tabs-right': 'Move right', 'move-tabs-to-front': 'Move to front', 'move-tabs-to-back': 'Move to back',
    'switch-windows': 'Next window', 'move-tabs-to-window': 'Move to next window',
    'toggle-collapse-groups': 'Collapse / expand groups', 'switch-to-last-tab': 'Last active tab',
    'walk-recent-tabs': 'Older recent tab',
    'copy-url': 'Copy links', 'copy-screenshot': 'Copy screenshot', 'move-all-groups': 'Groups to front / back', 'go-home': 'Site home',
    'cycle-tab-groups': 'Move to next group', 'pause-all-tabs': 'Pause all media'
  };
  return labels[command.name] || command.description;
}
