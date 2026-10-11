# Publish Simple Shortcuts 0.6.0

Upload the extension ZIP from `~/Downloads/simple-shortcuts-v0.6.0.zip`. This release adds Unload tabs without changing permissions. GitHub release publication and Chrome Web Store review are separate steps; submit the package through the developer dashboard.

1. **Package:** upload `simple-shortcuts-v0.6.0.zip`. Confirm the uploaded package says 0.6.0. Use the original verified release ZIP, not the store-assets bundle ZIP.
2. **Store listing:** replace the outdated description with `description.txt`. Keep the current Functionality & UI category and English language unless you deliberately want to change them. No need to keep the old claim that all listed keymaps are defaults or that tabs must be reloaded after installation.
3. **Images:** existing store images can be retained for this command addition. To refresh them, run the generator below and use `store-icon-128.png`, `screenshot-1-shortcuts.png`, `screenshot-2-backup.png`, `screenshot-3-clipboard.png`, and `screenshot-4-media.png`, in that order. The promotional tiles are `promo-small-440x280.png` and the optional `promo-marquee-1400x560.png`. Generated screenshots use an isolated fixture.
4. **Links:** homepage `https://github.com/DovieW/simple-shortcuts`; support `https://github.com/DovieW/simple-shortcuts/issues`; privacy policy `https://github.com/DovieW/simple-shortcuts/blob/12ad8b4683298d98794ed0813cb3c041b1997e0a/PRIVACY.md`.
5. **Privacy:** use `privacy-fields.md` for the single purpose, all permission justifications, remote-code answer, and data handling disclosures. Local-only handling still needs disclosure; do not select a blanket “no user data” statement. Review the certification wording before checking it.
6. **Test instructions:** paste the reviewer instructions from `privacy-fields.md` if the dashboard requests them.
7. **Distribution:** retain the existing public distribution and availability unless you intend otherwise.
8. Click **Save draft**, then **Submit for review**. Resolve any validation errors. If offered automatic publishing after approval, enable it if you want 0.6.0 to go live as soon as approved. Otherwise a further Publish action is required after approval.
9. Verify the dashboard shows **Pending review** or equivalent. Submission is not the same as approval or publication; check the status after review.

Image sizes: icon 128×128 PNG with transparency; screenshots 1280×800 opaque PNG; small promo 440×280 opaque PNG; marquee 1400×560 opaque PNG.

Generate images again with `node scripts/render-store-assets.cjs [output-directory]`. This uses Playwright and Sharp development dependencies, touches only a temporary profile, and removes that profile afterward. Screenshot example missing keys are a fixture, not live browser settings.

Official references:
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
