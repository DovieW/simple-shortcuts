# Publish Simple Shortcuts 0.5.0

Upload files are prepared in `/tmp/simple-shortcuts-store-0.5.0`. Browser automation cannot operate the Chrome Web Store developer dashboard in this session, so the remaining dashboard actions are manual.

1. **Package:** upload `simple-shortcuts-v0.5.0.zip`. Confirm the uploaded package says 0.5.0. Use the original verified release ZIP, not the store-assets bundle ZIP.
2. **Store listing:** replace the outdated description with `description.txt`. Keep the current Functionality & UI category and English language unless you deliberately want to change them. No need to keep the old claim that all listed keymaps are defaults or that tabs must be reloaded after installation.
3. **Images:** replace the old store icon with `store-icon-128.png`. Replace old screenshots with `screenshot-1-shortcuts.png`, `screenshot-2-backup.png`, `screenshot-3-clipboard.png`, and `screenshot-4-media.png`, in that order. Set the required small promotional tile to `promo-small-440x280.png`. Use `promo-marquee-1400x560.png` for the optional marquee slot. The generated keycap asset is reused; screenshots show the actual released popup in an isolated fixture.
4. **Links:** homepage `https://github.com/DovieW/simple-shortcuts`; support `https://github.com/DovieW/simple-shortcuts/issues`; privacy policy `https://github.com/DovieW/simple-shortcuts/blob/master/PRIVACY.md`.
5. **Privacy:** use `privacy-fields.md` for the single purpose, all permission justifications, remote-code answer, and data handling disclosures. Local-only handling still needs disclosure; do not select a blanket “no user data” statement. Review the certification wording before checking it.
6. **Test instructions:** paste the reviewer instructions from `privacy-fields.md` if the dashboard requests them.
7. **Distribution:** retain the existing public distribution and availability unless you intend otherwise.
8. Click **Save draft**, then **Submit for review**. Resolve any validation errors. If offered automatic publishing after approval, enable it if you want 0.5.0 to go live as soon as approved. Otherwise a further Publish action is required after approval.
9. Verify the dashboard shows **Pending review** or equivalent. Submission is not the same as approval or publication; check the status after review.

Image sizes: icon 128×128 PNG with transparency; screenshots 1280×800 opaque PNG; small promo 440×280 opaque PNG; marquee 1400×560 opaque PNG.

Generate images again with `node scripts/render-store-assets.cjs [output-directory]`. This uses Playwright and Sharp development dependencies, touches only a temporary profile, and removes that profile afterward. Screenshot example missing keys are a fixture, not live browser settings.

Official references:
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
