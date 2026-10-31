import type { Verolaskelma } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  decodeTuloveroSyote,
  decodeVerolaskelma,
  encodeTuloveroSyote,
  encodeVerolaskelma,
} from './tulovero.js';

const c = (n: number): Cents => n as Cents;

const laskelma: Verolaskelma = {
  alkupvm: '2026-01-01',
  loppupvm: '2026-12-31',
  tulo: c(100_000),
  taysivahennys: c(30_000),
  puolivahennys: c(10_000),
  vahennys: c(35_000),
  ennakko: c(4_000),
  tulos: c(65_000),
  aiempiTappio: c(5_000),
  loppuTulos: c(60_000),
  vero: c(12_000),
  jaaveroa: c(8_000),
  joKirjattu: false,
};

describe('tulovero codec', () => {
  it('encodes money as "N.NN" and round-trips the laskelma', () => {
    const w = encodeVerolaskelma(laskelma);
    expect(w.jaaveroa).toBe('80.00');
    expect(w.tulo).toBe('1000.00');
    expect(w.joKirjattu).toBe(false);
    expect(decodeVerolaskelma(w)).toEqual(laskelma);
  });

  it('round-trips the syöte, emitting only present optionals', () => {
    const w = encodeTuloveroSyote({
      alkupvm: '2026-01-01',
      loppupvm: '2026-12-31',
      aiempiTappio: c(5_000),
    });
    expect(w.aiempiTappio).toBe('50.00');
    expect(w.tulo).toBeUndefined();
    expect(decodeTuloveroSyote(w)).toEqual({
      alkupvm: '2026-01-01',
      loppupvm: '2026-12-31',
      aiempiTappio: c(5_000),
    });
  });
});
