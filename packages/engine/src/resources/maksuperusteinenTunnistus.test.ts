import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import type { Tili } from '../accounts/tili.js';
import type { TositeVienti } from '../vouchers/types.js';
import { tunnistaVeroVienti } from './maksuperusteinenTunnistus.js';

const alvVelka = { numero: 2939 } as Tili;
const alvSaatava = { numero: 1763 } as Tili;
const deferSale = (v: number): TositeVienti => ({
  tili: 2949,
  debet: Euro.fromCents(0),
  kredit: Euro.fromCents(v),
  pvm: '2026-06-01',
  alvKoodi: 418,
  alvProsentti: 25.5,
});
const deferBuy = (v: number): TositeVienti => ({
  tili: 1764,
  debet: Euro.fromCents(v),
  kredit: Euro.fromCents(0),
  pvm: '2026-06-01',
  alvKoodi: 428,
  alvProsentti: 25.5,
});

describe('tunnistaVeroVienti', () => {
  it('recognizes full sale VAT (holding debit + real ALVVELKA credit, code 118)', () => {
    const pair = tunnistaVeroVienti(
      deferSale(2550),
      12550,
      0,
      12550,
      alvVelka,
      alvSaatava,
      '2026-06-30',
    );
    expect(pair).toHaveLength(2);
    expect(pair.find((v) => v.tili === 2949)?.debet).toBe(2550);
    const real = pair.find((v) => v.tili === 2939);
    expect(real?.kredit).toBe(2550);
    expect(real?.alvKoodi).toBe(118);
    expect(real?.maksuperusteinenTosite).toBeUndefined(); // no linkTo -> unlinked
  });
  it('recognizes only the increment between maksettuEnnen and maksettuJalkeen (drift-free)', () => {
    const pair = tunnistaVeroVienti(
      deferSale(2550),
      12550,
      5000,
      12550,
      alvVelka,
      alvSaatava,
      '2026-06-30',
    );
    // round(2550*12550/12550) - round(2550*5000/12550) = 2550 - 1016 = 1534
    expect(pair.find((v) => v.tili === 2939)?.kredit).toBe(1534);
  });
  it('returns [] when the recognized share is 0', () => {
    expect(
      tunnistaVeroVienti(deferSale(2550), 12550, 12550, 12550, alvVelka, alvSaatava, '2026-06-30'),
    ).toEqual([]);
  });
  it('purchase side: holding credit + real ALVSAATAVA debit, code 228', () => {
    const pair = tunnistaVeroVienti(
      deferBuy(2550),
      12550,
      0,
      12550,
      alvVelka,
      alvSaatava,
      '2026-06-30',
    );
    expect(pair.find((v) => v.tili === 1764)?.kredit).toBe(2550);
    const real = pair.find((v) => v.tili === 1763);
    expect(real?.debet).toBe(2550);
    expect(real?.alvKoodi).toBe(228);
  });
  it('sets maksuperusteinenTosite on the real-VAT leg when linkTo is given', () => {
    const pair = tunnistaVeroVienti(
      deferSale(2550),
      12550,
      0,
      12550,
      alvVelka,
      alvSaatava,
      '2026-06-30',
      'Vanhennus',
      77,
    );
    expect(pair.find((v) => v.tili === 2939)?.maksuperusteinenTosite).toBe(77);
    expect(pair.find((v) => v.tili === 2949)?.maksuperusteinenTosite).toBeUndefined(); // only the real leg is linked
  });
});
