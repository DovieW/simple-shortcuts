'use strict';

function setupTabSettings() {
  const fields = document.getElementById('tabSettingsFields');
  const status = document.getElementById('tabSettingsStatus');
  const seconds = document.getElementById('pauseSeconds');
  const slider = document.getElementById('pauseSlider');
  const reset = document.getElementById('resetTabSettings');
  let saving = false;

  function render(settings) {
    for (const name of Object.keys(TAB_SETTINGS_DEFAULTS).filter(name => name !== 'pauseMs')) {
      document.getElementById(name).checked = settings[name];
    }
    seconds.value = slider.value = settings.pauseMs / 1000;
    seconds.disabled = slider.disabled = !settings.resetAfterPause;
  }
  async function refresh() {
    render(await readTabSettings());
    fields.disabled = reset.disabled = saving;
  }
  async function save(patch) {
    saving = true;
    fields.disabled = reset.disabled = true;
    status.textContent = 'Saving…';
    try {
      await saveTabSettings(patch);
      status.textContent = 'Saved. Syncs when Chrome Sync is enabled.';
    } catch {
      status.textContent = 'Could not save. Try changing the setting again.';
    } finally {
      saving = false;
      try { await refresh(); }
      catch { status.textContent = 'Could not load settings. Reopen Settings to try again.'; }
    }
  }

  document.getElementById('openSettings').addEventListener('click', async () => {
    fields.disabled = reset.disabled = true;
    document.getElementById('shortcutView').hidden = true;
    document.getElementById('tabSettings').hidden = false;
    document.getElementById('closeSettings').focus();
    try { await refresh(); status.textContent = 'Changes apply on your next history shortcut.'; }
    catch { status.textContent = 'Could not load settings. Reopen Settings to try again.'; }
  });
  document.getElementById('closeSettings').addEventListener('click', () => {
    document.getElementById('tabSettings').hidden = true;
    document.getElementById('shortcutView').hidden = false;
    document.getElementById('openSettings').focus();
  });
  for (const name of Object.keys(TAB_SETTINGS_DEFAULTS).filter(name => name !== 'pauseMs')) {
    document.getElementById(name).addEventListener('change', event => save({ [name]: event.target.checked }));
  }
  seconds.addEventListener('change', () => {
    if (!seconds.checkValidity() || !Number.isFinite(seconds.valueAsNumber)) {
      status.textContent = 'Enter a pause from 0.25 to 10 seconds, in steps of 0.05.';
      seconds.reportValidity();
      return;
    }
    save({ pauseMs: Math.round(seconds.valueAsNumber * 1000) });
  });
  slider.addEventListener('input', () => { seconds.value = slider.value; });
  // Save only after releasing the slider, avoiding Chrome Sync write limits.
  slider.addEventListener('change', () => save({ pauseMs: Math.round(Number(slider.value) * 1000) }));
  reset.addEventListener('click', () => save(TAB_SETTINGS_DEFAULTS));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || saving || !Object.keys(changes).some(key => key.startsWith(TAB_SETTINGS_PREFIX))) return;
    refresh().then(() => { status.textContent = 'Settings updated.'; }).catch(() => {
      fields.disabled = reset.disabled = true;
      status.textContent = 'Could not refresh settings. Reopen Settings to try again.';
    });
  });
}
