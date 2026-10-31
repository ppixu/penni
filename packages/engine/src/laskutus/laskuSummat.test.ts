import { describe, expect, it } from 'vitest';
import { Maksutapa } from '../vouchers/enums.js';
import type { TositeRivi } from '../vouchers/types.js';
import { generoiLaskunViennit } from './generoiLaskunViennit.js';
import { laskuSummat } from './laskuSummat.js';

const TILIT = {
  saatava: 1701,
  kateinen: 1910,
  kortti: 1920,
  oletusMyynti: 3000,
  alvVelka: 2939,
  kohdentamatonAlvVelka: 0,
};

describe('laskuSummat', () => {
  it('monikantainen lasku: netto, alv-erittely kannoittain ja brutto (25,5 % + 14 % + veroton)', () => {
    const rivit: TositeRivi[] = [
      { myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 },
      { myyntiKpl: 2, aNetto: 50, alvKoodi: 11, alvProsentti: 14 },
      { myyntiKpl: 1, aNetto: 10, alvKoodi: 0, alvProsentti: 0 },
    ];
    const s = laskuSummat(rivit);
    expect(s.netto).toBe(21_000);
    expect(s.erittely).toEqual([
      { prosentti: 25.5, vero: 2_550 },
      { prosentti: 14, vero: 1_400 },
    ]);
    expect(s.vero).toBe(3_950);
    expect(s.brutto).toBe(24_950);
  });

  it('brutto täsmää moottorin kirjaamaan saatavavientiin (sama korikohtainen pyöristys)', () => {
    // Kaksi 1,10 € riviä à 14 %: rivikohtainen alv olisi 15 + 15 snt, mutta moottori
    // pyöristää verokantakorin kerran: round(220 × 14 / 100) = 31 snt (generoiLaskunViennit.ts:100).
    const rivit: TositeRivi[] = [
      { myyntiKpl: 1, aNetto: 1.1, alvKoodi: 11, alvProsentti: 14 },
      { myyntiKpl: 1, aNetto: 1.1, alvKoodi: 11, alvProsentti: 14 },
    ];
    const s = laskuSummat(rivit);
    expect(s.vero).toBe(31);
    expect(s.brutto).toBe(251);
    const viennit = generoiLaskunViennit({
      rivit,
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      tilit: TILIT,
    });
    expect(viennit.find((v) => v.debet > 0)?.debet).toBe(s.brutto);
  });

  it('nollaverokannan koodit eivät tuota alv-erittelyä', () => {
    const rivit: TositeRivi[] = [
      { myyntiKpl: 1, aNetto: 100, alvKoodi: 19, alvProsentti: 0 },
      { myyntiKpl: 1, aNetto: 100, alvKoodi: 14, alvProsentti: 0 },
    ];
    const s = laskuSummat(rivit);
    expect(s.erittely).toEqual([]);
    expect(s.vero).toBe(0);
    expect(s.brutto).toBe(20_000);
  });

  it('nollasummaiset rivit ohitetaan kuten moottorissa', () => {
    const s = laskuSummat([{ myyntiKpl: 0, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }]);
    expect(s.netto).toBe(0);
    expect(s.brutto).toBe(0);
  });
});
