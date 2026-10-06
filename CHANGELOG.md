# Changelog

## 0.5.0 — 2026-10-06

- Add **Older recent tab**, which walks backward through a stable history of up to 32 tabs, skips closed tabs, and stops at the oldest entry. Last active tab remains a two-tab toggle.
- Improve last-active history across rapid presses, worker suspension, closed tabs, normal windows, and privacy contexts. Reveal collapsed destination groups and ignore stale window events.
- Remember shortcut assignments per operating system in Chrome sync storage. Compare missing/changed keys and export/import JSON backups for manual restoration. Chrome does not let extensions assign keys or read their global scope.
- Copy all highlighted tab links in tab-strip order with the existing Copy links shortcut.
- Add visible-page PNG screenshots directly to the clipboard, suggested on **Alt+Shift+S**.
- Add group cycling, Pause all media with optional site access, and audible/muted tab controls.
- Simplify the popup with search, short button labels, read-only shortcut rows, and a new generated keycap icon.
- Preserve selection order, pin/group membership, and native navigation history when duplicating or moving tabs. Improve group rearrangement and cross-window targeting; exclude app/popup windows.
- Protect loading and unrelated tabs during new-tab creation and handle collapsed group boundaries safely.
- Report actionable, privacy-safe failures through the popup and extension badge.

Requires Chrome 116 or newer. New required permissions are `offscreen` and `clipboardWrite`; media site access is optional and requested when pausing. Existing command names are preserved, so existing assignments remain associated with their commands. Newly added commands may need manual assignments when suggested keys conflict.

Shortcut backups cover Simple Shortcuts only and restore a checklist, not Chrome's actual key assignments. Screenshots cover the visible page area, excluding browser toolbars. No analytics, remote scripts, or permanent required host permissions were added.
