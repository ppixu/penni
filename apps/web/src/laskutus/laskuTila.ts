import type { IsoDate, MyyntilaskuRivi } from '@penni/engine';

export type LaskunTila = 'maksettu' | 'avoin' | 'eraantynyt';

/**
 * Listarivin tila: avoin 0 → maksettu (käteinen/kortti on rakenteellisesti avoin 0);
 * eräpäivä ohitettu JA avointa jäljellä → erääntynyt (eräpäivä tänään ei vielä ole —
 * sama tiukka vertailu kuin moottorin eraantynyt-suodattimessa, myyntilaskuResource.ts:232).
 * Totuusarvotesti (ei !== undefined): tyhjä merkkijono '' on väärä tosite-data (vanha
 * bugi saattoi tallentaa sen), eikä '' < tanaan -vertailu saa koskaan tehdä siitä erääntynyttä.
 */
export function laskuTila(
  rivi: Pick<MyyntilaskuRivi, 'avoin' | 'erapvm'>,
  tanaan: IsoDate,
): LaskunTila {
  if (rivi.avoin === 0) return 'maksettu';
  if (rivi.erapvm && rivi.erapvm < tanaan) return 'eraantynyt';
  return 'avoin';
}
