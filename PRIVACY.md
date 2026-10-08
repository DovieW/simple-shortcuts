# Simple Shortcuts privacy policy

Effective date: October 6, 2026. This policy describes Simple Shortcuts 0.5.0.

Simple Shortcuts provides keyboard shortcuts for managing browser tabs, groups, windows, navigation, clipboard copying, and media. It has no advertising, analytics, tracking SDKs, remote executable code, or developer-operated data servers. The developer does not receive your tab activity, page content, clipboard contents, or shortcut assignments from the extension.

## Data handled for extension features

- **Tabs and browsing activity:** The extension reads open-tab URLs, titles, identifiers, group/pin state, and audio state to carry out tab commands and show audio tabs. It records up to 32 recent tab entries (tab/window identifiers and regular/incognito context) in Chrome's session storage for Last active tab and Older recent tab. URLs and titles are not stored in that history or sent to the developer. History and traversal state are discarded when the browser session ends or the extension reloads.
- **Clipboard and page content:** Copy links writes the selected tabs' URLs to the system clipboard. Copy screenshot captures the visible page as a PNG and writes it to the clipboard when you invoke the command. The extension does not read existing clipboard contents or save screenshots to disk, extension storage, or logs. A hidden image helper may retain the most recent screenshot in memory until the next copy or for up to 30 seconds. The operating system and applications you paste into may retain clipboard data under their own policies.
- **Media controls:** With optional HTTP/HTTPS site access, the extension uses packaged scripts to find and pause HTML audio/video elements in accessible pages, frames, and open shadow roots. This processing is local; page content is not transmitted to the developer. The popup displays audible/muted tab titles and lets you focus or mute those tabs.
- **Shortcut snapshots:** Choosing Save stores command names, assigned key combinations (including unassigned entries), operating-system platform, and a timestamp in Chrome's sync storage. Chrome may synchronize that data through Google's services according to your Chrome settings and Google's policies. Snapshots contain no tab URLs, page content, screenshots, or browsing history. Opening the popup alone does not replace a saved snapshot.
- **Backups:** Export creates a JSON file for the selected platform's shortcut snapshot. Import reads a file you choose to update the remembered snapshot, with confirmation before replacing a different existing setup. These files are not uploaded to the developer.
- **Operational status:** Chrome's session storage holds fixed error codes, command names, timestamps, and limited command state such as selected tab identifiers and media success/failure counts. It does not store raw browser errors, tab URLs, or titles in error records.

## Sharing and use

Data is used only to provide the extension's visible features. The extension does not sell user data, use it for advertising, or use it for creditworthiness or lending decisions. It does not transfer tab activity, screenshots, or page content to third parties. Shortcut snapshots may be transferred by Chrome Sync as described above. Clipboard copying and exporting happen at your request; any sharing you perform by pasting or sending exported files is under your control.

Simple Shortcuts' use of user data complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. The developer does not inspect user browsing data through the extension.

## Your controls and retention

You can set or change actual shortcut keys at `chrome://extensions/shortcuts`. Save deliberately to replace a remembered setup, or export it for your own backup. Saved snapshots remain until replaced or removed through Chrome's extension storage controls; removing extension data on one device does not necessarily erase backups or all synchronized copies, which Chrome manages.

Optional media access can be removed using **Backup → Revoke media**. Capture access uses Chrome's temporary `activeTab` permission. File-page access and incognito access are controlled separately in Chrome's extension details. The extension keeps regular and incognito tab operations separate. Removing the extension stops its processing; exported files and clipboard history in other software are outside its control.

## Contact and updates

For questions, use [the project issue tracker](https://github.com/DovieW/simple-shortcuts/issues). Do not include private URLs, screenshots, or credentials in a public issue. Updates to this policy will be published in this repository when the extension's data practices change.
