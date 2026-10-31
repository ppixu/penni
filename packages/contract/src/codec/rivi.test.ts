import type { TositeRivi } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { decodeRivi, encodeRivi } from './rivi.js';

describe('encodeRivi', () => {
  it('renames to legacy keys; numbers stay raw (no money strings)', () => {
    const r: TositeRivi = {
      myyntiKpl: 2,
      aNetto: 80,
      alvKoodi: 1,
      alvProsentti: 25.5,
      unKoodi: 'C62',
      selite: 'Konsultointi',
    };
    expect(encodeRivi(r)).toEqual({
      myyntikpl: 2,
      ahinta: 80,
      alvkoodi: 1,
      alvprosentti: 25.5,
      unkoodi: 'C62',
      selite: 'Konsultointi',
    });
  });

  it('omits zero/absent optional fields', () => {
    const r: TositeRivi = { myyntiKpl: 1, aNetto: 10, alvKoodi: 0, alvProsentti: 0 };
    expect(encodeRivi(r)).toEqual({ myyntikpl: 1, ahinta: 10 });
  });
});

describe('round-trip', () => {
  it('decode(encode(r)) preserves a rivi', () => {
    const r: TositeRivi = {
      myyntiKpl: 3,
      aNetto: 49.9,
      alvKoodi: 1,
      alvProsentti: 14,
      aleProsentti: 10,
      euroAlennus: 5,
      unKoodi: 'KGM',
      selite: 'Tavara',
    };
    expect(decodeRivi(encodeRivi(r))).toEqual(r);
  });
});
