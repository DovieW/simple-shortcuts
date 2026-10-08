const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

(async () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw Error('Release versions must match');
  const files = ['manifest.json', 'background.js', 'command-errors.js', 'popup.html', 'popup.js', 'popup.css', 'shortcut-ui.js', 'shortcut-memory.js', 'offscreen.html', 'offscreen.js', 'logo16.png', 'logo48.png', 'logo128.png', 'LICENSE', 'README.md', 'CHANGELOG.md'];
  const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), `simple-shortcuts-release-${manifest.version}`));
  await fs.mkdir(output, { recursive: true });
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-shortcuts-package-'));
  try {
    for (const file of files) await fs.copyFile(path.join(root, file), path.join(stage, file));
    const name = `simple-shortcuts-v${manifest.version}.zip`;
    execFileSync('zip', ['-q', '-X', '-9', name, ...files], { cwd: stage });
    await fs.copyFile(path.join(stage, name), path.join(output, name));
    console.log(path.join(output, name));
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
