// Store screenshots use the real popup in a disposable extension profile.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const sharp = require('sharp');

(async () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), `simple-shortcuts-store-${manifest.version}`));
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'shortcuts-store-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = worker.url().split('/')[2];
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('.shortcut-item').first().waitFor();
    await popup.emulateMedia({ colorScheme: 'dark' });
    const capture = async () => (await popup.locator('body').screenshot()).toString('base64');
    const overview = await capture();
    await popup.getByRole('button', { name: 'Remember current shortcuts', exact: true }).click();
    await popup.locator('#memorySummary').filter({ hasText: /^Saved$/ }).waitFor();
    // Demonstrate a remembered setup with missing keys, just as an import on a
    // fresh browser would show it. This fixture touches only the test profile.
    await worker.evaluate(async () => {
      const platform = (await chrome.runtime.getPlatformInfo()).os;
      const key = `shortcutSnapshotV1-${platform}`;
      const snapshot = (await chrome.storage.sync.get(key))[key];
      snapshot.bindings['switch-to-last-tab'] = 'Alt+A';
      snapshot.bindings['walk-recent-tabs'] = 'Alt+Shift+U';
      snapshot.bindings['copy-url'] = 'Ctrl+Shift+C';
      await chrome.storage.sync.set({ [key]: snapshot });
    });
    await popup.locator('#memorySummary').filter({ hasText: '3 missing' }).waitFor();
    await popup.locator('#onlyDifferences').check();
    await popup.getByRole('button', { name: 'Backup options', exact: true }).click();
    await popup.locator('#status').waitFor({state:'hidden'});
    const backup = await capture();
    await popup.locator('#onlyDifferences').uncheck();
    await popup.getByRole('button', { name: 'Backup options', exact: true }).click();
    await worker.evaluate(async () => {
      const platform = (await chrome.runtime.getPlatformInfo()).os;
      await chrome.storage.sync.remove(`shortcutSnapshotV1-${platform}`);
    });
    await popup.locator('#memorySummary').filter({hasText:'No saved setup'}).waitFor();
    await popup.locator('#search').fill('copy');
    if (await popup.locator('.shortcut-item').count() !== 2) throw Error('Clipboard commands missing');
    const clipboard = await capture();
    await worker.evaluate(async () => {
      for (const title of ['Project walkthrough','Focus playlist']) {
        const tab = await chrome.tabs.create({url:'data:text/html,<title>'+encodeURIComponent(title)+'</title>',active:false});
        await chrome.tabs.update(tab.id,{muted:true});
      }
    });
    await popup.locator('#audioTabs .audio-tab').nth(1).waitFor();
    await popup.locator('#search').fill('pause');
    const media = await capture();
    const icon = (await fs.readFile(path.join(root, 'assets/icon.png'))).toString('base64');
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: 'dark' });
    const base = `*{box-sizing:border-box}body{margin:0;background:#0a1223;color:#f5f8ff;font-family:Arial,sans-serif} .canvas{position:relative;width:1280px;height:800px;overflow:hidden;background:radial-gradient(ellipse at 95% 10%,#153d80 0,transparent 55%),#0a1223}.brand{position:absolute;left:74px;top:55px;display:flex;align-items:center;gap:14px;font-size:23px;font-weight:600}.brand img{width:54px;height:54px}.copy{position:absolute;left:76px;top:218px;width:560px}h1{font-size:62px;line-height:1.08;letter-spacing:-2px;margin:0 0 27px}p{font-size:25px;line-height:1.5;color:#b8c9e4;margin:0;max-width:505px}.tags{display:flex;gap:10px;margin-top:35px}.tag{padding:10px 14px;border:1px solid #2e466d;border-radius:7px;color:#cbdaf2;font-size:16px}.popup{position:absolute;width:420px;height:560px;right:88px;top:125px;border-radius:13px;box-shadow:0 32px 80px #0008;border:1px solid #344766;overflow:hidden}.popup img{width:420px;height:560px;display:block}.note{position:absolute;left:76px;bottom:68px;font-size:16px;color:#7f96ba}`;
    async function screenshot(name, title, text, tags, shot, note) {
      await page.setViewportSize({ width:1280, height:800 });
      await page.setContent(`<style>${base}</style><div class="canvas"><div class="brand"><img src="data:image/png;base64,${icon}">Simple Shortcuts</div><div class="copy"><h1>${title}</h1><p>${text}</p><div class="tags">${tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div></div><div class="popup"><img src="data:image/png;base64,${shot}"></div><div class="note">${note}</div></div>`);
      await page.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
      // Store dimensions are physical pixels, independent of capture DPI.
      const bytes = await page.screenshot();
      await sharp(bytes).resize(1280,800).flatten({background:'#0a1223'}).removeAlpha().png().toFile(path.join(output,name));
    }
    await screenshot('screenshot-1-shortcuts.png','Your tabs.<br>Your shortcuts.','Jump to your last active tab.<br>Walk backward through recent tabs.<br>Keep Chrome moving.', ['Tabs','Groups','Windows'],overview,'Actual extension popup · assign your preferred keys in Edit keys');
    await screenshot('screenshot-2-backup.png','Remember<br>your setup.','See missing or changed keys.<br>Save a snapshot and keep a backup.<br>Restore assignments manually.', ['Save','Compare','Export / Import'],backup,'Example remembered bindings · restore actual keys in Chrome settings');
    await screenshot('screenshot-3-clipboard.png','Copy links.<br>Capture the page.','Selected tab links, one per line.<br>Visible-page PNGs to your clipboard.<br>Ready to paste.', ['Multiple tabs','PNG screenshot'],clipboard,'Screenshot shortcut suggestion: Alt+Shift+S · key conflicts may require reassignment');
    await screenshot('screenshot-4-media.png','Control the<br>sound.','Find audible or muted tabs.<br>Mute or unmute an individual tab.<br>Pause HTML audio and video.', ['Pause','Mute / Unmute'],media,'Pause all requests optional site access · some pages and players restrict access');
    // Promotional tiles emphasize the existing generated keycap brand asset.
    async function promo(name,width,height) {
      await page.setViewportSize({width,height});
      const marquee=width>500;
      await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#134bce}.tile{width:${width}px;height:${height}px;overflow:hidden;position:relative;background:radial-gradient(ellipse at 30% 25%,#3b7dfa 0,#1451d8 55%,#0d2c78 100%)}.rings{position:absolute;width:${height*1.6}px;height:${height*1.6}px;border:2px solid #ffffff25;border-radius:50%;left:${marquee?30:-height*.15}px;top:${-height*.3}px;box-shadow:0 0 0 35px #ffffff08,0 0 0 70px #ffffff06}.key{position:absolute;width:${height*.78}px;height:${height*.78}px;left:${marquee?90:(width-height*.78)/2}px;top:${height*.1}px}.title{position:absolute;left:650px;top:160px;color:white;font:600 70px/1.12 Arial,sans-serif;letter-spacing:-2px}.sub{font:26px Arial,sans-serif;letter-spacing:0;color:#c5d9ff;margin-top:28px}</style><div class="tile"><div class="rings"></div><img class="key" src="data:image/png;base64,${icon}">${marquee?'<div class="title">Simple<br>Shortcuts<div class="sub">Tabs. Groups. Clipboard. Media.</div></div>':''}</div>`);
      await page.locator('img').evaluate(img=>img.decode());
      await sharp(await page.screenshot()).resize(width,height).flatten({background:'#134bce'}).removeAlpha().png().toFile(path.join(output,name));
    }
    await promo('promo-small-440x280.png',440,280);
    await promo('promo-marquee-1400x560.png',1400,560);
    await sharp(path.join(root,'assets/icon.png')).trim().resize(96,96,{fit:'contain'}).extend({top:16,bottom:16,left:16,right:16,background:{r:0,g:0,b:0,alpha:0}}).png().toFile(path.join(output,'store-icon-128.png'));
    for (const name of ['screenshot-1-shortcuts.png','screenshot-2-backup.png','screenshot-3-clipboard.png','screenshot-4-media.png','promo-small-440x280.png','promo-marquee-1400x560.png','store-icon-128.png']) {
      const m=await sharp(path.join(output,name)).metadata();console.log(`${name}: ${m.width}x${m.height}${m.hasAlpha?' with alpha':' opaque'}`);
    }
    console.log(output);
  } finally {
    await context.close();
    await fs.rm(profile,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
