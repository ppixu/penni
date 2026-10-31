import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

/** Montako automaattista päiväkopiota kustakin kirjasta säilytetään. */
export const SAILYTETTAVAT = 14;

function kirjanNimi(kirja: string): string {
  return basename(kirja, extname(kirja));
}

/** Automaattiset kopiot kirjan vieressä: `<kirjan kansio>/varmuuskopiot/`. */
export function varmuuskopioKansio(kirja: string): string {
  return join(dirname(kirja), 'varmuuskopiot');
}

/** Paikallinen päivämäärä muodossa vvvv-kk-pp (ei UTC: kopio nimetään käyttäjän päivälle). */
export function tanaan(nyt = new Date()): string {
  const kk = String(nyt.getMonth() + 1).padStart(2, '0');
  const pp = String(nyt.getDate()).padStart(2, '0');
  return `${nyt.getFullYear()}-${kk}-${pp}`;
}

/** Käsin otettavan kopion oletuspolku kirjan vieressä. */
export function kasinOtettavanNimi(kirja: string, pvm: string): string {
  return join(dirname(kirja), `${kirjanNimi(kirja)}-varmuuskopio-${pvm}.penni`);
}

/**
 * Ota kirjasta päivän automaattinen kopio, ellei sitä jo ole, ja karsi saman kirjan vanhimmat
 * päiväkopiot pois niin, että {@link SAILYTETTAVAT} uusinta jää. Palauttaa luodun kopion polun,
 * tai null jos tämän päivän kopio oli jo olemassa.
 *
 * Karsinta tunnistaa vain tarkalleen `<kirja>-vvvv-kk-pp.penni`-nimet: saman kansion muiden
 * kirjojen kopiot (vaikka nimi alkaisi samalla etuliitteellä) ja käsin otetut kopiot jäävät
 * koskematta.
 */
export function otaPaivittainenVarmuuskopio(
  kirja: string,
  varmuuskopioi: (kohde: string) => void,
  pvm: string = tanaan(),
): string | null {
  const kansio = varmuuskopioKansio(kirja);
  const nimi = kirjanNimi(kirja);
  const kohde = join(kansio, `${nimi}-${pvm}.penni`);
  if (existsSync(kohde)) return null;
  mkdirSync(kansio, { recursive: true });
  varmuuskopioi(kohde);

  const malli = new RegExp(`^${escapeRegExp(nimi)}-\\d{4}-\\d{2}-\\d{2}\\.penni$`);
  const paivakopiot = readdirSync(kansio)
    .filter((n) => malli.test(n))
    .sort()
    .reverse();
  for (const vanha of paivakopiot.slice(SAILYTETTAVAT)) rmSync(join(kansio, vanha));
  return kohde;
}

function escapeRegExp(teksti: string): string {
  return teksti.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
