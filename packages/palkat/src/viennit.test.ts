import type { PalkkaHenkilo } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  type LaskentaYmparisto,
  type PalkkaSyote,
  type SyoteRivi,
  laskePalkka,
  taulukkoHaku,
} from './laske.js';
import { PalkatVirhe } from './taulukot.js';
import type { PalkatAsetukset, Tyontekija, Verokortti } from './tyontekija.js';
import { PALKKATILIT_OLETUS, type Palkkatilit, luePalkkatilit, palkkaViennit } from './viennit.js';

/*
 * Tapaukset A-D rakennetaan `laskePalkka`lla samoista syötteistä kuin laske.test.ts:ssä, jotta
 * odotetut summat ovat ne, jotka laskentatesti jo todistaa (2026).
 */

const c = (n: number) => n as Cents;
const TARKISTEMERKIT = '0123456789ABCDEFHJKLMNPRSTUVWXY';
function testiHetu(ppkkvv: string, merkki: string, yksilo: string): string {
  return `${ppkkvv}${merkki}${yksilo}${TARKISTEMERKIT[Number(`${ppkkvv}${yksilo}`) % 31]}`;
}
const HETU = testiHetu('010190', '-', '900');

function kortti(perusBp: number, lisaBp: number): Verokortti {
  return {
    alkaa: '2026-01-01',
    paattyy: '2026-12-31',
    perusBp,
    lisaBp,
    tuloraja: c(3_000_000),
    aiemminMaksettu: c(0),
  };
}
function tyontekija(osat: Partial<Tyontekija> = {}): Tyontekija {
  return {
    id: 't1',
    nimi: 'Testi Työntekijä',
    hetu: HETU,
    vakuutusperuste: 'tyontekija',
    palkkamuoto: 'kuukausi',
    puhelinetu: false,
    verokortit: [],
    aktiivinen: true,
    ...osat,
  };
}
const ASETUKSET: PalkatAsetukset = { tilapainenTyonantaja: false, tvrVapautus: false };
const ymp: LaskentaYmparisto = {
  taulukko: taulukkoHaku(),
  asetukset: ASETUKSET,
  aiempiKertyma: c(0),
};
const MAKSUPAIVA = '2026-10-31';
function laske(t: Tyontekija, rivit: SyoteRivi[]): PalkkaHenkilo {
  const s: PalkkaSyote = {
    tyontekija: t,
    maksupaiva: MAKSUPAIVA,
    kausiAlkaa: '2026-10-01',
    kausiLoppuu: MAKSUPAIVA,
    rivit,
  };
  return laskePalkka(s, ymp);
}
const palkka = (summa: number): SyoteRivi => ({
  laji: 'kuukausipalkka',
  selite: 'Kuukausipalkka',
  summa: c(summa),
});

const tapausA = () =>
  laske(tyontekija({ puhelinetu: true, verokortit: [kortti(2000, 4000)] }), [
    palkka(300_000),
    { laji: 'puhelinetu', selite: 'Puhelinetu' },
    { laji: 'km', selite: 'Helsinki–Espoo asiakaskäynti', maara: 10_000 },
  ]);
const tapausB = () =>
  laske(tyontekija({ palkkamuoto: 'tunti', verokortit: [kortti(1000, 3000)] }), [
    { laji: 'tuntipalkka', selite: 'Tunnit', maara: 3750, ahinta: c(1250) },
  ]);
const tapausC = () =>
  laske(tyontekija({ vakuutusperuste: 'yel', verokortit: [kortti(1500, 3500)] }), [
    palkka(200_000),
  ]);
const tapausD = () =>
  laske(tyontekija({ vakuutusperuste: 'osaomistaja', verokortit: [kortti(1800, 3800)] }), [
    palkka(250_000),
  ]);

const TILIT: Palkkatilit = { ...PALKKATILIT_OLETUS, MP: 1920 };

type Rivi = ReturnType<typeof palkkaViennit>[number];
const summaa = (rivit: Rivi[], tili: number, puoli: 'debet' | 'kredit') =>
  rivit.filter((r) => r.tili === tili).reduce((a, r) => a + r[puoli], 0);
const tasapaino = (rivit: Rivi[]) => [
  rivit.reduce((a, r) => a + r.debet, 0),
  rivit.reduce((a, r) => a + r.kredit, 0),
];

describe('palkkaViennit', () => {
  it('tapaus A viennit täsmäävät', () => {
    const v = palkkaViennit([tapausA()], TILIT, MAKSUPAIVA);
    const [d, k] = tasapaino(v);
    expect(d).toBe(k);
    expect(summaa(v, 5000, 'debet')).toBe(300_000); // PA
    expect(summaa(v, 5440, 'debet')).toBe(2000); // LU
    expect(summaa(v, 5990, 'kredit')).toBe(2000); // LV
    expect(summaa(v, 7870, 'debet')).toBe(5500); // KM
    expect(summaa(v, 6300, 'debet')).toBe(5768); // SV
    expect(summaa(v, 2920, 'kredit')).toBe(5768 + 60_400); // SB + EP
    expect(summaa(v, 6130, 'debet')).toBe(53_001); // EL
    expect(summaa(v, 2931, 'kredit')).toBe(53_001 + 22_046); // TL
    expect(summaa(v, 6410, 'debet')).toBe(936); // TV
    expect(summaa(v, 2965, 'kredit')).toBe(936 + 2688); // TT
    expect(summaa(v, 1920, 'kredit')).toBe(220_366); // MP
    // Jokaisella rivillä vain toinen puoli, päivä ja alv-tiedot kunnossa.
    for (const r of v) {
      expect(r.debet === 0 || r.kredit === 0).toBe(true);
      expect(r.debet + r.kredit).toBeGreaterThan(0);
      expect(r.pvm).toBe(MAKSUPAIVA);
      expect(r.alvKoodi).toBe(0);
      expect(r.alvProsentti).toBe(0);
    }
  });

  it('rivit ovat spesifikaation järjestyksessä ja selite on "<otsikko> / <nimi>"', () => {
    const v = palkkaViennit([tapausA()], TILIT, MAKSUPAIVA);
    expect(v.map((r) => [r.tili, r.debet ? 'D' : 'K', r.debet || r.kredit])).toEqual([
      [5000, 'D', 300_000],
      [5440, 'D', 2000],
      [5990, 'K', 2000],
      [7870, 'D', 5500],
      [6300, 'D', 5768],
      [2920, 'K', 5768],
      [6130, 'D', 53_001],
      [2931, 'K', 53_001],
      [6410, 'D', 936],
      [2965, 'K', 936],
      [2920, 'K', 60_400],
      [2931, 'K', 22_046],
      [2965, 'K', 2688],
      [1920, 'K', 220_366],
    ]);
    expect(v[0]?.selite).toBe('Palkat / Testi Työntekijä');
    expect(v.every((r) => r.selite?.endsWith(' / Testi Työntekijä'))).toBe(true);
  });

  it('tapaukset B-D täsmäävät', () => {
    for (const h of [tapausB(), tapausC(), tapausD()]) {
      const [d, k] = tasapaino(palkkaViennit([h], TILIT, MAKSUPAIVA));
      expect(d).toBe(k);
      expect(d).toBeGreaterThan(0);
    }
  });

  it('usea henkilö täsmää yhdessä', () => {
    const v = palkkaViennit([tapausA(), tapausB(), tapausC(), tapausD()], TILIT, MAKSUPAIVA);
    const [d, k] = tasapaino(v);
    expect(d).toBe(k);
    expect(summaa(v, 1920, 'kredit')).toBe(220_366 + 38_348 + 170_000 + 185_775);
  });

  it('erä vain OmaVero-viennillä', () => {
    const v = palkkaViennit([tapausA()], TILIT, MAKSUPAIVA, 42);
    const erat = v.filter((r) => r.era === 42);
    expect(erat.map((r) => [r.tili, r.kredit])).toEqual([
      [2920, 5768],
      [2920, 60_400],
    ]);
    expect(v.filter((r) => r.era !== undefined)).toHaveLength(2);
    expect(palkkaViennit([tapausA()], TILIT, MAKSUPAIVA).some((r) => 'era' in r)).toBe(false);
  });

  it('nollarivit puuttuvat', () => {
    const v = palkkaViennit([tapausC()], TILIT, MAKSUPAIVA); // YEL: ei TyEL- eikä TVR-maksuja
    const tilit = v.map((r) => r.tili);
    for (const tili of [6130, 2931, 6410, 2965, 5440, 5990, 7870]) {
      expect(tilit).not.toContain(tili);
    }
    expect(v.every((r) => r.debet + r.kredit > 0)).toBe(true);
    expect(tilit).toEqual([5000, 6300, 2920, 2920, 1920]);
  });

  it('lisät, päivärahat, ateriakorvaus ja kulukorvaus omille tileilleen', () => {
    const h = laske(tyontekija({ verokortit: [kortti(2000, 4000)] }), [
      palkka(300_000),
      { laji: 'lisa', selite: 'Ylityö', summa: c(10_000) },
      { laji: 'kokopaivaraha', selite: 'Matka', maara: 100, pvm: '2026-10-10' },
      { laji: 'ateriakorvaus', selite: 'Matka', maara: 200, pvm: '2026-10-10' },
      { laji: 'kulukorvaus', selite: 'Taksi', summa: c(2500), tili: 7000 },
    ]);
    const v = palkkaViennit([h], TILIT, MAKSUPAIVA);
    const [d, k] = tasapaino(v);
    expect(d).toBe(k);
    expect(summaa(v, 5000, 'debet')).toBe(300_000);
    expect(summaa(v, 5110, 'debet')).toBe(10_000); // LK
    expect(summaa(v, 7880, 'debet')).toBeGreaterThan(0); // PR
    expect(summaa(v, 7910, 'debet')).toBeGreaterThan(0); // AT
    expect(summaa(v, 7000, 'debet')).toBe(2500); // kulukorvaus riviin valitulle tilille
    expect(v.find((r) => r.tili === 7000)?.selite).toBe('Taksi / Testi Työntekijä');
  });

  it('kulukorvaus ilman tiliä on syötevirhe', () => {
    const h = laske(tyontekija({ verokortit: [kortti(2000, 4000)] }), [
      palkka(300_000),
      { laji: 'kulukorvaus', selite: 'Taksi', summa: c(2500) },
    ]);
    expect(() => palkkaViennit([h], TILIT, MAKSUPAIVA)).toThrow(PalkatVirhe);
  });

  it('negatiivinen nettopalkka on syötevirhe eikä viesti sisällä nimeä', () => {
    const h = laske(tyontekija({ verokortit: [kortti(5000, 5000)] }), [
      palkka(10_000),
      { laji: 'ravintoetu', selite: 'Lounaat', maara: 2000, ahinta: c(1500) },
    ]);
    expect(h.tulos.nettopalkka).toBeLessThan(0);
    let virhe: unknown;
    try {
      palkkaViennit([h], TILIT, MAKSUPAIVA);
    } catch (e) {
      virhe = e;
    }
    expect(virhe).toBeInstanceOf(PalkatVirhe);
    expect((virhe as PalkatVirhe).koodi).toBe('SYOTE');
    expect((virhe as PalkatVirhe).message).not.toContain('Testi');
  });
});

describe('luePalkkatilit', () => {
  it('puuttuva asetus: yritysoletukset ja MP pankkitilistä', () => {
    const t = luePalkkatilit({}, 1920);
    expect(t).toEqual({ ...PALKKATILIT_OLETUS, MP: 1920 });
    expect(t.TL).toBe(2931);
    expect(t.TT).toBe(2965);
    expect(t.EL).toBe(6130);
  });

  it('Kitsas-tuotu kartta säilyy ja TL, TT täydentyvät', () => {
    const kitsas = {
      EP: 2920,
      SB: 2920,
      AY: 2925,
      KM: 7871,
      PR: '7881',
      AT: 7910,
      PA: 5001,
      LK: 5110,
      PI: 5200,
      LS: 5350,
      LU: 5440,
      LV: 5990,
      EL: 6131,
      SV: 6300,
      TV: 6411,
      UO: 2933,
    };
    const t = luePalkkatilit({ palkkatilit: JSON.stringify(kitsas) }, 1930);
    expect(t.PA).toBe(5001);
    expect(t.KM).toBe(7871);
    expect(t.PR).toBe(7881);
    expect(t.EL).toBe(6131);
    expect(t.TV).toBe(6411);
    expect(t.TL).toBe(2931);
    expect(t.TT).toBe(2965);
    expect(t.MP).toBe(1930);
  });

  it('asetettu MP voittaa pankkitilin', () => {
    expect(luePalkkatilit({ palkkatilit: '{"MP":1955}' }, 1920).MP).toBe(1955);
  });

  it('virheellinen JSON tai arvo on syötevirhe; puuttuva vastatili myös', () => {
    expect(() => luePalkkatilit({ palkkatilit: '{' }, 1920)).toThrow(PalkatVirhe);
    expect(() => luePalkkatilit({ palkkatilit: '{"PA":"abc"}' }, 1920)).toThrow(PalkatVirhe);
    expect(() => luePalkkatilit({ palkkatilit: '[1]' }, 1920)).toThrow(PalkatVirhe);
    expect(() => luePalkkatilit({}, 0)).toThrow(PalkatVirhe);
    expect(() => luePalkkatilit({}, Number.NaN)).toThrow(PalkatVirhe);
  });
});
