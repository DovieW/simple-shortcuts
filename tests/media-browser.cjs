// Verify post-grant media behavior using a temporary extension copy with access
// only to a local fixture. Production keeps all host permissions optional.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-shortcuts-media-'));
  const fixture = path.join(root, 'extension');
  await fs.mkdir(fixture);
  for (const file of ['manifest.json', 'background.js', 'command-errors.js', 'popup.html', 'popup.js', 'popup.css', 'shortcut-ui.js', 'shortcut-memory.js', 'offscreen.html', 'offscreen.js', 'logo16.png', 'logo48.png', 'logo128.png']) {
    await fs.copyFile(path.join(process.env.SHORTCUTS_TEST_EXTENSION || path.resolve(__dirname, '..'), file), path.join(fixture, file));
  }
  const manifest = JSON.parse(await fs.readFile(path.join(fixture, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await fs.writeFile(path.join(fixture, 'manifest.json'), JSON.stringify(manifest));
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  for (let i = 0; i < 8000; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 8000) * 3000), 44 + i * 2);
  const server = http.createServer((request, response) => {
    if (request.url === '/audio.wav') { response.writeHead(200, { 'Content-Type': 'audio/wav' }); response.end(wav); }
    else if (request.url === '/frame') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<audio id="frameAudio" src="/audio.wav" autoplay loop></audio>'); }
    else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<title>Audio fixture</title><audio id="audio" src="/audio.wav" autoplay loop></audio><iframe src="/frame"></iframe><div id="shadow"></div><script>const root=document.getElementById('shadow').attachShadow({mode:'open'});const media=document.createElement('audio');media.src='/audio.wav';media.autoplay=true;media.loop=true;root.append(media);</script>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(root, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`, '--autoplay-policy=no-user-gesture-required'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = context.pages()[0];
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !document.querySelector('audio').paused && !document.getElementById('shadow').shadowRoot.querySelector('audio').paused);
    await page.frames()[1].waitForFunction(() => !document.querySelector('audio').paused);
    await worker.evaluate(() => enqueueCommand(() => runCommand('pause-all-tabs', true)));
    assert.equal(await page.evaluate(() => document.querySelector('audio').paused), true);
    assert.equal(await page.evaluate(() => document.getElementById('shadow').shadowRoot.querySelector('audio').paused), true);
    assert.equal(await page.frames()[1].evaluate(() => document.querySelector('audio').paused), true);
    console.log('PASS real media pause in page, iframe, and open shadow root');
    await page.evaluate(() => document.querySelector('audio').play());
    await page.waitForFunction(() => !document.querySelector('audio').paused);
    const id = worker.url().split('/')[2];
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const mediaTab = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.title === 'Audio fixture'));
    await worker.evaluate(id => chrome.tabs.update(id, {muted:true}), mediaTab.id);
    await popup.getByRole('button', { name: /Unmute Audio fixture/ }).waitFor();
    await popup.getByRole('button', { name: /Unmute Audio fixture/ }).click();
    for (let i=0; i<100; i++) {
      const tab = await worker.evaluate(id => chrome.tabs.get(id), mediaTab.id);
      if (!tab.mutedInfo.muted) break;
      await new Promise(resolve => setTimeout(resolve,25));
    }
    const tab = await worker.evaluate(id => chrome.tabs.get(id), mediaTab.id);
    assert.equal(tab.mutedInfo.muted, false);
    console.log('PASS real muted-tab listing, live updates, and unmute action');
  } finally {
    if (context) await context.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
