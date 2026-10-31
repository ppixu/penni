import type { Tilikausi } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import {
  KUUKAUSIVALINNAT,
  OLETUSVALINTA,
  PIKAVALINNAT,
  kuukausittainenAlv,
  laskePikavalinnanVali,
  leikkaa,
  nykyisenTilikaudenIndeksi,
  tyonAlainenKuukausi,
  tyonAlainenNeljannes,
} from './pikavalinnat.js';

/** Kalenterivuosikaudet — tavallisin tapaus. */
const KALENTERI: Tilikausi[] = [
  { alkaa: '2024-01-01', loppuu: '2024-12-31' },
  { alkaa: '2025-01-01', loppuu: '2025-12-31' },
  { alkaa: '2026-01-01', loppuu: '2026-12-31' },
] as Tilikausi[];

/** Tilikausi joka ei ala tammikuusta — koko kysymyksen ydin. */
const HUHTIKUU: Tilikausi[] = [
  { alkaa: '2025-04-01', loppuu: '2026-03-31' },
  { alkaa: '2026-04-01', loppuu: '2027-03-31' },
] as Tilikausi[];

const [K24, K25, K26] = KALENTERI as [Tilikausi, Tilikausi, Tilikausi];
const [H25, H26] = HUHTIKUU as [Tilikausi, Tilikausi];

describe('laskePikavalinnanVali', () => {
  it.each([
    ['q1', '2026-01-01', '2026-03-31'],
    ['q2', '2026-04-01', '2026-06-30'],
    ['q3', '2026-07-01', '2026-09-30'],
    ['q4', '2026-10-01', '2026-12-31'],
  ] as const)('%s rajaa valittuun kalenterineljännekseen', (tunnus, alkupvm, loppupvm) => {
    expect(laskePikavalinnanVali(tunnus, K26, '2026-09-06')).toEqual({ alkupvm, loppupvm });
  });

  it('kiinteä neljännes rajataan tilikauteen tai poistetaan käytöstä', () => {
    const lyhyt = { alkaa: '2026-05-15', loppuu: '2026-11-20' } as Tilikausi;
    expect(laskePikavalinnanVali('q1', lyhyt, '2026-09-06')).toBeNull();
    expect(laskePikavalinnanVali('q2', lyhyt, '2026-09-06')).toEqual({
      alkupvm: '2026-05-15',
      loppupvm: '2026-06-30',
    });
    expect(laskePikavalinnanVali('q4', lyhyt, '2026-09-06')).toEqual({
      alkupvm: '2026-10-01',
      loppupvm: '2026-11-20',
    });
    expect(laskePikavalinnanVali('q1', undefined, '2026-09-06')).toBeNull();
  });

  it('oletus on koko valittu tilikausi, ja sen nappi on Tämä vuosi', () => {
    expect(OLETUSVALINTA).toBe('tilikausi');
    expect(PIKAVALINNAT.map((p) => p.tunnus)).toEqual([
      'kuukausi',
      'q1',
      'q2',
      'q3',
      'q4',
      'tilikausi',
    ]);
    expect(PIKAVALINNAT.find((p) => p.tunnus === 'tilikausi')?.label).toBe('Tämä vuosi');
  });

  it('kuukausinapit ovat tammi–joulu kalenterikuukausina', () => {
    expect(KUUKAUSIVALINNAT.map((p) => p.label)).toEqual([
      'Tammi',
      'Helmi',
      'Maalis',
      'Huhti',
      'Touko',
      'Kesä',
      'Heinä',
      'Elo',
      'Syys',
      'Loka',
      'Marras',
      'Joulu',
    ]);
    expect(laskePikavalinnanVali('m01', K26, '2026-09-06')).toEqual({
      alkupvm: '2026-01-01',
      loppupvm: '2026-01-31',
    });
    expect(laskePikavalinnanVali('m12', K26, '2026-09-06')).toEqual({
      alkupvm: '2026-12-01',
      loppupvm: '2026-12-31',
    });
    expect(laskePikavalinnanVali('m02', K24, '2026-09-06')?.loppupvm).toBe('2024-02-29');
  });

  it('kuukausinappi rajataan tilikauteen tai poistetaan käytöstä', () => {
    const lyhyt = { alkaa: '2026-05-15', loppuu: '2026-11-20' } as Tilikausi;
    expect(laskePikavalinnanVali('m04', lyhyt, '2026-09-06')).toBeNull();
    expect(laskePikavalinnanVali('m05', lyhyt, '2026-09-06')).toEqual({
      alkupvm: '2026-05-15',
      loppupvm: '2026-05-31',
    });
    expect(laskePikavalinnanVali('m12', lyhyt, '2026-09-06')).toBeNull();
  });

  it('aiemman kauden kuukaudet ovat sen kauden vuodelta', () => {
    expect(laskePikavalinnanVali('m03', K25, '2026-10-25')).toEqual({
      alkupvm: '2025-03-01',
      loppupvm: '2025-03-31',
    });
  });

  it('tilikausi on tilikausi, ei kalenterivuosi', () => {
    expect(laskePikavalinnanVali('tilikausi', H26, '2026-08-22')).toEqual({
      alkupvm: '2026-04-01',
      loppupvm: '2027-03-31',
    });
  });

  it('aiemman kauden neljännekset ovat sen kauden vuodelta', () => {
    expect(laskePikavalinnanVali('q2', K25, '2026-10-25')).toEqual({
      alkupvm: '2025-04-01',
      loppupvm: '2025-06-30',
    });
  });

  it('kuukausi on kalenterikuukausi', () => {
    expect(laskePikavalinnanVali('kuukausi', K26, '2026-08-22')).toEqual({
      alkupvm: '2026-08-01',
      loppupvm: '2026-08-31',
    });
  });

  it('tämä kuukausi puuttuu, kun tänään ei ole valitulla kaudella', () => {
    expect(laskePikavalinnanVali('kuukausi', K25, '2026-10-25')).toBeNull();
  });

  it('helmikuun pituus tulee kalenterista, myös karkausvuonna', () => {
    expect(laskePikavalinnanVali('kuukausi', K24, '2024-02-10')?.loppupvm).toBe('2024-02-29');
    expect(laskePikavalinnanVali('kuukausi', K25, '2025-02-10')?.loppupvm).toBe('2025-02-28');
  });

  it('neljännes ankkuroituu kalenterineljännekseen', () => {
    expect(laskePikavalinnanVali('neljannes', K26, '2026-08-22')).toEqual({
      alkupvm: '2026-07-01',
      loppupvm: '2026-09-30',
    });
    expect(laskePikavalinnanVali('neljannes', K26, '2026-01-01')).toEqual({
      alkupvm: '2026-01-01',
      loppupvm: '2026-03-31',
    });
  });

  it('leikkaa neljänneksen tilikauden reunaan', () => {
    // Q2 2026 on 1.4.–30.6., mutta tilikausi 2025-04-01–2026-03-31 päättyy jo 31.3.
    // Ankkuri clampataan kauden sisään, joten neljännes on kauden viimeinen (Q1) leikattuna.
    expect(laskePikavalinnanVali('neljannes', H25, '2026-05-15')).toEqual({
      alkupvm: '2026-01-01',
      loppupvm: '2026-03-31',
    });
  });

  it('palauttaa null kun tilikautta ei ole', () => {
    expect(laskePikavalinnanVali('tilikausi', undefined, '2026-08-22')).toBeNull();
    expect(laskePikavalinnanVali('kuukausi', undefined, '2026-08-22')).toBeNull();
  });
});

describe('leikkaa', () => {
  it('rajaa käsin syötetyn välin kauteen; tyhjä päivä on kauden reuna', () => {
    expect(leikkaa({ alkupvm: '2025-11-01', loppupvm: '2026-02-01' }, K26)).toEqual({
      alkupvm: '2026-01-01',
      loppupvm: '2026-02-01',
    });
    expect(leikkaa({ alkupvm: '', loppupvm: '' }, K26)).toEqual({
      alkupvm: '2026-01-01',
      loppupvm: '2026-12-31',
    });
  });
});

describe('nykyisenTilikaudenIndeksi', () => {
  it('löytää päivän sisältävän kauden', () => {
    expect(nykyisenTilikaudenIndeksi(KALENTERI, '2025-06-01')).toBe(1);
  });

  it('viimeisen kauden jälkeen palautuu viimeiseen', () => {
    expect(nykyisenTilikaudenIndeksi(KALENTERI, '2030-01-01')).toBe(2);
  });

  it('ennen ensimmäistä kautta palautuu ensimmäiseen', () => {
    expect(nykyisenTilikaudenIndeksi(KALENTERI, '2001-01-01')).toBe(0);
  });

  it('kausien välisessä aukossa valitaan aiempi kausi', () => {
    const aukko = [
      { alkaa: '2024-01-01', loppuu: '2024-12-31' },
      { alkaa: '2026-01-01', loppuu: '2026-12-31' },
    ] as Tilikausi[];
    expect(nykyisenTilikaudenIndeksi(aukko, '2025-06-01')).toBe(0);
  });

  it('on -1 kun tilikausia ei ole', () => {
    expect(nykyisenTilikaudenIndeksi([], '2026-08-22')).toBe(-1);
  });
});

describe('tyonAlainenNeljannes', () => {
  it('on ensimmäinen neljännes, jonka alv:ta ei ole vielä ilmoitettu', () => {
    // Lokakuu, mutta Q3:n alv on vielä ilmoittamatta: työn alla on Q3, ei kalenterin Q4.
    expect(tyonAlainenNeljannes(K26, '2026-10-11', '2026-06-30')).toBe('q3');
    expect(tyonAlainenNeljannes(K26, '2026-10-11', '2026-09-30')).toBe('q4');
  });

  it('kuukausi-ilmoittajalla kesken jäänyt neljännes on työn alla', () => {
    expect(tyonAlainenNeljannes(K26, '2026-10-11', '2026-08-31')).toBe('q3');
  });

  it('ilman ilmoituksia käytetään kalenterin neljännestä', () => {
    expect(tyonAlainenNeljannes(K26, '2026-10-11', undefined)).toBe('q4');
  });

  it('kun seuraava ilmoittamaton päivä on toisena vuonna, käytetään kalenterin neljännestä', () => {
    // Koko 2026 ilmoitettu (tai ilmoitukset vuoden jäljessä): napit ovat vuodelle 2026.
    expect(tyonAlainenNeljannes(K26, '2026-10-11', '2026-12-31')).toBe('q4');
    expect(tyonAlainenNeljannes(K26, '2026-10-11', '2025-03-31')).toBe('q4');
  });

  it('aiemmalla, ilmoitetulla kaudella mikään ei ole työn alla', () => {
    expect(tyonAlainenNeljannes(K25, '2026-10-25', '2026-06-30')).toBeNull();
    expect(tyonAlainenNeljannes(K25, '2026-10-25', undefined)).toBeNull();
  });

  it('aiemman kauden ilmoittamaton neljännes on työn alla vuodenvaihteen yli', () => {
    expect(tyonAlainenNeljannes(K26, '2027-01-15', '2026-09-30')).toBe('q4');
  });

  it('on null ilman tilikautta', () => {
    expect(tyonAlainenNeljannes(undefined, '2026-10-11', '2026-06-30')).toBeNull();
  });
});

describe('tyonAlainenKuukausi', () => {
  it('on ensimmäinen kuukausi, jonka alv:ta ei ole vielä ilmoitettu', () => {
    // Lokakuun lopussa syyskuun alv on vielä ilmoittamatta (erä 12.11.).
    expect(tyonAlainenKuukausi(K26, '2026-10-26', '2026-08-31')).toBe('m09');
    expect(tyonAlainenKuukausi(K26, '2026-10-26', '2026-09-30')).toBe('m10');
  });

  it('ilman ilmoituksia käytetään kalenterin kuukautta', () => {
    expect(tyonAlainenKuukausi(K26, '2026-10-26', undefined)).toBe('m10');
  });

  it('aiemman kauden ilmoittamaton joulukuu on työn alla vuodenvaihteen yli', () => {
    expect(tyonAlainenKuukausi(K25, '2026-01-08', '2025-11-30')).toBe('m12');
    expect(tyonAlainenKuukausi(K25, '2026-03-08', '2025-12-31')).toBeNull();
  });
});

describe('kuukausittainenAlv', () => {
  it('näyttää kuukausirivin vain kuukausittain ilmoittavalle alv-velvolliselle', () => {
    expect(kuukausittainenAlv({ AlvVelvollinen: 'true', AlvKausi: '1' }, K26)).toBe(true);
    expect(kuukausittainenAlv({ AlvVelvollinen: 'true', AlvKausi: '3' }, K26)).toBe(false);
    expect(kuukausittainenAlv({ AlvVelvollinen: 'true', AlvKausi: '12' }, K26)).toBe(false);
    // Puuttuva AlvKausi tarkoittaa kuukautta, mutta ei-alv-velvolliselle se ei merkitse mitään.
    expect(kuukausittainenAlv({ AlvVelvollinen: 'false' }, K26)).toBe(false);
    expect(kuukausittainenAlv({ AlvVelvollinen: 'true', AlvKausi: '1' }, undefined)).toBe(false);
  });

  it('seuraa verokausihistoriaa: kuukausirivi jos jokin kauden osa on kuukausikautta', () => {
    const historia = JSON.stringify([
      { alkaa: '', kk: 3 },
      { alkaa: '2026-07-01', kk: 1 },
    ]);
    const asetukset = { AlvVelvollinen: 'true', AlvKausi: '1', AlvKausiHistoria: historia };
    expect(kuukausittainenAlv(asetukset, K25)).toBe(false);
    expect(kuukausittainenAlv(asetukset, K26)).toBe(true);
  });

  it('alv-velvollisuuden päättyminen ennen kautta piilottaa rivin', () => {
    expect(
      kuukausittainenAlv({ AlvVelvollinen: 'true', AlvKausi: '1', AlvLoppuu: '2025-06-30' }, K26),
    ).toBe(false);
  });
});

it('erillistä Tämä neljännes -nappia ei ole', () => {
  expect(PIKAVALINNAT.map((v) => v.tunnus)).not.toContain('neljannes');
});
