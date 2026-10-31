import { describe, expect, it } from 'vitest';
import {
  kirjanpidonAlkaa,
  kirjanpidonLoppuu,
  pitaakoNumeroUusiksi,
  tilikausiPaivalle,
  valitseSarja,
} from './numbering.js';
import type { Tilikausi } from './storage.js';

const kaudet: Tilikausi[] = [
  { alkaa: '2025-01-01', loppuu: '2025-12-31' },
  { alkaa: '2026-01-01', loppuu: '2026-12-31' },
];

describe('tilikausiPaivalle', () => {
  it('finds the fiscal year covering a date', () => {
    expect(tilikausiPaivalle(kaudet, '2026-06-01')?.alkaa).toBe('2026-01-01');
    expect(tilikausiPaivalle(kaudet, '2025-12-31')?.alkaa).toBe('2025-01-01');
    expect(tilikausiPaivalle(kaudet, '2027-01-01')).toBeUndefined();
  });
});

describe('kirjanpidon span', () => {
  it('spans earliest start to latest end', () => {
    expect(kirjanpidonAlkaa(kaudet)).toBe('2025-01-01');
    expect(kirjanpidonLoppuu(kaudet)).toBe('2026-12-31');
  });
  it('is null for an empty book', () => {
    expect(kirjanpidonAlkaa([])).toBeNull();
    expect(kirjanpidonLoppuu([])).toBeNull();
  });
});

describe('valitseSarja', () => {
  const sarjat = { '*': 'JT', '100': 'OL', K: 'K' };
  it('empty when not using per-type series', () => {
    expect(valitseSarja({ tyyppi: 100, eriSarjaan: false, sarjat })).toBe('');
  });
  it('per-type series when configured', () => {
    expect(valitseSarja({ tyyppi: 100, eriSarjaan: true, sarjat })).toBe('OL');
    expect(valitseSarja({ tyyppi: 200, eriSarjaan: true, sarjat })).toBe('X'); // unconfigured -> 'X'
  });
  it('system vouchers (>=1000) use the "*" series, default JT', () => {
    expect(valitseSarja({ tyyppi: 9100, eriSarjaan: true, sarjat })).toBe('JT');
    expect(valitseSarja({ tyyppi: 9100, eriSarjaan: true, sarjat: {} })).toBe('JT');
  });
  it('cash vouchers use the K series when kateisSarjaan', () => {
    expect(
      valitseSarja({ tyyppi: 100, eriSarjaan: false, kateinen: true, kateisSarjaan: true, sarjat }),
    ).toBe('K');
  });
});

describe('pitaakoNumeroUusiksi', () => {
  it('true when the fiscal year changed', () => {
    expect(
      pitaakoNumeroUusiksi({
        vanhaPvm: '2025-06-01',
        vanhaSarja: '',
        uusiPvm: '2026-06-01',
        uusiSarja: '',
        kaudet,
      }),
    ).toBe(true);
  });
  it('true when the series changed', () => {
    expect(
      pitaakoNumeroUusiksi({
        vanhaPvm: '2026-06-01',
        vanhaSarja: '',
        uusiPvm: '2026-07-01',
        uusiSarja: 'OL',
        kaudet,
      }),
    ).toBe(true);
  });
  it('false when same year and series', () => {
    expect(
      pitaakoNumeroUusiksi({
        vanhaPvm: '2026-03-01',
        vanhaSarja: 'OL',
        uusiPvm: '2026-09-01',
        uusiSarja: 'OL',
        kaudet,
      }),
    ).toBe(false);
  });
});
