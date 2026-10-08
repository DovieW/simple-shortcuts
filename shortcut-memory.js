'use strict';
const SNAPSHOT_PREFIX = 'shortcutSnapshotV1-';
const SNAPSHOT_PLATFORMS = ['linux', 'win', 'mac', 'cros', 'openbsd', 'android'];
const PLATFORM_NAMES = { linux: 'Linux', win: 'Windows', mac: 'macOS', cros: 'ChromeOS', openbsd: 'OpenBSD', android: 'Android' };

function makeShortcutSnapshot(commands, platform, now = Date.now()) {
  if (!SNAPSHOT_PLATFORMS.includes(platform)) throw new Error('Unsupported platform');
  const bindings = {};
  for (const command of commands) {
    if (command.name && !command.name.startsWith('_')) bindings[command.name] = command.shortcut || '';
  }
  return { version: 1, platform, savedAt: now, bindings };
}

function validateShortcutSnapshot(raw) {
  if (!raw || raw.version !== 1 || !SNAPSHOT_PLATFORMS.includes(raw.platform) ||
      !Number.isFinite(raw.savedAt) || raw.savedAt < 0 || raw.savedAt > 8640000000000000 ||
      !raw.bindings || typeof raw.bindings !== 'object' || Array.isArray(raw.bindings)) throw new Error('Invalid shortcut snapshot');
  const bindings = {};
  const entries = Object.entries(raw.bindings);
  if (entries.length > 100) throw new Error('Too many bindings');
  for (const [name, shortcut] of entries) {
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(name) || typeof shortcut !== 'string' || shortcut.length > 100) throw new Error('Invalid binding');
    // Use textContent for display; imported keys are a checklist, never executed.
    bindings[name] = shortcut;
  }
  const snapshot = { version: 1, platform: raw.platform, savedAt: raw.savedAt, bindings };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 7500) throw new Error('Snapshot exceeds sync item limit');
  return snapshot;
}

function shortcutDifference(command, snapshot) {
  if (!snapshot || !Object.hasOwn(snapshot.bindings, command.name)) return 'new';
  const previous = snapshot.bindings[command.name];
  const current = command.shortcut || '';
  if (previous === current) return 'matching';
  return previous && !current ? 'missing' : 'changed';
}

function snapshotDifferences(commands, snapshot) {
  return commands.filter(command => ['missing', 'changed'].includes(shortcutDifference(command, snapshot)));
}

async function readShortcutSnapshots() {
  const keys = SNAPSHOT_PLATFORMS.map(platform => SNAPSHOT_PREFIX + platform);
  const stored = await chrome.storage.sync.get(keys);
  const snapshots = {};
  for (const platform of SNAPSHOT_PLATFORMS) {
    const value = stored[SNAPSHOT_PREFIX + platform];
    if (!value) continue;
    try {
      const snapshot = validateShortcutSnapshot(value);
      if (snapshot.platform === platform) snapshots[platform] = snapshot;
    } catch { /* Ignore malformed or incompatible data without overwriting it. */ }
  }
  return snapshots;
}

async function saveShortcutSnapshot(snapshot) {
  const validated = validateShortcutSnapshot(snapshot);
  // Separate platform keys avoid overwriting another platform's snapshot.
  await chrome.storage.sync.set({ [SNAPSHOT_PREFIX + validated.platform]: validated });
}
