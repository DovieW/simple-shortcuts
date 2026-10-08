# Chrome Web Store privacy fields for 0.5.0

These descriptions match the released source. Review the dashboard's actual field wording before certifying or submitting.

## Single purpose

Provide user-configurable keyboard shortcuts for controlling Chrome tabs, groups, windows, navigation, clipboard copying, and media, with a popup to inspect and remember those shortcuts.

## Permission justifications

### tabs

Read open-tab URLs and titles for the user's tab-management commands, Copy links, navigation, and the audible/muted tab list. Tab identifiers and regular/incognito context support recent-tab switching. Tab URLs and titles are not uploaded to the developer or stored in the session history.

### tabGroups

Create, inspect, move, recreate, collapse, and expand tab groups for the user's tab/group shortcuts. Preserve group title, color, and membership when duplicating or moving selected tabs, and reveal collapsed destination groups during recent-tab switching.

### storage

Keep recent tab identifiers, traversal state, and limited command/error status in Chrome session storage. Save explicitly requested shortcut snapshots (command names, key combinations, operating system, and timestamp) in Chrome sync storage so the popup can compare assignments on another browser. URLs, page content, and screenshots are not included in shortcut snapshots.

### activeTab

Obtain temporary user-invoked access to capture the visible active page for Copy screenshot. Capture happens only when the user invokes that command; the PNG is written to the clipboard and not sent to the developer or saved in extension storage.

### scripting

Execute the extension's packaged media-pause function in accessible pages and frames only after the user grants optional HTTP/HTTPS site access. The function pauses HTML audio/video elements, including accessible open shadow roots. It does not upload page content or run remote code.

### offscreen

Use a hidden extension document for DOM-based clipboard operations that are unavailable in the Manifest V3 service worker. It copies selected tab URL text and user-requested PNG screenshots without opening a visible helper tab or injecting clipboard code into websites.

### clipboardWrite

Write selected tab URLs or a visible-page PNG to the system clipboard when the user invokes Copy links or Copy screenshot. The extension does not read existing clipboard contents.

### Optional host permissions: http://*/* and https://*/*

Pause all media must reach audio/video elements across the user's open web tabs, including frames and open shadow roots. Site access is optional and requested when the user first chooses Pause all; there are no permanent required host permissions. Access can be removed in the popup with Backup → Revoke media. Page content is processed locally and is not sent to the developer.

## Remote code

Select **No, I am not using remote code**. Executable extension code is included in the package. The screenshot helper fetches only the in-memory PNG data URL produced by Chrome; it does not fetch executable code from a server.

## Data usage

Disclose **Web history** (open-tab URLs/titles and recent tab activity) and **Website content** (user-requested page screenshots and local media control). This includes local processing; do not claim that the extension handles no user data simply because the developer receives none. The extension does not independently extract identities, payment data, health information, credentials, or personal communications from pages; page screenshots may incidentally contain whatever is visible on the user's page.

The three standard certifications are consistent with the implementation:

- User data is not sold or transferred to third parties outside approved use cases. Chrome Sync carries shortcut settings, and user-directed clipboard/export operations are described in the policy.
- Data is not used or transferred for purposes unrelated to the extension's single purpose.
- Data is not used or transferred to determine creditworthiness or for lending purposes.

Review the exact certification wording yourself before selecting the checkboxes. Google requires disclosure of data handled locally as well as a privacy policy.

## Privacy policy URL

https://github.com/DovieW/simple-shortcuts/blob/12ad8b4683298d98794ed0813cb3c041b1997e0a/PRIVACY.md

## Reviewer test instructions

No account or subscription is required. Requires Chrome 116+. Open the popup, choose Edit keys, and assign an unused key for Last active tab and Older recent tab. Visit three tabs and test toggling versus backward traversal. Highlight multiple tabs and invoke Copy links, then paste into a text field. Invoke Copy screenshot from a focused page (suggested Alt+Shift+S) and paste into an application that accepts PNG images. Save a shortcut snapshot in the popup; Backup exposes Export and Import. Pause requests optional site access; deny it to verify no scripts run, or allow it and test a standard HTML video/audio page. Revoke it with Backup → Revoke media. Existing commands can be used in regular/incognito contexts separately when Chrome's Allow in incognito is enabled.

## Sources

- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
