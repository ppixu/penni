import { describe, expect, it } from 'vitest';
import {
  asetusPaalla,
  muodostaValidointiKonteksti,
  onkoAlvVelvollinen,
  onkoMaksuperusteinenAlv,
} from './context.js';

describe('onkoMaksuperusteinenAlv', () => {
  const base = { AlvVelvollinen: 'true', MaksuAlvAlkaa: '2026-01-01' };

  it('is false when not VAT-liable even if the window is open', () => {
    expect(onkoMaksuperusteinenAlv({ ...base, AlvVelvollinen: 'false' }, '2026-06-01')).toBe(false);
  });
  it('is false when MaksuAlvAlkaa is unset', () => {
    expect(onkoMaksuperusteinenAlv({ AlvVelvollinen: 'true' }, '2026-06-01')).toBe(false);
  });
  it('is false before the start date', () => {
    expect(onkoMaksuperusteinenAlv(base, '2025-12-31')).toBe(false);
  });
  it('is true on and after the start date with no end', () => {
    expect(onkoMaksuperusteinenAlv(base, '2026-01-01')).toBe(true);
    expect(onkoMaksuperusteinenAlv(base, '2026-06-01')).toBe(true);
  });
  it('is false on and after the end date (window is half-open [alkaa, loppuu))', () => {
    const suljettu = { ...base, MaksuAlvLoppuu: '2026-07-01' };
    expect(onkoMaksuperusteinenAlv(suljettu, '2026-06-30')).toBe(true);
    expect(onkoMaksuperusteinenAlv(suljettu, '2026-07-01')).toBe(false);
    expect(onkoMaksuperusteinenAlv(suljettu, '2026-08-01')).toBe(false);
  });
});

describe('asetusPaalla / Kitsas-tuonnin totuusarvot', () => {
  it("tunnistaa Pennin 'true'/'1' ja Kitsasin 'ON'; muut epätosia", () => {
    expect(asetusPaalla('true')).toBe(true);
    expect(asetusPaalla('1')).toBe(true);
    expect(asetusPaalla('ON')).toBe(true);
    for (const arvo of ['false', 'EI', '0', '', undefined]) expect(asetusPaalla(arvo)).toBe(false);
  });
  it("onkoAlvVelvollinen on tosi Kitsasista tuodulle kirjalle (AlvVelvollinen: 'ON')", () => {
    expect(onkoAlvVelvollinen({ AlvVelvollinen: 'ON' }, '2026-06-01')).toBe(true);
    expect(onkoAlvVelvollinen({ AlvVelvollinen: 'EI' }, '2026-06-01')).toBe(false);
  });
  it("onkoMaksuperusteinenAlv hyväksyy AlvVelvollinen: 'ON'", () => {
    const kitsas = { AlvVelvollinen: 'ON', MaksuAlvAlkaa: '2026-01-01' };
    expect(onkoMaksuperusteinenAlv(kitsas, '2026-06-01')).toBe(true);
  });
});

describe('muodostaValidointiKonteksti', () => {
  const kaudet = [
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ];

  it('spans every fiscal year and carries the lock date and chart', () => {
    const ctx = muodostaValidointiKonteksti([], kaudet, { TilitPaatetty: '2025-12-31' });
    expect(ctx.kausiAlkaa).toBe('2025-01-01');
    expect(ctx.kausiLoppuu).toBe('2026-12-31');
    expect(ctx.tilitPaatetty).toBe('2025-12-31');
    expect(ctx.chart).toEqual([]);
  });

  it('reads AlvIlmoitettu and AlvVelvollinen from the settings unless overridden', () => {
    const asetukset = { AlvIlmoitettu: '2026-03-31', AlvVelvollinen: 'true' };
    const ctx = muodostaValidointiKonteksti([], kaudet, asetukset);
    expect(ctx.onkoAlvIlmoitettu('2026-03-31')).toBe(true);
    expect(ctx.onkoAlvIlmoitettu('2026-04-01')).toBe(false);
    expect(ctx.onkoAlvVelvollinen('2026-04-01')).toBe(true);
    const ohitettu = muodostaValidointiKonteksti([], kaudet, asetukset, () => false);
    expect(ohitettu.onkoAlvIlmoitettu('2026-03-31')).toBe(false);
  });

  it('treats an empty book as having no open period', () => {
    const ctx = muodostaValidointiKonteksti([], [], {});
    expect(ctx.kausiAlkaa > ctx.kausiLoppuu).toBe(true);
    expect(ctx.tilitPaatetty).toBeNull();
  });
});
