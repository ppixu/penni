import type { TilinavausSyote } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { WireTilinavausSyoteSchema } from '../schema/wire.js';
import { decodeTilinavausSyote, encodeTilinavausSyote } from './tilinavaus.js';

const c = (n: number): Cents => n as Cents;

describe('tilinavaus-koodekit', () => {
  const syote: TilinavausSyote = {
    pvm: '2026-01-01',
    saldot: [
      { tili: 1900, saldo: c(15000) },
      { tili: 2251, saldo: c(-500) },
    ],
  };

  it('enkoodaa saldot "N.NN"-muotoon', () => {
    const w = encodeTilinavausSyote(syote);
    expect(w.pvm).toBe('2026-01-01');
    expect(w.saldot).toEqual([
      { tili: 1900, saldo: '150.00' },
      { tili: 2251, saldo: '-5.00' },
    ]);
    expect(WireTilinavausSyoteSchema.parse(w)).toBeTruthy();
  });

  it('kiertää sentit tappiotta molempiin suuntiin', () => {
    const takaisin = decodeTilinavausSyote(encodeTilinavausSyote(syote));
    expect(takaisin).toEqual(syote);
  });

  it('dekoodaa myös raa"an numeron (Raha-union)', () => {
    const takaisin = decodeTilinavausSyote({
      pvm: '2026-01-01',
      saldot: [{ tili: 1900, saldo: 150 }],
    });
    expect(takaisin.saldot[0]?.saldo).toBe(15000);
  });
});
