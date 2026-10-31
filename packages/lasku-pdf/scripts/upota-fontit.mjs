// Generoi src/fontData/*.ts fonts/-hakemiston Inter-TTF-tiedostoista (base64).
// Ajo: node scripts/upota-fontit.mjs   (paketin juuressa)
// Fontit upotetaan lähdekoodiin, jotta ne toimivat sekä Nodessa että Vite-selainbuildissa ilman fetchiä.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const juuri = join(dirname(fileURLToPath(import.meta.url)), '..');
// Yksi tiedosto per fontti: Biomen tiedostokokoraja on 1 MiB, ja molemmat yhdessä ylittäisivät sen.
const fontit = [
  ['INTER_REGULAR_BASE64', 'Inter-Regular.ttf', 'interRegular.ts'],
  ['INTER_SEMIBOLD_BASE64', 'Inter-SemiBold.ttf', 'interSemiBold.ts'],
];

mkdirSync(join(juuri, 'src', 'fontData'), { recursive: true });
for (const [nimi, tiedosto, kohde] of fontit) {
  const base64 = readFileSync(join(juuri, 'fonts', tiedosto)).toString('base64');
  const ulos = [
    '// GENEROITU tiedostolla scripts/upota-fontit.mjs — älä muokkaa käsin.',
    '// Inter (SIL Open Font License 1.1, ks. fonts/OFL.txt), staattinen TTF base64-muodossa.',
    `export const ${nimi} =`,
    `  '${base64}';`,
    '',
  ].join('\n');
  writeFileSync(join(juuri, 'src', 'fontData', kohde), ulos);
  console.log(`src/fontData/${kohde} kirjoitettu`);
}
