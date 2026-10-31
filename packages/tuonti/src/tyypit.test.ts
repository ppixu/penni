import { describe, expect, it } from 'vitest';
import type { KitsasKirja, TaysmaytysRaportti, TuontiRaportti } from './tyypit.js';

describe('@penni/tuonti tyypit', () => {
  it('KitsasKirja rakentuu tyhjänä', () => {
    const kirja: KitsasKirja = {
      tilit: [],
      tilikaudet: [],
      asetukset: {},
      kumppanit: [],
      tositteet: [],
      liitteet: [],
      kpVersio: '24',
      ohitetut: {},
    };
    expect(kirja.tositteet).toHaveLength(0);
  });

  it('raporttityypit sallivat tyhjän tuloksen', () => {
    const raportti: TuontiRaportti = {
      tilit: 0,
      tilikaudet: 0,
      asetukset: 0,
      kumppanit: 0,
      tositteet: 0,
      viennit: 0,
      liitteet: 0,
      ohitetut: {},
      varoitukset: [],
    };
    const taysmaytys: TaysmaytysRaportti = { tasmaa: true, erot: [], maarat: {}, ulkopuoliset: 0 };
    expect(raportti.varoitukset).toEqual([]);
    expect(taysmaytys.tasmaa).toBe(true);
  });
});
