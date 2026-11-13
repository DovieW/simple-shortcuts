'use strict';

const TAB_SETTINGS_PREFIX = 'tabSwitchingV1-';
const TAB_SETTINGS_DEFAULTS = Object.freeze({
  resetAfterPause: true,
  pauseMs: 1500,
  includeOtherWindows: true,
  wrap: false,
  rememberPreviews: false
});

function normalizeTabSettings(value = {}) {
  const settings = { ...TAB_SETTINGS_DEFAULTS };
  for (const name of Object.keys(settings)) {
    if (name === 'pauseMs') {
      if (Number.isInteger(value?.[name]) && value[name] >= 250 && value[name] <= 10000) settings[name] = value[name];
    } else if (typeof value?.[name] === 'boolean') settings[name] = value[name];
  }
  return settings;
}

async function readTabSettings() {
  const names = Object.keys(TAB_SETTINGS_DEFAULTS);
  const stored = await chrome.storage.sync.get(names.map(name => TAB_SETTINGS_PREFIX + name));
  return normalizeTabSettings(Object.fromEntries(names.map(name => [name, stored[TAB_SETTINGS_PREFIX + name]])));
}

async function saveTabSettings(patch) {
  const normalized = normalizeTabSettings(patch);
  // Each setting has its own sync key, so changing the pause on one device
  // doesn't overwrite an unrelated setting changed on another device.
  const values = {};
  for (const name of Object.keys(TAB_SETTINGS_DEFAULTS)) {
    if (!Object.hasOwn(patch, name)) continue;
    if (patch[name] !== normalized[name]) throw new Error('Invalid tab switching setting');
    values[TAB_SETTINGS_PREFIX + name] = patch[name];
  }
  await chrome.storage.sync.set(values);
}
