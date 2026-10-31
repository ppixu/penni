import { describe, expect, it } from 'vitest';
import { onkoTekstia } from './tekstinLuku.js';

describe('onkoTekstia', () => {
  it('tosi kun tekstiä on merkittävästi', () => {
    expect(onkoTekstia('Patreon Oy\nBrutto 12,44 EUR\nALV 25,5 %')).toBe(true);
  });
  it('epätosi tyhjälle tai lähes tyhjälle (skannattu = ei tekstikerrosta)', () => {
    expect(onkoTekstia('')).toBe(false);
    expect(onkoTekstia('  \n \f ')).toBe(false);
    expect(onkoTekstia('x')).toBe(false);
  });
});
