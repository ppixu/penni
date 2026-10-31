import type { Jaksotuslaskelma } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { decodeJaksotuslaskelma, encodeJaksotuslaskelma } from './jaksotukset.js';

const c = (n: number): Cents => n as Cents;

const laskelma: Jaksotuslaskelma = {
  loppupvm: '2026-12-31',
  rivit: [
    {
      tili: 4000,
      maara: c(-30_400),
      selite: 'ML1 Vakuutus',
      jaksoalkaa: '2026-11-01',
      jaksoloppuu: '2027-10-31',
    },
    { tili: 3010, maara: c(6_100), selite: 'ML2 Vuokra' },
  ],
  joKirjattu: false,
};

describe('jaksotukset codec', () => {
  it('encodes signed money as "N.NN" and round-trips', () => {
    const w = encodeJaksotuslaskelma(laskelma);
    expect(w.rivit[0]?.maara).toBe('-304.00');
    expect(w.rivit[1]?.maara).toBe('61.00');
    expect(w.rivit[0]?.jaksoalkaa).toBe('2026-11-01');
    expect(w.rivit[1]?.jaksoalkaa).toBeUndefined();
    expect(decodeJaksotuslaskelma(w)).toEqual(laskelma);
  });
});
