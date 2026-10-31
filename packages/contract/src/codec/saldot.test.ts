import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { decodeSaldot, encodeSaldot } from './saldot.js';

const c = (n: number) => Euro.fromCents(n);

describe('encodeSaldot', () => {
  it('emits account->"N.NN" with numerically sorted keys', () => {
    const m = new Map([
      [3000, c(-50000)],
      [1900, c(150000)],
    ]);
    const w = encodeSaldot(m);
    expect(Object.keys(w)).toEqual(['1900', '3000']); // sorted numerically
    expect(w).toEqual({ '1900': '1500.00', '3000': '-500.00' });
  });
});

describe('decodeSaldot', () => {
  it('parses both string and number amounts (liberal)', () => {
    const m = decodeSaldot({ '1900': '1500.00', '3999': 3450.0 });
    expect(m.get(1900)).toBe(150000);
    expect(m.get(3999)).toBe(345000);
  });
});

describe('round-trip', () => {
  it('decode(encode(m)) preserves balances', () => {
    const m = new Map([
      [1900, c(6000)],
      [4000, c(-4000)],
    ]);
    expect(decodeSaldot(encodeSaldot(m))).toEqual(m);
  });
});
