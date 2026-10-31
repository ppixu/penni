/**
 * Nimien normalisointi ja vertailu täsmäytystä varten. Pankin tapahtumanimi ja kuitin
 * myyjänimi kirjoitetaan eri tavoin (isot/pienet, yritysmuodot, välimerkit), joten
 * vertailu tehdään normalisoituna ja merkitsevien sanojen perusteella.
 */

/** Normalisoi nimi vertailuun: pienaakkoset, ääkköset riisuttu, välimerkit väleiksi, tiivistetty. */
export function normalisoiNimi(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .replace(/ü/g, 'u')
    .replace(/õ/g, 'o')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Yritysmuodot ja yleissanat, jotka eivät yksin riitä nimitäsmäykseen. */
const YLEISSANAT = new Set([
  'oy',
  'oyj',
  'ab',
  'inc',
  'llc',
  'ltd',
  'plc',
  'pbc',
  'gmbh',
  'ky',
  'kb',
  'ou',
  'com',
  'the',
  'and',
  'subscription',
  'systems',
  'powered',
  'payment',
  'myymalat',
]);

/** Merkitsevät sanat (>= 3 merkkiä, ei yleissana) nimitäsmäykseen. */
export function merkitsevatSanat(s: string): string[] {
  return normalisoiNimi(s)
    .split(' ')
    .filter((w) => w.length >= 3 && !YLEISSANAT.has(w));
}

/**
 * Aliasryhmä: samaa myyjää tarkoittavat sanat, esim. brändi + juridinen nimi
 * (`['cursor', 'anysphere']`). Sanat normalisoituina (pienaakkoset, ilman ääkkösiä).
 */
export type Aliasryhma = readonly string[];

/** Laajentaa sanajoukon aliaksilla: jos joukossa on jokin ryhmän sana, lisätään koko ryhmä. */
function laajennaAliaksilla(sanat: Set<string>, aliakset: readonly Aliasryhma[]): Set<string> {
  const tulos = new Set(sanat);
  for (const ryhma of aliakset) {
    if (ryhma.some((s) => tulos.has(s))) for (const s of ryhma) tulos.add(s);
  }
  return tulos;
}

/**
 * Täsmäävätkö nimet: onko niillä vähintään yksi yhteinen merkitsevä sana (aliasryhmät
 * huomioiden). Aliakset laajennetaan molemmin puolin, joten vertailu on symmetristä.
 */
export function nimetTasmaavat(
  a: string,
  b: string,
  aliakset: readonly Aliasryhma[] = [],
): boolean {
  const sanatA = laajennaAliaksilla(new Set(merkitsevatSanat(a)), aliakset);
  const sanatB = laajennaAliaksilla(new Set(merkitsevatSanat(b)), aliakset);
  for (const w of sanatB) if (sanatA.has(w)) return true;
  return false;
}
