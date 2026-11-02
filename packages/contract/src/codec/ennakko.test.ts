import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { decodeAvoinEnnakko, encodeAvoinEnnakko } from './ennakko.js';

describe('avoin ennakko -codec', () => {
  it('rahat "N.NN"-muodossa ja round-trip säilyttää kentät', () => {
    const e = {
      tosite: 4,
      numero: '12',
      alvProsentti: 25.5,
      netto: Euro.fromCents(100000),
      avoin: Euro.fromCents(60000),
    };
    const w = encodeAvoinEnnakko(e);
    expect(w).toEqual({
      tosite: 4,
      numero: '12',
      alvProsentti: 25.5,
      netto: '1000.00',
      avoin: '600.00',
    });
    expect(decodeAvoinEnnakko(w)).toEqual(e);
  });

  it('puuttuva numero jää pois', () => {
    const w = encodeAvoinEnnakko({
      tosite: 1,
      alvProsentti: 14,
      netto: Euro.fromCents(100),
      avoin: Euro.fromCents(100),
    });
    expect('numero' in w).toBe(false);
    expect('numero' in decodeAvoinEnnakko(w)).toBe(false);
  });
});
