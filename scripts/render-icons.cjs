const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
(async () => {
  const root = path.resolve(__dirname, '..');
  const source = await fs.readFile(path.join(root, 'assets/icon.png'));
  for (const size of [16, 48, 128, 1024]) {
    await sharp(source).resize(size, size).png().toFile(path.join(root, `logo${size}.png`));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
