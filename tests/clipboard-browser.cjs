// Actual paste events verify clipboard contents; no clipboardRead permission.
// Everything runs in an isolated Chromium profile against a local fixture.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const sharp = require('sharp');
const { execFileSync } = require('node:child_process');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-shortcuts-clipboard-'));
  let extension = path.resolve(process.env.SHORTCUTS_TEST_EXTENSION || path.join(__dirname, '..'));
  const native = process.env.SHORTCUTS_NATIVE === '1';
  const title = `Shortcuts clipboard ${path.basename(root)}`;
  if (!native) {
    // Headless Chromium cannot dispatch native extension accelerators. Exercise
    // the capture/clipboard pipeline after granting access in a disposable copy.
    const fixture = path.join(root,'extension');
    await fs.mkdir(fixture);
    for (const file of ['manifest.json','background.js','command-errors.js','popup.html','popup.js','popup.css','shortcut-ui.js','shortcut-memory.js','offscreen.html','offscreen.js','logo16.png','logo48.png','logo128.png']) await fs.copyFile(path.join(extension,file),path.join(fixture,file));
    const manifest = JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8'));
    manifest.host_permissions = ['<all_urls>'];
    await fs.writeFile(path.join(fixture,'manifest.json'),JSON.stringify(manifest));
    extension = fixture;
  }
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<title>${title} ${request.url}</title><style>html,body{margin:0;background:rgb(20,120,220);height:2000px}textarea{margin:20px}</style><textarea aria-label="Paste target"></textarea><script>
      window.pasted=null;
      document.addEventListener('paste', async event => {
        event.preventDefault();
        const files=await Promise.all([...event.clipboardData.files].map(async file=>({type:file.type,bytes:[...new Uint8Array(await file.arrayBuffer())]})));
        window.pasted={text:event.clipboardData.getData('text/plain'),files};
      });
    </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
      channel: 'chromium', headless: !native, viewport: { width: 800, height: 600 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...(native ? ['--ozone-platform=x11'] : [])]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = worker.url().split('/')[2];
    const page = context.pages()[0];
    await page.goto(base + '/one');
    await page.bringToFront();
    const source = await worker.evaluate(async base => (await chrome.tabs.query({})).find(tab => tab.url === base + '/one'), base);
    const run = command => worker.evaluate(command => enqueueCommand(() => runCommand(command)), command);
    async function paste() {
      await page.evaluate(() => { window.pasted = null; });
      await page.getByRole('textbox').click();
      await page.keyboard.press('Control+V');
      await page.waitForFunction(() => window.pasted !== null);
      return page.evaluate(() => window.pasted);
    }

    if (native) {
      // Calling a worker function is not a gesture and must not grant access.
      const denied = await worker.evaluate(async () => {
        try { await runCommand('copy-screenshot'); return 'unexpected success'; }
        catch (error) { return error.code; }
      });
      assert.equal(denied, 'screenshot_permission');
      console.log('PASS screenshot requires temporary capture access');
    }

    await worker.evaluate(async ({ source, base }) => {
      await chrome.tabs.create({windowId:source.windowId,url:base+'/two',active:false});
      await chrome.tabs.create({windowId:source.windowId,url:base+'/one',active:false});
      await chrome.tabs.create({windowId:source.windowId,url:base+'/excluded',active:false});
      await chrome.windows.create({url:base+'/other-window',focused:false});
      await chrome.windows.update(source.windowId,{focused:true});
      await chrome.tabs.highlight({windowId:source.windowId,tabs:[1,0,2]});
    }, {source,base});
    // The active tab is not the first selected tab; output follows strip order.
    await run('copy-url');
    await worker.evaluate(id => chrome.tabs.update(id,{active:true}),source.id);
    await page.bringToFront();
    assert.equal((await paste()).text, [base+'/one',base+'/two',base+'/one'].join('\n'));
    console.log('PASS multi-tab links paste in strip order and exclude other tabs/windows');
    await worker.evaluate(async source => {
      for (const window of await chrome.windows.getAll({windowTypes:['normal']})) if (window.id !== source.windowId) await chrome.windows.remove(window.id);
      await chrome.windows.update(source.windowId,{focused:true});
      await chrome.tabs.update(source.id,{active:true});
    },source);
    await run('copy-url');
    assert.equal((await paste()).text,base+'/one');
    console.log('PASS single-tab link copying is unchanged');
    const windowsBeforeCapture = await worker.evaluate(async () => (await chrome.windows.getAll()).length);

    if (native) {
      await worker.evaluate(() => {
        chrome.commands.onCommand.addListener(command => chrome.storage.session.set({testLastCommand:command}));
      });
      // CDP keyboard events bypass browser accelerators. Send real X11 events
      // only to the uniquely titled fixture window on an isolated Xvfb display.
      assert.equal(process.env.SHORTCUTS_ISOLATED_DISPLAY,'1');
      execFileSync('python3',[path.join(__dirname,'native-shortcut.py'),title+' /one']);
      await worker.evaluate(async () => {
        for (let i = 0; i < 200; i++) {
          if ((await chrome.storage.session.get('testLastCommand')).testLastCommand === 'copy-screenshot') return;
          await new Promise(resolve => setTimeout(resolve,25));
        }
        throw new Error('Native screenshot shortcut did not dispatch');
      });
    } else await run('copy-screenshot');
    await worker.evaluate(() => commandQueue);
    // Error reporting is attached to the command promise; allow it to settle.
    await worker.evaluate(() => new Promise(resolve => setTimeout(resolve, 25)));
    assert.equal((await worker.evaluate(() => chrome.storage.session.get('lastError'))).lastError, undefined);
    const pasted = await paste();
    assert.equal(pasted.files.length,1,`Clipboard text length ${pasted.text.length}, PNG files ${pasted.files.length}`);
    assert.equal(pasted.files[0].type,'image/png');
    const image = sharp(Buffer.from(pasted.files[0].bytes));
    const metadata = await image.metadata();
    assert.equal(metadata.width,800);
    assert.equal(metadata.height,600); // Visible viewport, not the 2000px page.
    const {data,info} = await image.raw().toBuffer({resolveWithObject:true});
    const offset = (300 * info.width + 400) * info.channels;
    assert.deepEqual([...data.subarray(offset,offset+3)],[20,120,220]);
    await fs.writeFile(path.join(root,'pasted-screenshot.png'),Buffer.from(pasted.files[0].bytes));
    assert.equal((await worker.evaluate(() => chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]}))).length,1);
    assert.equal(await worker.evaluate(async () => (await chrome.windows.getAll()).length),windowsBeforeCapture);
    console.log(`PASS ${native ? 'native shortcut' : 'post-grant capture'} copies a pasteable PNG of the visible page without a helper window`);

    await run('copy-url');
    assert.equal((await paste()).text,base+'/one');
    const clipboardContexts = await worker.evaluate(() => chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}));
    assert.equal(clipboardContexts.some(item => item.documentUrl.startsWith('blob:')),false);
    console.log('PASS copying links after an image clears the image helper and pastes text');

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('.shortcut-item').first().waitFor();
    const failure = await popup.evaluate(() => chrome.runtime.sendMessage({target:'background',type:'run-command',command:'go-home'}));
    assert.equal(failure.ok,false);
    assert.equal(failure.code,'no_web_url');
    await popup.reload();
    await popup.locator('#status').filter({hasText:'Select a web page first.'}).waitFor();
    assert.equal(await popup.locator('body').evaluate(element => element.scrollHeight <= element.clientHeight),true);
    assert.match(await popup.locator('#status').innerText(),/^Site home:/);
    await popup.screenshot({path:path.join(root,'popup-error.png')});
    console.log('PASS worker failures retain a safe reason and show an actionable popup message');
    console.log(`Clipboard artifacts: ${root}`);
  } finally {
    if (context) await context.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
