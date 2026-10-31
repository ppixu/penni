import { describe, expect, it } from 'vitest';
import { decodeKumppani, encodeKumppani } from './kumppani.js';

describe('kumppani codec', () => {
  it('round-trips, coercing id to number and preserving extra keys', () => {
    const wire = {
      id: '7',
      nimi: 'Asiakas Oy',
      alvtunnus: 'FI12345678',
      iban: ['FI21'],
      maa: 'fi',
    };
    const k = decodeKumppani(wire);
    expect(k.id).toBe(7);
    expect(k.nimi).toBe('Asiakas Oy');
    expect(k.iban).toEqual(['FI21']);
    expect(encodeKumppani(k)).toMatchObject({ id: 7, nimi: 'Asiakas Oy', alvtunnus: 'FI12345678' });
  });
});
