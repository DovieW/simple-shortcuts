'use strict';
const MEDIA_ORIGINS = ['http://*/*', 'https://*/*'];
let commands = [];
let snapshots = {};
let localPlatform;
let selectedPlatform;
let pendingSnapshot;
let memoryReady = false;

function currentSnapshot() { return snapshots[selectedPlatform]; }

async function readCommands() {
  const current = (await chrome.commands.getAll()).filter(command => !command.name.startsWith('_'));
  current.sort((a, b) => Number(!!b.shortcut) - Number(!!a.shortcut) || a.description.localeCompare(b.description));
  return current;
}

function renderMemory() {
  const select = document.getElementById('snapshotPlatform');
  const platforms = Object.keys(snapshots);
  if (!snapshots[selectedPlatform]) selectedPlatform = snapshots[localPlatform] ? localPlatform : platforms.sort((a, b) => snapshots[b].savedAt - snapshots[a].savedAt)[0];
  select.replaceChildren();
  for (const platform of platforms) {
    const option = document.createElement('option');
    option.value = platform;
    option.textContent = PLATFORM_NAMES[platform];
    select.append(option);
  }
  if (selectedPlatform) select.value = selectedPlatform;
  select.hidden = platforms.length < 2;
  document.getElementById('snapshotLabel').hidden = platforms.length < 2;
  const snapshot = currentSnapshot();
  const summary = document.getElementById('memorySummary');
  if (!snapshot) {
    summary.textContent = 'No saved setup';
    summary.title = 'Use the save button to remember your current shortcuts.';
    summary.classList.remove('has-differences');
  }
  else {
    const differences = snapshotDifferences(commands, snapshot);
    const missing = differences.filter(command => shortcutDifference(command, snapshot) === 'missing').length;
    const changed = differences.length - missing;
    const crossPlatform = selectedPlatform !== localPlatform ? ` · ${PLATFORM_NAMES[selectedPlatform]}` : '';
    summary.textContent = ([missing ? `${missing} missing` : '', changed ? `${changed} changed` : ''].filter(Boolean).join(' · ') || 'Saved') + crossPlatform;
    summary.title = `Saved on ${new Date(snapshot.savedAt).toLocaleDateString()} for ${PLATFORM_NAMES[selectedPlatform]}.${crossPlatform ? ' Keys may differ on this operating system.' : ''}`;
    summary.classList.toggle('has-differences', differences.length > 0);
  }
  document.getElementById('rememberShortcuts').disabled = !memoryReady;
  document.getElementById('exportShortcuts').disabled = !snapshot || !memoryReady;
  document.getElementById('importShortcuts').disabled = !memoryReady;
  document.getElementById('onlyDifferences').disabled = !snapshot;
}

async function refreshMemory() {
  snapshots = await readShortcutSnapshots();
  renderMemory();
  renderCommands();
}

function cancelSnapshot() {
  pendingSnapshot = null;
  document.getElementById('replaceSnapshot').hidden = true;
}

async function commitSnapshot(snapshot) {
  await saveShortcutSnapshot(snapshot);
  selectedPlatform = snapshot.platform;
  cancelSnapshot();
  await refreshMemory();
  showStatus('Shortcuts saved.', true);
}

async function proposeSnapshot(snapshot) {
  const latest = await readShortcutSnapshots();
  const previous = latest[snapshot.platform];
  if (!previous || JSON.stringify(previous.bindings) === JSON.stringify(snapshot.bindings)) {
    await commitSnapshot(snapshot);
    return;
  }
  pendingSnapshot = { snapshot, previous: JSON.stringify(previous) };
  const assigned = Object.values(snapshot.bindings).filter(Boolean).length;
  const oldAssigned = Object.values(previous.bindings).filter(Boolean).length;
  document.getElementById('replaceSummary').textContent = `Replace ${PLATFORM_NAMES[snapshot.platform]} setup? ${oldAssigned} → ${assigned} assigned.`;
  document.getElementById('replaceSnapshot').hidden = false;
}

function setupShortcutMemory() {
  document.getElementById('snapshotPlatform').addEventListener('change', event => {
    selectedPlatform = event.target.value;
    renderMemory(); renderCommands();
  });
  document.getElementById('onlyDifferences').addEventListener('change', renderCommands);
  document.getElementById('rememberShortcuts').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      commands = await readCommands();
      await proposeSnapshot(makeShortcutSnapshot(commands, localPlatform));
      renderCommands();
    } catch { showStatus('Could not remember shortcuts. Your saved setup was left intact.'); }
    finally { button.disabled = !memoryReady; }
  });
  document.getElementById('cancelSnapshot').addEventListener('click', cancelSnapshot);
  document.getElementById('confirmSnapshot').addEventListener('click', async event => {
    if (!pendingSnapshot) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const pending = pendingSnapshot;
      const latest = await readShortcutSnapshots();
      if (JSON.stringify(latest[pending.snapshot.platform]) !== pending.previous) {
        cancelSnapshot(); await refreshMemory();
        showStatus('The saved setup changed on another browser. Review it, then choose Remember current again.');
      } else await commitSnapshot(pending.snapshot);
    } catch { showStatus('Could not save the snapshot. Try again.'); }
    finally { button.disabled = false; }
  });
  document.getElementById('exportShortcuts').addEventListener('click', () => {
    const snapshot = currentSnapshot();
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `simple-shortcuts-${snapshot.platform}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.getElementById('importShortcuts').addEventListener('click', () => document.getElementById('backupFile').click());
  document.getElementById('backupFile').addEventListener('change', async event => {
    const file = event.target.files[0];
    try {
      if (!file) return;
      if (file.size > 32768) throw new Error('Backup too large');
      const snapshot = validateShortcutSnapshot(JSON.parse(await file.text()));
      await proposeSnapshot(snapshot);
    } catch { showStatus('This backup could not be imported. Choose a Simple Shortcuts JSON backup.'); }
    finally { event.target.value = ''; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some(key => key.startsWith(SNAPSHOT_PREFIX))) {
      refreshMemory().catch(() => showStatus('Saved shortcuts could not refresh. Reopen the popup to try again.'));
    }
  });
}

let statusTimer;
function showStatus(text, temporary = false) {
  clearTimeout(statusTimer);
  const status = document.getElementById('status');
  status.textContent = text;
  status.hidden = !text;
  if (temporary && text) statusTimer = setTimeout(() => { status.hidden = true; }, 2500);
}

async function sendAction(message) {
  const result = await chrome.runtime.sendMessage({ target: 'background', ...message });
  if (!result?.ok) throw commandError(result?.code);
}

async function run(command, button) {
  button.disabled = true;
  try {
    if (command === 'pause-all-tabs') {
      // Called directly from the click handler, preserving the user gesture.
      const granted = await chrome.permissions.request({ origins: MEDIA_ORIGINS });
      if (!granted) { showStatus('Site access declined.'); return; }
    }
    await sendAction({ type: 'run-command', command });
    showStatus('Media paused.', true);
    await loadAudioTabs();
  } catch (error) {
    showStatus(commandErrorMessage(commandErrorCode(error)));
  } finally { button.disabled = false; }
}

function renderCommands() {
  const container = document.getElementById('shortcutsContainer');
  container.replaceChildren();
  const snapshot = currentSnapshot();
  const onlyDifferences = document.getElementById('onlyDifferences').checked && snapshot;
  const filtered = commands.filter(command => {
    const previous = snapshot?.bindings[command.name] || '';
    const difference = shortcutDifference(command, snapshot);
    return matchesCommand({ ...command, shortcut: `${command.shortcut || ''} ${previous}` }, document.getElementById('search').value) &&
      (!onlyDifferences || difference === 'missing' || difference === 'changed');
  });
  for (const category of ['Tabs', 'Groups', 'Windows', 'Navigation', 'Media']) {
    const items = filtered.filter(command => commandCategory(command.name) === category);
    if (!items.length) continue;
    const heading = document.createElement('h2');
    heading.textContent = category;
    container.append(heading);
    for (const command of items) {
      const item = document.createElement('div');
      item.className = 'shortcut-item';
      const description = document.createElement('span');
      description.className = 'shortcut-copy';
      description.textContent = shortCommandLabel(command);
      item.title = command.description;
      const difference = shortcutDifference(command, snapshot);
      if (snapshot && ['missing', 'changed'].includes(difference)) {
        const previous = document.createElement('span');
        previous.className = 'previous-shortcut';
        previous.textContent = `Was ${formatShortcut(snapshot.bindings[command.name]).replace(/ \+ /g, '+') || '—'}`;
        item.classList.add(difference);
        description.append(previous);
      }
      const key = document.createElement(command.shortcut ? 'kbd' : 'span');
      key.textContent = command.shortcut ? formatShortcut(command.shortcut).replace(/ \+ /g, '+') : '—';
      if (!command.shortcut) { key.title = 'Not assigned'; key.setAttribute('aria-label', 'Not assigned'); }
      if (!command.shortcut) key.className = 'unassigned';
      item.append(description, key);
      container.append(item);
    }
  }
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = onlyDifferences && !document.getElementById('search').value.trim() ? 'All shortcuts match.' : 'No matching shortcuts.';
    container.append(empty);
  }
}

async function loadAudioTabs() {
  const container = document.getElementById('audioTabs');
  const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const windowIds = new Set(windows.filter(item => item.type === 'normal' && item.incognito === window.incognito).map(item => item.id));
  const tabs = (await chrome.tabs.query({})).filter(tab => windowIds.has(tab.windowId) && (tab.audible || tab.mutedInfo?.muted));
  container.replaceChildren();
  for (const tab of tabs) {
    const row = document.createElement('div');
    row.className = 'audio-tab';
    const focus = document.createElement('button');
    focus.type = 'button';
    focus.className = 'audio-title';
    focus.textContent = tab.title || 'Untitled tab';
    focus.title = focus.textContent;
    focus.addEventListener('click', async () => {
      try { await sendAction({ type: 'focus-tab', tabId: tab.id }); windowClose(); }
      catch (error) { showStatus(commandErrorMessage(commandErrorCode(error))); }
    });
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'icon-button';
    const action = tab.mutedInfo?.muted ? 'Unmute' : 'Mute';
    mute.title = action;
    mute.setAttribute('aria-label', `${action} ${tab.title || 'tab'}`);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', tab.mutedInfo?.muted ? '#icon-muted' : '#icon-volume');
    icon.setAttribute('aria-hidden', 'true'); icon.append(use);
    const label = document.createElement('span'); label.className = 'button-label'; label.textContent = action;
    mute.append(icon, label);
    mute.addEventListener('click', async () => {
      try { await sendAction({ type: 'mute-tab', tabId: tab.id }); await loadAudioTabs(); }
      catch (error) { showStatus(commandErrorMessage(commandErrorCode(error))); }
    });
    row.append(focus, mute);
    container.append(row);
  }
  document.getElementById('audioSection').hidden = !tabs.length;
  document.getElementById('revokeMedia').hidden = !(await chrome.permissions.contains({ origins: MEDIA_ORIGINS }));
}

function windowClose() { window.close(); }

async function initialize() {
  setupShortcutMemory();
  document.getElementById('moreTools').addEventListener('click', event => {
    const panel = document.getElementById('backupTools');
    panel.hidden = !panel.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.getElementById('search').addEventListener('input', renderCommands);
  document.getElementById('manageShortcuts').addEventListener('click', async () => {
    try { await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); window.close(); }
    catch { showStatus('Could not open Chrome shortcut settings.'); }
  });
  document.getElementById('pauseAll').addEventListener('click', event => run('pause-all-tabs', event.currentTarget));
  document.getElementById('revokeMedia').addEventListener('click', async () => {
    try { await chrome.permissions.remove({ origins: MEDIA_ORIGINS }); await loadAudioTabs(); showStatus('Site access removed.', true); }
    catch { showStatus('Could not remove site access.'); }
  });
  try {
    commands = await readCommands();
    renderCommands();
    const platform = await chrome.runtime.getPlatformInfo();
    localPlatform = platform.os;
    try {
      snapshots = await readShortcutSnapshots();
      memoryReady = SNAPSHOT_PLATFORMS.includes(localPlatform);
      renderMemory(); renderCommands();
    } catch { document.getElementById('memorySummary').textContent = 'Backup unavailable'; }
    const { lastError } = await chrome.storage.session.get('lastError');
    if (lastError) {
      const command = commands.find(command => command.name === lastError.command);
      const label = command ? shortCommandLabel(command) : 'Recent action';
      showStatus(`${label}: ${commandErrorMessage(lastError.code)}`);
    }
    await loadAudioTabs();
  } catch { showStatus('Some extension information could not load. Reopen the popup to try again.'); }
}

document.addEventListener('DOMContentLoaded', initialize);

let audioRefreshTimer;
function scheduleAudioRefresh() {
  clearTimeout(audioRefreshTimer);
  audioRefreshTimer = setTimeout(() => loadAudioTabs().catch(() => showStatus('Audio tabs could not refresh. Reopen the popup to try again.')), 150);
}
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if ('audible' in change || 'mutedInfo' in change || 'title' in change) scheduleAudioRefresh();
});
chrome.tabs.onRemoved.addListener(scheduleAudioRefresh);
chrome.tabs.onCreated.addListener(scheduleAudioRefresh);
