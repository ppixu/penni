import type { AlvLaskelmaTulos } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { WireAlvLaskelmaSchema, WireAlvTilitysSyoteSchema } from '../schema/wire.js';
import {
  decodeAlvLaskelma,
  decodeAlvTilitysSyote,
  encodeAlvLaskelma,
  encodeAlvTilitysSyote,
} from './alv.js';

const c = (n: number): Cents => n as Cents;

describe('alv-koodekit', () => {
  const tulos: AlvLaskelmaTulos = {
    alkupvm: '2026-06-01',
    loppupvm: '2026-06-30',
    koodit: new Map([
      [301, c(2550)],
      [307, c(2550)],
      [308, c(0)],
    ]),
    maksettava: c(0),
  };

  it('enkoodaa rahat "N.NN"-muotoon ja lajittelee koodit numerojärjestykseen', () => {
    const w = encodeAlvLaskelma(tulos);
    expect(w.koodit).toEqual({ '301': '25.50', '307': '25.50', '308': '0.00' });
    expect(Object.keys(w.koodit)).toEqual(['301', '307', '308']);
    expect(w.maksettava).toBe('0.00');
    expect(WireAlvLaskelmaSchema.parse(w)).toBeTruthy();
  });

  it('kiertää nollan tappiotta (enkoodaa aina, "0.00" -> 0)', () => {
    const takaisin = decodeAlvLaskelma(encodeAlvLaskelma(tulos));
    expect(takaisin.maksettava).toBe(0);
    expect(takaisin.koodit.get(301)).toBe(2550);
    expect(takaisin.koodit.get(308)).toBe(0);
    expect(takaisin.alkupvm).toBe('2026-06-01');
  });

  it('dekoodaa myös raa"at numerot (Raha-union)', () => {
    const takaisin = decodeAlvLaskelma({
      alkupvm: '2026-06-01',
      loppupvm: '2026-06-30',
      koodit: { '301': 25.5 },
      maksettava: 25.5,
    });
    expect(takaisin.koodit.get(301)).toBe(2550);
    expect(takaisin.maksettava).toBe(2550);
  });

  it('tilityssyöte kiertää sellaisenaan', () => {
    const syote = { alkupvm: '2026-06-01', loppupvm: '2026-06-30' };
    const w = encodeAlvTilitysSyote(syote);
    expect(WireAlvTilitysSyoteSchema.parse(w)).toEqual(w);
    expect(decodeAlvTilitysSyote(w)).toEqual(syote);
  });
});
