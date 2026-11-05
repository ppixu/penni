import { describe, expect, it } from 'vitest';
import {
  MAKSUAIKA_RAJAT,
  PERUSKORKO_RAJAT,
  jasennaAsetusluku,
  lueMaksuaika,
  luePeruskorko,
} from './laskuasetukset.js';

describe('laskutuksen lukuasetukset', () => {
  it('jasennaAsetusluku: vain tavallinen desimaaliluku pilkulla tai pisteellä rajojen sisällä', () => {
    expect(jasennaAsetusluku('2,5', PERUSKORKO_RAJAT)).toBe(2.5);
    expect(jasennaAsetusluku(' 4.25 ', PERUSKORKO_RAJAT)).toBe(4.25);
    expect(jasennaAsetusluku('0', PERUSKORKO_RAJAT)).toBe(0);
    expect(jasennaAsetusluku('100', PERUSKORKO_RAJAT)).toBe(100);
    for (const roska of ['', 'Infinity', '1e3', '0x10', '-1', '100.01', 'abc', '1,2,3', '.5', '5.'])
      expect(jasennaAsetusluku(roska, PERUSKORKO_RAJAT)).toBeNull();
    expect(jasennaAsetusluku(undefined, PERUSKORKO_RAJAT)).toBeNull();
    expect(jasennaAsetusluku('30', MAKSUAIKA_RAJAT)).toBe(30);
    for (const roska of ['14,5', '366', '-1', 'NaN'])
      expect(jasennaAsetusluku(roska, MAKSUAIKA_RAJAT)).toBeNull();
  });

  it('luePeruskorko ja lueMaksuaika: roska tai puuttuva arvo → oletus (0 ja 14)', () => {
    expect(luePeruskorko({ LaskuPeruskorko: '2,5' })).toBe(2.5);
    expect(luePeruskorko({ LaskuPeruskorko: 'Infinity' })).toBe(0);
    expect(luePeruskorko({ LaskuPeruskorko: '1e3' })).toBe(0);
    expect(luePeruskorko({})).toBe(0);
    expect(lueMaksuaika({ LaskuMaksuaika: '21' })).toBe(21);
    expect(lueMaksuaika({ LaskuMaksuaika: 'kaksi viikkoa' })).toBe(14);
    expect(lueMaksuaika({ LaskuMaksuaika: '1e9' })).toBe(14);
    expect(lueMaksuaika({})).toBe(14);
  });
});
