import { describe, expect, it } from 'vitest';
import { PalkatVirhe } from './taulukot.js';
import { ASETUS, luePalkatAsetukset, lueTyontekijat } from './tyontekija.js';

const hyva = {
  id: 'a1',
  nimi: 'Testaaja Tiina',
  hetu: '150300A9015',
  vakuutusperuste: 'tyontekija',
  palkkamuoto: 'kuukausi',
  kuukausipalkka: 300000,
  puhelinetu: false,
  verokortit: [
    {
      alkaa: '2026-01-01',
      paattyy: '2026-12-31',
      perusBp: 2350,
      lisaBp: 4000,
      tuloraja: 3000000,
      aiemminMaksettu: 0,
    },
  ],
  aktiivinen: true,
};

describe('lueTyontekijat', () => {
  it('puuttuva asetus: tyhjä lista', () => {
    expect(lueTyontekijat({})).toEqual([]);
    expect(lueTyontekijat({ [ASETUS.tyontekijat]: '' })).toEqual([]);
  });
  it('lukee kelvollisen rekisterin', () => {
    const t = lueTyontekijat({ [ASETUS.tyontekijat]: JSON.stringify([hyva]) });
    expect(t).toHaveLength(1);
    expect(t[0]?.nimi).toBe('Testaaja Tiina');
    expect(t[0]?.verokortit[0]?.perusBp).toBe(2350);
  });
  it('hylkää virheellisen hetun paljastamatta sitä', () => {
    const huono = { ...hyva, hetu: '150300A9016' };
    try {
      lueTyontekijat({ [ASETUS.tyontekijat]: JSON.stringify([huono]) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PalkatVirhe);
      expect((e as PalkatVirhe).koodi).toBe('SYOTE');
      expect(String((e as Error).message)).not.toContain('150300A9016');
      expect(JSON.stringify((e as PalkatVirhe).tiedot ?? '')).not.toContain('150300A9016');
    }
  });
  it('hylkää rikkinäisen JSONin', () => {
    expect(() => lueTyontekijat({ [ASETUS.tyontekijat]: '{' })).toThrow(PalkatVirhe);
  });
  it('hylkää liukuluvun rahakentässä', () => {
    const huono = { ...hyva, kuukausipalkka: 3000.5 };
    expect(() => lueTyontekijat({ [ASETUS.tyontekijat]: JSON.stringify([huono]) })).toThrow(
      PalkatVirhe,
    );
  });
  it('hylkää virheellisen IBANin', () => {
    const huono = { ...hyva, iban: 'FI0000000000000000' };
    expect(() => lueTyontekijat({ [ASETUS.tyontekijat]: JSON.stringify([huono]) })).toThrow(
      PalkatVirhe,
    );
  });
});

describe('luePalkatAsetukset', () => {
  it('oletukset kun asetus puuttuu', () => {
    expect(luePalkatAsetukset({})).toEqual({ tilapainenTyonantaja: false, tvrVapautus: false });
  });
  it('lukee annetut arvot', () => {
    const a = luePalkatAsetukset({
      [ASETUS.asetukset]: JSON.stringify({
        tyelYhtio: '54',
        tyelKokonaisBp: { '2026': 2485 },
        tilapainenTyonantaja: true,
        tvrVapautus: false,
      }),
    });
    expect(a.tyelYhtio).toBe('54');
    expect(a.tyelKokonaisBp?.['2026']).toBe(2485);
    expect(a.tilapainenTyonantaja).toBe(true);
  });
});
