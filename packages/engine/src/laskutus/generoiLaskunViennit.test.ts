import { type Cents, Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { AlvKoodi, alvKoodilla } from '../alv/koodit.js';
import { Maksutapa, VientiTyyppi } from '../vouchers/enums.js';
import type { TositeRivi } from '../vouchers/types.js';
import { generoiLaskunViennit } from './generoiLaskunViennit.js';

const TILIT = {
  saatava: 1701,
  kateinen: 1910,
  kortti: 1911,
  oletusMyynti: 3000,
  alvVelka: 2939,
  kohdentamatonAlvVelka: 2949,
};
const netto = (
  aNetto: number,
  alvProsentti = 25.5,
  alvKoodi = AlvKoodi.MYYNNIT_NETTO,
): TositeRivi => ({
  myyntiKpl: 1,
  aNetto,
  alvKoodi,
  alvProsentti,
});
const summa = (viennit: { debet: Cents; kredit: Cents }[], f: 'debet' | 'kredit') =>
  viennit.reduce((a, v) => a + v[f], 0);

describe('generoiLaskunViennit', () => {
  it('LASKU: does not assign an erä (the resource layer owns erä assignment)', () => {
    const v = generoiLaskunViennit({
      rivit: [netto(100)],
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      tilit: TILIT,
    });
    const ar = v.find((x) => x.tili === 1701);
    const tulo = v.find((x) => x.tili === 3000);
    const alv = v.find((x) => x.tili === 2939);
    expect(ar?.debet).toBe(12550);
    expect(ar?.era).toBeUndefined();
    expect(ar?.tyyppi).toBe(VientiTyyppi.MYYNTI + VientiTyyppi.VASTAKIRJAUS);
    expect(tulo?.kredit).toBe(10000);
    expect(tulo?.tyyppi).toBe(VientiTyyppi.MYYNTI + VientiTyyppi.KIRJAUS);
    expect(alv?.kredit).toBe(2550);
    expect(alv?.alvKoodi).toBe(alvKoodilla(AlvKoodi.MYYNNIT_NETTO, AlvKoodi.ALVKIRJAUS));
    expect(alv?.tyyppi).toBe(VientiTyyppi.MYYNTI + VientiTyyppi.ALVKIRJAUS);
    expect(summa(v, 'debet')).toBe(summa(v, 'kredit'));
    expect(v[0]?.tili).toBe(1701); // receivable leg emitted first
  });

  it('aggregates same account+code+rate rows into one revenue leg', () => {
    const v = generoiLaskunViennit({
      rivit: [netto(100), netto(50)],
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      tilit: TILIT,
    });
    const tulot = v.filter((x) => x.tili === 3000);
    expect(tulot).toHaveLength(1);
    expect(tulot[0]?.kredit).toBe(15000);
  });

  it('splits distinct rates into separate VAT legs', () => {
    const v = generoiLaskunViennit({
      rivit: [netto(100, 25.5), netto(100, 14)],
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      tilit: TILIT,
    });
    const alvit = v.filter((x) => x.tili === 2939);
    expect(alvit).toHaveLength(2);
    expect(alvit.map((x) => x.kredit).sort((a, b) => a - b)).toEqual([1400, 2550]);
    expect(summa(v, 'debet')).toBe(summa(v, 'kredit'));
  });

  it('splits explicit per-row tili into separate revenue legs', () => {
    const rivit: TositeRivi[] = [
      { ...netto(100), tili: 3000 },
      { ...netto(100), tili: 3001 },
    ];
    const v = generoiLaskunViennit({
      rivit,
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      tilit: TILIT,
    });
    expect(v.find((x) => x.tili === 3000)?.kredit).toBe(10000);
    expect(v.find((x) => x.tili === 3001)?.kredit).toBe(10000);
  });

  it('emits NO VAT leg for a zero-rated code (gross = net)', () => {
    const v = generoiLaskunViennit({
      rivit: [
        { myyntiKpl: 1, aNetto: 100, alvKoodi: AlvKoodi.RAKENNUSPALVELU_MYYNTI, alvProsentti: 0 },
      ],
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      tilit: TILIT,
    });
    expect(v.some((x) => x.tili === 2939)).toBe(false);
    expect(v.find((x) => x.tili === 1701)?.debet).toBe(10000);
  });

  it('KATEINEN debits the cash account with no era; KORTTIMAKSU the card account', () => {
    const kate = generoiLaskunViennit({
      rivit: [netto(100)],
      maksutapa: Maksutapa.KATEINEN,
      pvm: '2026-06-01',
      tilit: TILIT,
    });
    expect(kate.find((x) => x.debet > 0)?.tili).toBe(1910);
    expect(kate.find((x) => x.debet > 0)?.era).toBeUndefined();
    const kortti = generoiLaskunViennit({
      rivit: [netto(100)],
      maksutapa: Maksutapa.KORTTIMAKSU,
      pvm: '2026-06-01',
      tilit: TILIT,
    });
    expect(kortti.find((x) => x.debet > 0)?.tili).toBe(1911);
  });

  it('keeps the ledger balanced on a rounding-edge invoice (3 × 3.33 € net)', () => {
    const v = generoiLaskunViennit({
      rivit: [netto(3.33), netto(3.33), netto(3.33)],
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      tilit: TILIT,
    });
    expect(summa(v, 'debet')).toBe(summa(v, 'kredit'));
  });
});

describe('generoiLaskunViennit maksuperusteinen', () => {
  it('routes the VAT leg to the holding account with code 418 and revenue code 18', () => {
    const viennit = generoiLaskunViennit({
      rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: AlvKoodi.MYYNNIT_NETTO, alvProsentti: 25.5 }],
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      maksuperusteinen: true,
      tilit: {
        saatava: 1701,
        kateinen: 1910,
        kortti: 1912,
        oletusMyynti: 3000,
        alvVelka: 2939,
        kohdentamatonAlvVelka: 2949,
      },
    });
    const revenue = viennit.find((v) => v.tili === 3000);
    expect(revenue?.alvKoodi).toBe(AlvKoodi.MAKSUPERUSTEINEN_MYYNTI); // 18
    const vat = viennit.find((v) => v.tili === 2949); // holding KOHDENTAMATONALVVELKA
    expect(vat?.kredit).toBe(Euro.fromCents(2_550));
    expect(vat?.alvKoodi).toBe(418);
    expect(vat?.era).toBeUndefined();
    expect(viennit.some((v) => v.tili === 2939)).toBe(false); // real ALVVELKA unused
    // still balanced
    expect(viennit.reduce((a, v) => a + v.debet, 0)).toBe(
      viennit.reduce((a, v) => a + v.kredit, 0),
    );
  });

  it('accrual (default) still posts VAT to the real ALVVELKA with code 111', () => {
    const viennit = generoiLaskunViennit({
      rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: AlvKoodi.MYYNNIT_NETTO, alvProsentti: 25.5 }],
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      tilit: {
        saatava: 1701,
        kateinen: 1910,
        kortti: 1912,
        oletusMyynti: 3000,
        alvVelka: 2939,
        kohdentamatonAlvVelka: 2949,
      },
    });
    expect(viennit.find((v) => v.tili === 2939)?.alvKoodi).toBe(111);
    expect(viennit.some((v) => v.tili === 2949)).toBe(false);
  });
});

describe('generoiLaskunViennit marginaaliverotus', () => {
  it('margin sale (code 13) books the full revenue with no VAT leg', () => {
    const viennit = generoiLaskunViennit({
      rivit: [
        { myyntiKpl: 1, aNetto: 100, alvKoodi: AlvKoodi.MYYNNIT_MARGINAALI, alvProsentti: 25.5 },
      ],
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      tilit: {
        saatava: 1701,
        kateinen: 1910,
        kortti: 1912,
        oletusMyynti: 3000,
        alvVelka: 2939,
        kohdentamatonAlvVelka: 2949,
      },
    });
    const revenue = viennit.find((v) => v.tili === 3000);
    expect(revenue?.kredit).toBe(Euro.fromCents(10_000));
    expect(revenue?.alvKoodi).toBe(13);
    // no VAT leg, AR == revenue (full margin amount)
    expect(viennit.filter((v) => v.debet > 0 || v.kredit > 0)).toHaveLength(2); // AR + revenue only
    expect(viennit.find((v) => v.debet > 0)?.debet).toBe(Euro.fromCents(10_000));
  });
});
