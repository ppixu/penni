import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, 'dist');
const html = readFileSync(join(root, 'landing-page.html'), 'utf8');
if (!html.includes('<html lang="fi">') || !html.includes('id="demo"')) {
  throw new Error('Sivun kieli tai demo puuttuu.');
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(join(root, 'landing-page.html'), join(output, 'index.html'));
cpSync(join(root, 'landing-assets'), join(output, 'landing-assets'), { recursive: true });
console.log('Built Penni marketing page: ' + output);
