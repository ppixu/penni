import { type Cents, roundHalfAway } from '@penni/euro';
import { AlvKoodi } from '../alv/koodit.js';
import { KAYTETYT } from './enums.js';
import type { TositeRivi } from './types.js';

const ale = (r: TositeRivi): number => r.aleProsentti ?? 0;
const euroAle = (r: TositeRivi): number => r.euroAlennus ?? 0;

/** Whether a row's code adds VAT to its total: below the KAYTETYT sub-flavor threshold AND not a margin ledger code. */
function lisaakoAlvia(alvKoodi: number): boolean {
  return (
    alvKoodi < KAYTETYT &&
    alvKoodi !== AlvKoodi.MYYNNIT_MARGINAALI &&
    alvKoodi !== AlvKoodi.OSTOT_MARGINAALI
  );
}

/** Net line total in euros, unrounded (mirrors TositeRivi::nettoYhteensa, cpp:159-168). */
function nettoYhteensaEur(r: TositeRivi): number {
  const netto = r.aNetto * r.myyntiKpl;
  return ale(r) ? ((100 - ale(r)) * netto) / 100 : netto - euroAle(r);
}

/** Net line total rounded to cents (the public net-total API). */
export function nettoYhteensaCents(r: TositeRivi): Cents {
  return roundHalfAway(nettoYhteensaEur(r) * 100) as Cents;
}

/** Gross line total in cents — the single rounding point (TositeRivi::bruttoYhteensa, cpp:113-122). */
export function bruttoYhteensa(r: TositeRivi): Cents {
  const alennettu = nettoYhteensaEur(r);
  const veroSnt = lisaakoAlvia(r.alvKoodi) ? r.alvProsentti * alennettu : 0;
  return roundHalfAway(alennettu * 100 + veroSnt) as Cents;
}

/** Back-solve the net unit price from a net line total (TositeRivi::setNettoYhteensa, cpp:135-157). */
export function withNettoYhteensa(r: TositeRivi, nettoEur: number): TositeRivi {
  const alentamaton = ale(r) ? (100 * nettoEur) / (100 - ale(r)) : nettoEur + euroAle(r);
  const ahinta = alentamaton / r.myyntiKpl;
  if (ahinta < 0) {
    // The unit price must stay positive: flip the quantity sign instead.
    return { ...r, myyntiKpl: -r.myyntiKpl, aNetto: -ahinta };
  }
  return { ...r, aNetto: ahinta };
}

/** Back-solve the net unit price from a gross line total (TositeRivi::setBruttoYhteensa, cpp:124-133). */
export function withBruttoYhteensa(r: TositeRivi, bruttoCents: Cents): TositeRivi {
  const brutto = bruttoCents / 100;
  const netto = lisaakoAlvia(r.alvKoodi) ? (100 * brutto) / (100 + r.alvProsentti) : brutto;
  return withNettoYhteensa(r, netto);
}
