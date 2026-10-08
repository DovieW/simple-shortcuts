# Simple Shortcuts

[Install for Chrome](https://chromewebstore.google.com/detail/simple-shortcuts/ahocokogjkjpkdjaobcjjdnmmlhpcapn)

Keyboard shortcuts for tabs, groups, windows, navigation, and media. Requires Chrome 116 or newer.

## Setup

Open the extension popup and click **Edit keys**, or visit `chrome://extensions/shortcuts`. The popup shows your actual assignments, lets you search commands, and lists missing or changed bindings against a saved snapshot. The rows are read-only; assign keys in Chrome's shortcut settings.

This README describes the current source; see [the changelog](CHANGELOG.md) for released and unreleased changes. To install a [GitHub release](https://github.com/DovieW/simple-shortcuts/releases), extract its extension ZIP, enable **Developer mode** at `chrome://extensions`, choose **Load unpacked**, and select the extracted directory. You can also load this source directory. After updating the files, click the extension's reload button there. An unpacked copy can have different shortcut assignments from the installed Web Store version. GitHub releases and Chrome Web Store publication are separate; the store version may lag.

Four shortcuts are suggested by the extension on installation. Chrome can assign them differently or leave them unset if they conflict with existing shortcuts. Everything else below is a recommendation you must assign yourself. Chrome allows at most four suggested shortcuts in an extension manifest.

| Command | Suggested on installation | Recommended manual binding |
| --- | --- | --- |
| Duplicate highlighted tab(s) | Alt+Shift+D | |
| Open highlighted web tabs in incognito | Alt+Shift+N | |
| Toggle pin highlighted tab(s) | Alt+Shift+P | |
| Copy a screenshot of the visible page | Alt+Shift+S | |
| New tab near current, in the same group | | Ctrl+E |
| New tab at the end of the current group | | Ctrl+Shift+G |
| New ungrouped tab at the end of the window | | Ctrl+Shift+E |
| Move highlighted tabs left / right | | Alt+Shift+Left / Right |
| Move highlighted tabs to front / back | | Alt+Shift+Up / Down |
| Switch to last active tab | | Alt+A |
| Walk backward through recently used tabs | | Choose an unused key |
| Walk forward toward newer tabs in the same history | | Choose an unused key |
| Cycle normal windows | | Alt+Shift+A |
| Move highlighted tabs to the next normal window | | Ctrl+Shift+A |
| Toggle collapse all groups in this window | | Ctrl+G |
| Move all groups to front / back | | Alt+Shift+G |
| Copy highlighted tab URLs, one per line | | Ctrl+Shift+C |
| Go to the current site's root | | Ctrl+Shift+H |
| Move highlighted tabs to the next group | | Choose unused keys |
| Pause media in all normal browser tabs | | Choose an unused key |

Chrome and operating-system shortcuts can take precedence. On macOS, use the shortcut settings to choose your preferred Command/Control bindings; the popup displays them separately.

## Copy links and screenshots

The existing **Copy links** command copies all highlighted tabs in tab-strip order, one URL per line. With one tab selected it still copies just that URL. Its command name is unchanged, so existing shortcut assignments carry over. It includes pinned/grouped tabs, keeps duplicate URLs, and ignores selections in other windows. If a selected tab has no available URL, it reports that instead of silently omitting the tab.

**Copy screenshot** captures the active tab's visible page area as a PNG image that you can paste directly into an image-capable application. It excludes browser toolbars and does not capture the full scrolling page. Chrome grants temporary capture access through `activeTab` when you invoke an extension shortcut. Focus the page and press **Alt+Shift+S**, or assign another binding in Chrome's shortcut settings. File pages additionally require Chrome's **Allow access to file URLs** setting. Chrome may restrict captures through browser or administrator policies.

The clipboard helper stays hidden and copies an actual image, not an image URL. Screenshots are never saved to disk, extension storage, or logs. If the active tab or its address changes during capture, the operation stops without replacing the clipboard. Capture failures also leave the clipboard alone; clipboard failures are reported. Very rapid captures can hit Chrome's rate limit. Global invocation while another app or Chrome app window is focused may lack capture access; focus the target page and retry when prompted.

## Remember shortcuts across browsers

After setting your preferred shortcuts, open the popup and click **Save** to remember the current assignments. The extension saves a snapshot of actual keys, including intentionally unassigned commands, in Chrome's sync storage.

On another browser, the popup compares its actual bindings with that snapshot. Missing or changed shortcuts show their previous keys; **Changes** filters the list into a restoration checklist. Newly added commands are marked as absent from the saved setup. Searching also matches remembered keys.

Saved shortcuts are never replaced simply by opening another browser with empty or default assignments. Click **Save** deliberately to adopt a new setup; replacing an existing different snapshot requires confirmation. Snapshots are kept separately for Linux, Windows, macOS, and other supported Chrome platforms, with a platform selector under **Backup** to inspect another setup.

Chrome Sync must be enabled and the extension must have the same extension ID in both browsers. Unpacked installations at different paths can have different IDs, and the Web Store and unpacked versions generally have different IDs. Under **Backup**, use **Export / Import** to transfer a remembered snapshot without relying on Sync. Each export contains the selected platform's snapshot and covers this extension's commands only. Imports update the checklist; they do not assign shortcuts. Sync transport itself is managed by Chrome and cannot be verified by the extension.

Chrome's Commands API can read assignments but cannot set them or report whether their scope is global. Use **Edit keys** to restore flagged bindings manually and check their scope there. The extension cannot recover assignments that were lost before you saved a snapshot.

## Tab and group behavior

- New-tab commands leave unrelated tabs intact. They replace only a completed, unpinned Chrome new-tab page at the requested position and with matching group membership. The replacement is created and grouped first so single-tab windows and groups survive. `about:blank`, loading tabs, tabs navigating elsewhere, and websites titled “New Tab” are never reused. If Chrome starts loading the original during replacement, it is preserved and both new-tab pages can remain. When the current tab is ungrouped, “new tab at the end of the current group” creates a tab beside it.
- Duplication uses Chrome's native tab duplication, including navigation history. Copies stay beside their originals and retain pin/group membership. The copies are selected together.
- Left/right moves preserve the selection's relative order. Entering an expanded group joins it; leaving a group ungroups the selection on the first press. Crossing the pinned boundary pins or unpins the selection. Collapsed groups are skipped.
- Front/back operates within the current group or pinned section. With an ungrouped selection it uses the unpinned window area. A repeated press within two seconds with the same selection can leave a group, pin tabs at the front, or unpin tabs at the back. Running another command cancels that repeated-press action.
- Selections spanning pin/group sections move within each existing section. They do not implicitly merge groups or change pinned status. Ungrouped tabs in a mixed selection move within their own contiguous ungrouped segments.
- Last active tab follows your usage history rather than tab-strip order, and can return to a tab in another normal window in the same privacy context. Repeated presses switch between the two most recently used tabs. If its group is collapsed, the group expands to reveal the tab. For example, after switching from tab 2 to tab 7, Last active tab returns to tab 2; pressing it again returns to tab 7.
- Group cycling follows the groups' order in the tab strip, includes collapsed groups, and expands the destination. It unpins any selected pinned tabs so they can join the group. From an ungrouped tab it starts at the first group.
- Moving tabs to another window preserves their relative order and pinned state, and recreates the selected groups' titles and colors in the destination. Destination groups are expanded so moved tabs remain visible.
- “Move all groups” gathers groups at the back; if they are already gathered there, it moves them to the front, after pinned tabs. Group order is retained.

## Walk recent tab history

Assign **Walk backward through recently used tabs (up to 32)** and **Walk forward toward newer tabs in the same recent-tab history** in **Edit keys**. The popup calls them **Older recent tab** and **Newer recent tab**. This is separate from **Last active tab**, which keeps toggling between your two most recently used tabs.

The first press freezes the current recent-tab list; each additional press selects the next older surviving tab. For example, after using A → B → C → D, repeated presses take you D → C → B → A. Use **Newer recent tab** to retrace the same list in the other direction: A → B → C → D. You can alternate the two commands at any point. Switching during the walk updates normal last-active history without reordering the frozen list. Closed tabs are skipped, collapsed destination groups expand, and tabs in app windows or the other privacy context are excluded.

The walk stops at either end and reports that it reached the boundary; it does not wrap. You can immediately reverse direction, including after a boundary message. On a fresh walk, Newer recent tab leaves you on the starting tab and tells you to use Older recent tab first. Selecting a different tab or window yourself, or running an extension command other than these two history commands, starts a fresh walk next time. The cursor survives worker suspension within the browser session. The 32-entry limit includes your starting tab, so a full list allows up to 31 backward steps.

## Windows and global shortcuts

Set a command's scope to **Global** in Chrome's shortcut settings if you want to invoke it while another application has focus. Each command resolves and focuses the last normal Chrome window before acting. App and popup windows are excluded from command targets and last-tab history.

Last-tab history records activations immediately and survives extension worker suspension. Closing several tabs removes them from history; switching also checks that each candidate still exists and selects the most recently used surviving tab. If the active tab closes, Chrome chooses a replacement and the shortcut switches from that replacement to the previous surviving tab. If no other remembered tab remains, it reports that without changing tabs. History retains up to 32 tab entries. It is stored in memory for the current browser session and discarded on browser restart or extension reload. Window cycling, cross-window moves, last-tab switching, and media controls stay within the current normal window's regular/incognito context. Enable the extension in incognito in Chrome if needed.

Chrome extensions cannot focus the existing address bar or remap F6. Use Ctrl+L (Cmd+L on macOS). To use Ctrl+K instead, configure your desktop key-remapping tool to send Ctrl+L while Chrome is focused. Issue #34 was closed as not planned for this browser API limitation.

## Media and permissions

The popup lists audible and muted tabs across normal windows in the current privacy context. Click a title to focus that tab, or use **Mute / Unmute**. Muting is independent of pausing.

**Pause all** and the pause shortcut request optional HTTP/HTTPS site access on first use. If declined, no scripts run. When granted, the extension pauses HTML `<audio>` and `<video>` elements in accessible frames and open shadow roots across normal browser windows in the current privacy context. Access can be revoked with **Revoke media** under **Backup** in the popup.

Browser pages, restricted pages, Web Audio, closed shadow roots, and players that resume themselves may not support pausing. A partial failure is shown in the popup; this command does not promise to stop every possible source of sound.

Required permissions:

- `tabs`: read tab URLs/titles for duplication, navigation, and the audio list.
- `tabGroups`: group navigation and rearrangement.
- `storage`: session tab history/command status and synced shortcut snapshots.
- `offscreen` and `clipboardWrite`: copy tab URLs and screenshot images through a hidden clipboard helper, without injecting clipboard code into websites.
- `activeTab`: temporary access to capture the visible tab when an extension shortcut is invoked.
- `scripting`: pause media when optional site access has been granted.

There are no permanent required host permissions, remote scripts, analytics, or runtime dependencies. Command errors display an `!` badge and an actionable popup message. The session stores only a command name, a fixed error code, and a timestamp; raw browser errors, URLs, and titles are not retained. Messages distinguish closed tabs/windows, missing destinations, denied site/capture access, partial media failures, and clipboard failures.

## Development and verification

Load this directory with **Load unpacked** at `chrome://extensions` (Developer mode).

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run icons
```

The Node regression suite uses a stateful Chrome API mock to verify destructive-tab safeguards, selection ordering, group boundaries, rapid history, privacy/window targeting, screenshot races, clipboard errors, and media permission denial. Browser tests load the actual extension into bundled Chromium with a disposable `/tmp` profile; they never connect to your existing browser. The clipboard fixture verifies pasted text and PNG content, including screenshot dimensions and pixels. Test screenshots are saved to temporary artifact directories, or `SHORTCUTS_TEST_ARTIFACTS` if set.

The media browser fixture separately verifies pausing after site access is granted. Beyond the isolated screenshot accelerator check below, native shortcut dispatch, OS focus, incognito enablement, and permission prompts still need manual checks in an installed Chrome extension. Suggested checks:

1. Assign left/right commands and move several highlighted tabs across pinned and expanded/collapsed group boundaries.
2. Use global shortcuts with Chrome app windows and another native app focused.
3. Enable incognito access and verify regular/incognito windows remain separate.
4. Decline media access, grant it on a later attempt, pause a real player, and revoke access.
5. Copy an HTTP URL and a `chrome://` URL, then paste into a text field.
6. Highlight several tabs and copy links, then use **Copy screenshot** and paste into an image-capable application.

The screenshot accelerator was also verified with real X11 key events against the production manifest in an isolated Xvfb display. To repeat this optional Linux check, start a private Xvfb display and run `SHORTCUTS_NATIVE=1 SHORTCUTS_ISOLATED_DISPLAY=1 DISPLAY=:<test-display> node tests/clipboard-browser.cjs`. It requires Python 3, libX11, and libXtst. The default headless clipboard fixture grants capture access only in a temporary extension copy; the main browser suite separately confirms the production extension rejects capture without a user grant. Desktop global invocation and incognito behavior still require checks on the target desktop.

Last-active toggling and recent-tab traversal across windows were also checked in headed Chromium on a private Xvfb display. Repeat that check with `SHORTCUTS_HEADED=1 DISPLAY=:<test-display> node tests/browser.cjs`. The default headless cross-window history check supplies explicit source-window contexts because headless Chromium can report multiple focused windows and stale focus order; the headed check exercises actual command window resolution.

Icons are resized from the generated image at `assets/icon.png`; `npm run icons` renders all checked-in PNG sizes. The image-generation prompt is saved in `assets/icon-prompt.md`. Playwright and Sharp are development dependencies only.

## Release packaging

Run `npm run package` to create `/tmp/simple-shortcuts-release-<version>/simple-shortcuts-v<version>.zip`. It requires the `zip` command and includes only runtime files, icons, the license, README, and changelog. To choose another output directory, use `npm run package -- /path/to/output`.

To verify the extracted ZIP instead of the source directory, run `SHORTCUTS_TEST_EXTENSION=/path/to/extracted npm run test:browser`. Test fixtures still use disposable profiles and local pages.

Store listing text, permission explanations, and manual submission instructions are in [store-assets/UPLOAD.md](store-assets/UPLOAD.md). Run `node scripts/render-store-assets.cjs` to generate the icon, screenshots, and promotional tiles in `/tmp/simple-shortcuts-store-0.5.0`. The screenshots use the real popup in a disposable fixture profile. See [the privacy policy](PRIVACY.md) for data handling details.
