import type { IsoDate, Tili } from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';
import { johdaViennit } from './johdaViennit.js';
import type { Summat, VientiRivi } from './types.js';

/**
 * Live sums + balance for the UI. Rows that map to real viennit are balanced over their
 * DERIVED viennit (so net-basis VAT entry, which adds VAT legs, still balances). Rows that
 * carry an amount but no account yet don't reach the generator; their raw debet/kredit is
 * added directly so the balance bar mirrors what the user has entered (unchanged behaviour).
 * Pure; integer cents only (never float).
 */
export function laskeSummat(
  rivit: readonly VientiRivi[],
  chart: readonly Tili[],
  pvm: IsoDate,
): Summat {
  const viennit = johdaViennit(rivit, chart, pvm);
  let debetYht = Euro.fromCents(0);
  let kreditYht = Euro.fromCents(0);
  for (const v of viennit) {
    debetYht = Euro.add(debetYht, v.debet);
    kreditYht = Euro.add(kreditYht, v.kredit);
  }
  // Account-less rows never reach johdaViennit; count their raw amounts so an in-progress
  // voucher's balance bar behaves as before (Tallenna stays blocked via a separate tili-check).
  for (const r of rivit) {
    if (r.tili === undefined) {
      debetYht = Euro.add(debetYht, r.debetSnt);
      kreditYht = Euro.add(kreditYht, r.kreditSnt);
    }
  }
  const erotus: Cents = Euro.sub(debetYht, kreditYht);
  return { debetYht, kreditYht, erotus, tasmaa: erotus === 0 };
}
