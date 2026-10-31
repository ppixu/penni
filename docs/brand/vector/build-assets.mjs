import { readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
// Reuse the SVG renderer already installed with the web app's image dependencies.
const webRequire = createRequire(join(root, 'apps/web/package.json'));
const imageRequire = createRequire(webRequire.resolve('@huggingface/transformers'));
const sharp = imageRequire('sharp');
const logo = readFileSync(join(here, 'penni-stacked.svg'), 'utf8');
const contents = logo.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-labelledby="icon-title">
  <title id="icon-title">Penni-sovelluksen kuvake</title>
  <defs><filter id="tile-shadow" x="-10%" y="-10%" width="120%" height="125%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#202027" flood-opacity=".16"/></filter></defs>
  <rect x="96" y="96" width="832" height="832" rx="186" fill="#fff" stroke="#e1e2e7" stroke-width="1.5" filter="url(#tile-shadow)"/>
  <svg x="96" y="96" width="832" height="832" viewBox="0 0 600 600" aria-hidden="true">${contents}</svg>
</svg>\n`;
writeFileSync(join(here, 'penni-icon.svg'), icon);
const desktop = join(root, 'apps/desktop/assets');
const web = join(root, 'apps/web/public');
const site = join(root, 'docs/mockups/landing-assets');
for (const dir of [desktop, web, site]) mkdirSync(dir, { recursive: true });
for (const path of [join(desktop, 'penni-icon.svg'), join(web, 'penni-icon.svg'), join(site, 'penni-icon.svg')]) writeFileSync(path, icon);
for (const path of [join(web, 'penni-mark.svg'), join(site, 'penni-logo.svg')]) writeFileSync(path, logo);
await sharp(Buffer.from(icon), { density: 144 }).resize(1024).png().toFile(join(desktop, 'penni-icon.png'));
for (const [path, size] of [[join(web, 'penni-mark.png'), 128], [join(web, 'favicon.png'), 32], [join(web, 'apple-touch-icon.png'), 180], [join(site, 'penni-icon.png'), 1024]]) {
  await sharp(Buffer.from(icon), { density: 144 }).resize(size).png().toFile(path);
}
await sharp(Buffer.from(logo), { density: 168 }).png().toFile(join(here, 'penni-stacked.png'));
cpSync(join(here, 'penni-stacked.png'), join(site, 'penni-logo.png'));
if (process.platform === 'darwin') {
  const temp = mkdtempSync(join(tmpdir(), 'penni-icon-'));
  const iconset = join(temp, 'Penni.iconset');
  mkdirSync(iconset);
  try {
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        await sharp(Buffer.from(icon), { density: 144 }).resize(size * scale).png().toFile(join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
      }
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(desktop, 'penni.icns')]);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
console.log('Updated vector logo, vector icon, PNG fallbacks and macOS icon.');
