import type { OstolaskuRivi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { decodeOstolaskuRivi, encodeOstolaskuRivi } from './ostolasku.js';

const c = (n: number): Cents => n as Cents;

describe('ostolasku codec', () => {
  it('round-trips a list row with money as "N.NN"', () => {
    const r: OstolaskuRivi = {
      tosite: 5,
      pvm: '2026-03-01',
      erapvm: '2026-03-31',
      viite: '77',
      summa: c(12_550),
      avoin: c(12_550),
      era: 5,
      tili: 2870,
      tyyppi: 100,
      tunniste: 3,
      sarja: '',
      tila: 100,
      toimittaja: 'Oy',
    };
    const w = encodeOstolaskuRivi(r);
    expect(w.summa).toBe('125.50');
    expect(w.avoin).toBe('125.50');
    expect(decodeOstolaskuRivi(w)).toEqual(r);
  });
});
