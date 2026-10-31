import type { Poistolaskelma } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  decodePoistolaskelma,
  decodePoistotSyote,
  encodePoistolaskelma,
  encodePoistotSyote,
} from './poistot.js';

const c = (n: number): Cents => n as Cents;

const laskelma: Poistolaskelma = {
  loppupvm: '2026-12-31',
  rivit: [{ tili: 1120, ennen: c(100_000), poisto: c(25_000), poistotili: 6820 }],
  yhteensa: c(25_000),
  joKirjattu: false,
};

describe('poistot codec', () => {
  it('encodes money as "N.NN" and round-trips the laskelma', () => {
    const w = encodePoistolaskelma(laskelma);
    expect(w.rivit[0]?.poisto).toBe('250.00');
    expect(w.yhteensa).toBe('250.00');
    expect(w.joKirjattu).toBe(false);
    expect(decodePoistolaskelma(w)).toEqual(laskelma);
  });

  it('round-trips the syöte', () => {
    const w = encodePoistotSyote({ loppupvm: '2026-12-31' });
    expect(w).toEqual({ loppupvm: '2026-12-31' });
    expect(decodePoistotSyote(w)).toEqual({ loppupvm: '2026-12-31' });
  });
});
