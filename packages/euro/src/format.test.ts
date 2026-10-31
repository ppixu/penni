import { describe, expect, it } from 'vitest';
import { Euro } from './euro.js';
import { muotoileEuro, muotoilePvm } from './format.js';

const NBSP = ' ';
const MINUS = '−';

describe('muotoileEuro', () => {
  it.each([
    [Euro.fromCents(0), `0,00${NBSP}€`],
    [Euro.fromCents(5), `0,05${NBSP}€`],
    [Euro.fromCents(8640), `86,40${NBSP}€`],
    [Euro.fromCents(123_456), `1${NBSP}234,56${NBSP}€`],
    [Euro.fromCents(-123_456), `${MINUS}1${NBSP}234,56${NBSP}€`],
    [Euro.fromCents(100_000_000), `1${NBSP}000${NBSP}000,00${NBSP}€`],
  ])('muotoilee %d sentistä oikein', (c, expected) => {
    expect(muotoileEuro(c)).toBe(expected);
  });
});

describe('muotoilePvm', () => {
  it.each([
    ['2026-01-09', '9.1.2026'],
    ['2026-12-31', '31.12.2026'],
    ['2026-06-26', '26.6.2026'],
  ])('muotoilee ISO-päivän %s', (iso, expected) => {
    expect(muotoilePvm(iso)).toBe(expected);
  });

  it('palauttaa tyhjälle merkkijonon sellaisenaan', () => {
    expect(muotoilePvm('')).toBe('');
  });
});
