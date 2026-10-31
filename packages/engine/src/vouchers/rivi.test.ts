import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  bruttoYhteensa,
  nettoYhteensaCents,
  withBruttoYhteensa,
  withNettoYhteensa,
} from './rivi.js';
import type { TositeRivi } from './types.js';

function rivi(p: Partial<TositeRivi>): TositeRivi {
  return { myyntiKpl: 1, aNetto: 0, alvKoodi: 0, alvProsentti: 0, ...p };
}

describe('porting tositerivitesti (verbatim cases)', () => {
  it('nettosumma1: aNetto 10 x 5 -> net 5000 c', () => {
    expect(nettoYhteensaCents(rivi({ aNetto: 10, myyntiKpl: 5 }))).toBe(5000);
  });
  it('summa1: aNetto 10 x 5, no VAT -> gross 5000 c', () => {
    expect(bruttoYhteensa(rivi({ aNetto: 10, myyntiKpl: 5 }))).toBe(5000);
  });
  it('summa2: aNetto 10 x 10 @24% -> gross 12400 c', () => {
    expect(
      bruttoYhteensa(rivi({ aNetto: 10, myyntiKpl: 10, alvKoodi: 11, alvProsentti: 24 })),
    ).toBe(12400);
  });
  it('summa3: aNetto 100 x 10, -25% -> gross 75000 c', () => {
    expect(bruttoYhteensa(rivi({ aNetto: 100, myyntiKpl: 10, aleProsentti: 25 }))).toBe(75000);
  });
  it('summa4: aNetto 50 x 10, -50.00 euro -> gross 45000 c', () => {
    expect(bruttoYhteensa(rivi({ aNetto: 50, myyntiKpl: 10, euroAlennus: 50 }))).toBe(45000);
  });
  it('hyvitys1: aNetto 100 x -1 -> gross -10000 c', () => {
    expect(bruttoYhteensa(rivi({ aNetto: 100, myyntiKpl: -1 }))).toBe(-10000);
  });
  it('ahintanetto1: kpl 5, set net total 100.00 -> aNetto 20.00', () => {
    const r = withNettoYhteensa(rivi({ myyntiKpl: 5 }), 100);
    expect(Math.round(r.aNetto * 100)).toBe(2000);
  });
  it('ahinta1: @24% kpl 2, set gross total 124.00 -> aNetto 50.00', () => {
    const r = withBruttoYhteensa(
      rivi({ alvKoodi: 11, alvProsentti: 24, myyntiKpl: 2 }),
      Euro.fromCents(12400),
    );
    expect(Math.round(r.aNetto * 100)).toBe(5000);
  });
});

describe('margin scheme + sign flip', () => {
  it('alvKoodi >= KAYTETYT (91) adds no VAT', () => {
    expect(
      bruttoYhteensa(rivi({ aNetto: 100, myyntiKpl: 1, alvKoodi: 91, alvProsentti: 24 })),
    ).toBe(10000);
  });
  it('withNettoYhteensa flips quantity sign when the back-solved unit price is negative', () => {
    const r = withNettoYhteensa(rivi({ myyntiKpl: 5 }), -100);
    expect(r.myyntiKpl).toBe(-5);
    expect(r.aNetto).toBe(20); // unit price kept positive
  });
  it('margin-scheme ledger codes (13/23) add no VAT to the gross line total', () => {
    const rivi = { myyntiKpl: 1, aNetto: 100, alvKoodi: 13, alvProsentti: 25.5 };
    expect(bruttoYhteensa(rivi)).toBe(nettoYhteensaCents(rivi)); // gross == net (no VAT added)
  });
});
