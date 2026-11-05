/**
 * Prosentit kokonaislukuina peruspisteinä (100 bp = 1 %). Merkkijono jäsennetään numeroittain:
 * ei parseFloat-/Number-desimaaleja, joten 19,35 -> 1935 ilman liukulukuvirhettä.
 */

/** "23,5" / "23.5" -> 2350. Enintään kaksi desimaalia, 0–100 %. Virheellinen -> null. */
export function parsiBp(teksti: string): number | null {
  const t = teksti.trim();
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const kokonaiset = Number.parseInt(m[1] as string, 10);
  const desimaalit = Number.parseInt((m[2] ?? '').padEnd(2, '0') || '0', 10);
  const bp = kokonaiset * 100 + desimaalit;
  return bp <= 10000 ? bp : null;
}

/** 2350 -> "23,5"; 2485 -> "24,85"; 700 -> "7". */
export function muotoileBp(bp: number): string {
  const kokonaiset = Math.trunc(bp / 100);
  const desimaalit = String(bp % 100)
    .padStart(2, '0')
    .replace(/0$/, '');
  return desimaalit === '0' || desimaalit === ''
    ? String(kokonaiset)
    : `${kokonaiset},${desimaalit}`;
}

/**
 * Tunnit, km, päivät ja ateriat sadasosina (`PalkkaRivi.maara`): "37,5" -> 3750. Enintään kaksi
 * desimaalia; `kokonaisluku` (päivärahat, ateriat) hylkää desimaalit. Tyhjä on 0. Välilyönnit
 * (tuhaterottimet) ohitetaan. Jäsennys numeroittain, ei parseFloatia.
 */
export function parsiSadasosat(
  teksti: string,
  kokonaisluku = false,
): { arvo: number } | { virhe: string } {
  const t = teksti.replace(/[\s ]/g, '');
  if (t === '') return { arvo: 0 };
  const m = /^(\d{1,9})(?:[.,](\d+))?$/.exec(t);
  if (!m) return { virhe: 'Määrä ei ole kelvollinen luku.' };
  const desimaalit = m[2] ?? '';
  if (kokonaisluku && /[1-9]/.test(desimaalit)) return { virhe: 'Määrän on oltava kokonaisluku.' };
  if (desimaalit.length > 2) return { virhe: 'Määrä: enintään kaksi desimaalia.' };
  const kokonaiset = Number.parseInt(m[1] as string, 10);
  return { arvo: kokonaiset * 100 + Number.parseInt(desimaalit.padEnd(2, '0'), 10) };
}

/** 3750 -> "37,5"; 10000 -> "100"; 0 -> "" (tyhjä kenttä). */
export function muotoileSadasosat(sadasosat: number): string {
  if (sadasosat === 0) return '';
  const kokonaiset = Math.trunc(sadasosat / 100);
  const desimaalit = String(sadasosat % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return desimaalit === '' ? String(kokonaiset) : `${kokonaiset},${desimaalit}`;
}
