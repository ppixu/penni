import type { Tili } from '@penni/engine';
import { type Leg, luokitteleLegit } from './legit.js';

/** One expected expense line: account + net (expense-leg debit, cents) + VAT code/percent. */
export interface MenoOdotus {
  tili: number;
  netto: number;
  alvKoodi: number;
  alvProsentti: number;
}

/** The booked voucher reduced to the fields we grade against. */
export interface Totuus {
  tositeId: number;
  pvm: string;
  myyja: string;
  brutto: number;
  alvYhteensa: number;
  menot: MenoOdotus[];
}

export type Poissulku = 'ei-kuitti' | 'monimutkainen';

/** Reduce a booked purchase voucher's legs to a Totuus, or reject a non-simple structure. */
export function poimiTotuus(
  tositeId: number,
  pvm: string,
  myyja: string,
  legit: readonly Leg[],
  chart: readonly Tili[],
): { totuus: Totuus } | { poissulku: Poissulku } {
  const { pankki, alv, menot, muu } = luokitteleLegit(legit, chart);
  if (pankki.length !== 1 || muu.length > 0 || menot.length === 0)
    return { poissulku: 'monimutkainen' };
  return {
    totuus: {
      tositeId,
      pvm,
      myyja,
      brutto: pankki.reduce((s, l) => s + l.kredit, 0),
      alvYhteensa: alv.reduce((s, l) => s + l.debet, 0),
      menot: menot.map((l) => ({
        tili: l.tili,
        netto: l.debet,
        alvKoodi: l.alvKoodi,
        alvProsentti: l.alvProsentti,
      })),
    },
  };
}
