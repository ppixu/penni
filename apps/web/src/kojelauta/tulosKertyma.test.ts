import { describe, expect, it } from 'vitest';
import { kertymanLoppu, kuukaudenLyhenne, kuukaudenNimi, palkkienPaikat } from './tulosKertyma';

describe('tulosKertyma', () => {
  it('kertymä tähän päivään kaudella, muuten kauden loppuun', () => {
    expect(kertymanLoppu('2026-01-01', '2026-12-31', '2026-07-23')).toBe('2026-07-23');
    expect(kertymanLoppu('2025-01-01', '2025-12-31', '2026-07-23')).toBe('2025-12-31');
    expect(kertymanLoppu('2027-01-01', '2027-12-31', '2026-07-23')).toBe('2027-12-31');
  });

  it('kuukauden lyhenne ja nimi', () => {
    expect(kuukaudenLyhenne('2026-07-23')).toBe('Hei');
    expect(kuukaudenNimi('2026-12-31')).toBe('Joulukuu 2026');
  });

  it('positiiviset palkit kasvavat nollaviivalta ylös, suurin täyttää korkeuden', () => {
    const { nolla, palkit } = palkkienPaikat([100, 400]);
    expect(nolla).toBe(1);
    expect(palkit).toEqual([
      { ylhaalla: 0.75, korkeus: 0.25 },
      { ylhaalla: 0, korkeus: 1 },
    ]);
  });

  it('negatiivinen kertymä roikkuu nollaviivalta alas', () => {
    const { nolla, palkit } = palkkienPaikat([-100, 300]);
    expect(nolla).toBe(0.75);
    expect(palkit[0]).toEqual({ ylhaalla: 0.75, korkeus: 0.25 });
    expect(palkit[1]).toEqual({ ylhaalla: 0, korkeus: 0.75 });
  });

  it('pelkät nollat eivät jaa nollalla', () => {
    expect(palkkienPaikat([0, 0]).palkit).toEqual([
      { ylhaalla: 0, korkeus: 0 },
      { ylhaalla: 0, korkeus: 0 },
    ]);
  });
});
