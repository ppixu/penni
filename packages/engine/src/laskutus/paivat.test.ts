import { describe, expect, it } from 'vitest';
import {
  lisaaPaivia,
  oikaiseErapaiva,
  paiviaVuodessa,
  paivienEro,
  siirraKuukausia,
} from './paivat.js';

describe('oikaiseErapaiva', () => {
  it.each([
    ['2026-12-24', '2026-12-28'],
    ['2026-05-01', '2026-05-04'],
    ['2026-01-06', '2026-01-07'],
    ['2026-06-10', '2026-06-10'],
    ['2026-06-13', '2026-06-15'], // lauantai
    ['2026-12-06', '2026-12-07'], // itsenäisyyspäivä (sunnuntai)
  ])('%s -> %s', (sisaan, ulos) => {
    expect(oikaiseErapaiva(sisaan)).toBe(ulos);
  });
});

describe('siirraKuukausia', () => {
  it.each([
    ['2026-11-30', 1, '2026-12-31'],
    ['2027-02-28', 1, '2027-03-31'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2026-01-15', 1, '2026-02-15'],
    ['2026-10-31', 3, '2027-01-31'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2028-01-30', 1, '2028-02-29'],
  ])('%s %i kk -> %s', (pvm, kk, odotus) => {
    expect(siirraKuukausia(pvm, kk)).toBe(odotus);
  });
});

describe('lisaaPaivia / paivienEro', () => {
  it('siirtää yli kuun ja vuoden rajan', () => {
    expect(lisaaPaivia('2026-12-31', 1)).toBe('2027-01-01');
    expect(lisaaPaivia('2028-02-28', 2)).toBe('2028-03-01');
    expect(lisaaPaivia('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('laskee päiväeron', () => {
    expect(paivienEro('2026-05-01', '2026-05-30')).toBe(29);
    expect(paivienEro('2026-05-30', '2026-05-01')).toBe(-29);
  });
});

describe('paiviaVuodessa', () => {
  it('käyttää annetun päivän vuotta', () => {
    expect(paiviaVuodessa('2026-05-01')).toBe(365);
    expect(paiviaVuodessa('2028-02-01')).toBe(366);
    expect(paiviaVuodessa('2100-01-01')).toBe(365);
    expect(paiviaVuodessa('2000-01-01')).toBe(366);
  });
});
