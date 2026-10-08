'use strict';

// Only these fixed codes/messages cross the worker boundary or enter storage.
const COMMAND_ERROR_MESSAGES = {
  no_window: 'Open a regular Chrome window, then try again.',
  no_tab: 'The tab or window closed. Choose an open tab and try again.',
  no_previous_tab: 'No previous tab is available yet. Switch tabs first.',
  history_end: 'You reached the oldest available tab in this history. Use Newer recent tab to retrace your steps.',
  history_start: 'You are at the newest available tab in this history. Use Older recent tab to move back.',
  no_other_window: 'Open another Chrome window in the same browsing mode first.',
  no_group: 'Create a tab group in this window first.',
  no_url: 'A selected tab has no available URL. Wait for it to load, then try again.',
  no_web_url: 'Select a web page first. This action needs an HTTP or HTTPS address.',
  permission_denied: 'Site access was declined. Try Pause again and allow access.',
  media_partial: 'Some pages could not be paused. They may block access or have closed.',
  clipboard_failed: 'Could not copy to the clipboard. Try the shortcut again.',
  screenshot_permission: 'Chrome has not granted capture access to this tab. Focus the page and press the screenshot shortcut again.',
  screenshot_changed: 'The active page changed during capture. Try the screenshot shortcut again.',
  screenshot_busy: 'Screenshots were requested too quickly. Wait a moment and try again.',
  screenshot_failed: 'Chrome could not capture this page. Wait for it to load and try again.',
  invalid_target: 'Choose a tab in a regular Chrome window in the same browsing mode.',
  unknown_command: 'This action is unavailable. Reload the extension and try again.',
  action_failed: 'The action could not finish. Its tabs or groups may have changed. Try again.'
};

function commandError(code) {
  const error = new Error(commandErrorMessage(code));
  error.code = Object.hasOwn(COMMAND_ERROR_MESSAGES, code) ? code : 'action_failed';
  return error;
}

function commandErrorCode(error) {
  if (Object.hasOwn(COMMAND_ERROR_MESSAGES, error?.code)) return error.code;
  // Classify browser errors without exposing or persisting their contents.
  if (/No tab with id|Invalid tab ID|No window with id|No tab\b|No window\b/i.test(error?.message || '')) return 'no_tab';
  return 'action_failed';
}

function commandErrorMessage(code) {
  return Object.hasOwn(COMMAND_ERROR_MESSAGES, code) ? COMMAND_ERROR_MESSAGES[code] : COMMAND_ERROR_MESSAGES.action_failed;
}
