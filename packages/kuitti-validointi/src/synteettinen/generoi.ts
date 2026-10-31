/**
 * Generoi synteettiset kuittifikstuurit (kuvat + totuus.json) hakemistoon fixtures/synteettinen.
 *
 *   pnpm --filter @penni/kuitti-validointi generoi-fikstuurit
 *
 * Työkalut: `pdftoppm` (poppler) PDF → PNG, `sips` (macOS) kiertoon ja JPEG-muunnokseen.
 * Tulos on deterministinen; generoidut tiedostot on committoitu (pieniä), joten ajoa ei tarvita
 * ellei fikstuureja muuteta.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asetaExifOrientaatio } from '../exif.js';
import { FIKSTUURIT, type Fikstuuri } from './fikstuurit.js';
import { kirjoitaPdf } from './pdf.js';
import { FIKSTUURIHAKEMISTO } from './polut.js';

export { FIKSTUURIHAKEMISTO };

/** Kuvan tallennuskierto (myötäpäivään asteina), jolla EXIF-orientaatio `o` näyttää kuvan pystyssä. */
export function tallennusKierto(o: number): number {
  const kaanteinen: Record<number, number> = { 1: 0, 3: 180, 6: 270, 8: 90 };
  const aste = kaanteinen[o];
  if (aste === undefined) throw new Error(`orientaatio ${o} ei tuettu fikstuureissa`);
  return aste;
}

/** Renderöi yhden fikstuurin tiedostotavuiksi. */
export function renderoi(f: Fikstuuri): Uint8Array {
  const pdf = kirjoitaPdf(f.sivu);
  if (f.muoto === 'pdf') return pdf;

  const dir = mkdtempSync(join(tmpdir(), 'synt-fikstuuri-'));
  try {
    const pdfPolku = join(dir, 'a.pdf');
    writeFileSync(pdfPolku, pdf);
    execFileSync('pdftoppm', ['-png', '-r', '200', '-singlefile', pdfPolku, join(dir, 'a')]);
    const png = join(dir, 'a.png');
    if (f.muoto === 'png') return new Uint8Array(readFileSync(png));

    const kierretty = join(dir, 'b.png');
    execFileSync(
      'sips',
      ['--rotate', String(tallennusKierto(f.exif ?? 1)), png, '--out', kierretty],
      {
        stdio: 'ignore',
      },
    );
    const jpg = join(dir, 'b.jpg');
    execFileSync(
      'sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', kierretty, '--out', jpg],
      { stdio: 'ignore' },
    );
    return asetaExifOrientaatio(new Uint8Array(readFileSync(jpg)), f.exif ?? 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  mkdirSync(FIKSTUURIHAKEMISTO, { recursive: true });
  let yhteensa = 0;
  for (const f of FIKSTUURIT) {
    const tavut = renderoi(f);
    writeFileSync(join(FIKSTUURIHAKEMISTO, f.totuus.tiedosto), tavut);
    yhteensa += tavut.length;
    console.log(`${f.totuus.tiedosto}  ${tavut.length} B`);
  }
  writeFileSync(
    join(FIKSTUURIHAKEMISTO, 'totuus.json'),
    `${JSON.stringify(
      FIKSTUURIT.map((f) => f.totuus),
      null,
      2,
    )}\n`,
  );
  console.log(`yhteensä ${yhteensa} B`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
