import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import {
  type AlvErittelyRivi,
  erittelyRyhmanNimi,
  haeAlvErittely,
  ryhmitteleAlvErittely,
} from './alvErittely.js';
import { tallennaTosite } from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-06-01T00:00:00.000Z' };
const KAUSI = { alkupvm: '2026-06-01', loppupvm: '2026-06-30' };

const TILIT = [
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } },
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
];

const seed = (tilit = TILIT) =>
  createMemoryStorage({
    tilit,
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { AlvVelvollinen: 'true' },
  });

/** Kotimaan nettomyynti: pankki debet, myynti kredit (11), alv-velka kredit (111).
 *  `vientiPvm` antaa vienneille eri päivän kuin tositteelle. */
const myynti = (pvm: string, netto: number, vero: number, vientiPvm = pvm) => ({
  pvm,
  tyyppi: TositeTyyppi.TULO,
  sarja: '',
  viennit: [
    {
      tili: 1900,
      debet: c(netto + vero),
      kredit: c(0),
      pvm: vientiPvm,
      alvKoodi: 0,
      alvProsentti: 0,
    },
    { tili: 3000, debet: c(0), kredit: c(netto), pvm: vientiPvm, alvKoodi: 11, alvProsentti: 25.5 },
    { tili: 2939, debet: c(0), kredit: c(vero), pvm: vientiPvm, alvKoodi: 111, alvProsentti: 25.5 },
  ],
});

/** Kotimaan nettosto: osto debet (21), alv-saatava debet (221), pankki kredit. */
const osto = (pvm: string, netto: number, vero: number) => ({
  pvm,
  tyyppi: TositeTyyppi.MENO,
  sarja: '',
  viennit: [
    { tili: 4000, debet: c(netto), kredit: c(0), pvm, alvKoodi: 21, alvProsentti: 25.5 },
    { tili: 1763, debet: c(vero), kredit: c(0), pvm, alvKoodi: 221, alvProsentti: 25.5 },
    { tili: 1900, debet: c(0), kredit: c(netto + vero), pvm, alvKoodi: 0, alvProsentti: 0 },
  ],
});

/** Bruttokirjaus 24 %: myynti (12) tilille 3000 tai osto (22) tilille 4000, ei alv-vientiä. */
const brutto = (pvm: string, summa: number, koodi: 12 | 22) => {
  const onMyynti = koodi === 12;
  return {
    pvm,
    tyyppi: onMyynti ? TositeTyyppi.TULO : TositeTyyppi.MENO,
    sarja: '',
    viennit: [
      {
        tili: 1900,
        debet: c(onMyynti ? summa : 0),
        kredit: c(onMyynti ? 0 : summa),
        pvm,
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: onMyynti ? 3000 : 4000,
        debet: c(onMyynti ? 0 : summa),
        kredit: c(onMyynti ? summa : 0),
        pvm,
        alvKoodi: koodi,
        alvProsentti: 24,
      },
    ],
  };
};

describe('haeAlvErittely', () => {
  it('rajaa vientipäivällä, ohittaa luonnokset ja verottomat viennit', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-05-31', 10000, 2550), env); // ennen kautta
    await tallennaTosite(
      s,
      { ...myynti('2026-06-05', 10000, 2550), tila: TositeTila.LUONNOS },
      env,
    );
    // Tosite on päivätty ennen kautta, mutta sen viennit kauden sisällä -> mukana.
    const sekapaivainen = await tallennaTosite(
      s,
      myynti('2026-05-31', 20000, 5100, '2026-06-02'),
      env,
    );
    const e = await haeAlvErittely(s, KAUSI);
    expect(e.alkupvm).toBe('2026-06-01');
    expect(e.loppupvm).toBe('2026-06-30');
    expect(e.rivit.map((r) => [r.alvKoodi, r.summa])).toEqual([
      [11, 20000],
      [111, 5100],
    ]);
    expect(e.rivit[0]).toMatchObject({
      tosite: sekapaivainen.id,
      pvm: '2026-06-02',
      tositePvm: '2026-05-31',
      kanta: 2550,
      tili: 3000,
    });
  });

  it('etumerkki koodin puolen mukaan: myynti kredit − debet, osto debet − kredit', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    await tallennaTosite(s, osto('2026-06-06', 4000, 1020), env);
    // Myynnin hyvitys: myynti ja alv-velka debetissä -> negatiiviset rivit.
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-07',
        tyyppi: TositeTyyppi.TULO,
        sarja: '',
        viennit: [
          {
            tili: 3000,
            debet: c(2000),
            kredit: c(0),
            pvm: '2026-06-07',
            alvKoodi: 11,
            alvProsentti: 25.5,
          },
          {
            tili: 2939,
            debet: c(510),
            kredit: c(0),
            pvm: '2026-06-07',
            alvKoodi: 111,
            alvProsentti: 25.5,
          },
          {
            tili: 1900,
            debet: c(0),
            kredit: c(2510),
            pvm: '2026-06-07',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const e = await haeAlvErittely(s, KAUSI);
    expect(e.rivit.map((r) => [r.alvKoodi, r.tili, r.summa])).toEqual([
      [11, 3000, 10000],
      [11, 3000, -2000],
      [21, 4000, 4000],
      [111, 2939, 2550],
      [111, 2939, -510],
      [221, 1763, 1020],
    ]);
  });

  it('lajittelee tilin sisällä vientipäivän mukaan ja antaa tositenumeron', async () => {
    const s = seed();
    const myohempi = await tallennaTosite(s, myynti('2026-06-20', 10000, 2550), env);
    const aiempi = await tallennaTosite(s, myynti('2026-06-03', 20000, 5100), env);
    const e = await haeAlvErittely(s, KAUSI);
    const r11 = e.rivit.filter((r) => r.alvKoodi === 11);
    expect(r11.map((r) => r.tosite)).toEqual([aiempi.id, myohempi.id]);
    expect(r11.map((r) => r.tositeNumero)).toEqual([
      `${aiempi.sarja} ${aiempi.tunniste}`.trim(),
      `${myohempi.sarja} ${myohempi.tunniste}`.trim(),
    ]);
  });

  it('kumppanin nimi tositteelta; selite viennistä, muuten tositteen otsikosta', async () => {
    const s = seed();
    const k = await s.saveKumppani({ nimi: 'Asiakas Oy' });
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-05',
        tyyppi: TositeTyyppi.TULO,
        sarja: '',
        kumppani: k.id,
        otsikko: 'Kesäkuun myynti',
        viennit: [
          {
            tili: 1900,
            debet: c(12550),
            kredit: c(0),
            pvm: '2026-06-05',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(10000),
            pvm: '2026-06-05',
            alvKoodi: 11,
            alvProsentti: 25.5,
            selite: 'Konsultointi',
          },
          {
            tili: 2939,
            debet: c(0),
            kredit: c(2550),
            pvm: '2026-06-05',
            alvKoodi: 111,
            alvProsentti: 25.5,
          },
        ],
      },
      env,
    );
    await tallennaTosite(s, myynti('2026-06-06', 10000, 2550), env); // ei kumppania eikä otsikkoa
    const e = await haeAlvErittely(s, KAUSI);
    const [a11, b11, a111] = e.rivit;
    expect(a11).toMatchObject({ kumppani: 'Asiakas Oy', selite: 'Konsultointi' });
    expect(b11).toMatchObject({ kumppani: '', selite: '' });
    expect(a111).toMatchObject({ kumppani: 'Asiakas Oy', selite: 'Kesäkuun myynti' });
  });

  it('bruttomyynti: oikaisurivit 12 ja 112 ilman tositetta, kauden viimeisellä päivällä', async () => {
    const s = seed();
    await tallennaTosite(s, brutto('2026-06-10', 12400, 12), env);
    const e = await haeAlvErittely(s, KAUSI);
    expect(e.rivit.map((r) => [r.alvKoodi, r.kanta, r.tili, r.summa])).toEqual([
      [12, 2400, 3000, 12400],
      [12, 2400, 3000, -2400],
      [112, 2400, 2939, 2400],
    ]);
    const oikaisu = e.rivit[1];
    expect(oikaisu?.tosite).toBeUndefined();
    expect(oikaisu).toMatchObject({
      tositeNumero: '',
      pvm: '2026-06-30',
      tositePvm: '2026-06-30',
      kumppani: '',
      selite: 'Bruttomyyntien oikaisu 3000 Myynti BRUTTO 124,00 €, NETTO 100,00 €',
    });
    expect(e.rivit[2]?.selite).toBe(oikaisu?.selite);
  });

  it('brutto-osto: oikaisurivit 22 ja 222 alv-saatavalle', async () => {
    const s = seed();
    await tallennaTosite(s, brutto('2026-06-10', 12400, 22), env);
    const e = await haeAlvErittely(s, KAUSI);
    expect(e.rivit.map((r) => [r.alvKoodi, r.tili, r.summa])).toEqual([
      [22, 4000, 12400],
      [22, 4000, -2400],
      [222, 1763, 2400],
    ]);
    expect(e.rivit[1]?.selite).toBe(
      'Brutto-ostojen oikaisu 4000 Ostot BRUTTO 124,00 €, NETTO 100,00 €',
    );
  });

  it('ilman alv-velkatiliä oikaisun verorivi menee tilille 0', async () => {
    const s = seed(TILIT.filter((t) => t.tyyppi !== 'BL'));
    await tallennaTosite(s, brutto('2026-06-10', 12400, 12), env);
    const e = await haeAlvErittely(s, KAUSI);
    expect(e.rivit.at(-1)).toMatchObject({ alvKoodi: 112, tili: 0, summa: 2400 });
  });

  it('jättää ALVLASKELMA-tositteet pois', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-30',
        tyyppi: TositeTyyppi.ALVLASKELMA,
        sarja: '',
        viennit: [
          {
            tili: 2939,
            debet: c(2550),
            kredit: c(0),
            pvm: '2026-06-30',
            alvKoodi: 111,
            alvProsentti: 25.5,
          },
          {
            tili: 1900,
            debet: c(0),
            kredit: c(2550),
            pvm: '2026-06-30',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const e = await haeAlvErittely(s, KAUSI);
    expect(e.rivit.map((r) => r.alvKoodi)).toEqual([11, 111]);
  });
});

const rivi = (
  alvKoodi: number,
  kanta: number,
  tili: number,
  summa: number,
  tositeNumero = '1',
): AlvErittelyRivi => ({
  alvKoodi,
  kanta,
  tili,
  pvm: '2026-06-05',
  tosite: 1,
  tositeNumero,
  tositePvm: '2026-06-05',
  kumppani: '',
  selite: '',
  summa: c(summa),
});

describe('ryhmitteleAlvErittely', () => {
  it('ryhmittelee koodin ja kannan, sitten tilin mukaan ja summaa sentit', () => {
    const ryhmat = ryhmitteleAlvErittely([
      rivi(111, 2550, 2939, 2550),
      rivi(11, 2550, 3010, 500, '3'),
      rivi(11, 2550, 3000, 10000, '1'),
      rivi(11, 1400, 3000, 1000),
      rivi(11, 2550, 3000, -2000, '2'),
    ]);
    expect(ryhmat.map((r) => [r.alvKoodi, r.kanta, r.summa])).toEqual([
      [11, 1400, 1000],
      [11, 2550, 8500],
      [111, 2550, 2550],
    ]);
    const g = ryhmat[1];
    expect(g?.nimi).toBe('Verollinen myynti (netto)');
    expect(g?.tilit.map((t) => [t.tili, t.summa])).toEqual([
      [3000, 8000],
      [3010, 500],
    ]);
    // Tilin sisällä syötteen järjestys säilyy.
    expect(g?.tilit[0]?.rivit.map((r) => r.tositeNumero)).toEqual(['1', '2']);
    expect(ryhmat[2]?.nimi).toBe('VERON MÄÄRÄ Verollinen myynti (netto)');
  });

  it('tyhjä syöte -> tyhjä lista', () => {
    expect(ryhmitteleAlvErittely([])).toEqual([]);
  });
});

describe('erittelyRyhmanNimi', () => {
  it.each([
    [11, 'Verollinen myynti (netto)'],
    [12, 'Verollinen myynti (brutto)'],
    [21, 'Verollinen osto (netto)'],
    [111, 'VERON MÄÄRÄ Verollinen myynti (netto)'],
    [112, 'VERON MÄÄRÄ Verollinen myynti (brutto)'],
    [125, 'VERON MÄÄRÄ Palveluiden yhteisöhankinnat'],
    [221, 'VÄHENNYKSEN MÄÄRÄ Verollinen osto (netto)'],
    [18, 'Verollinen myynti (maksuperusteinen alv)'],
    [418, 'KOHDENTAMATON MAKSUPERUSTEINEN Verollinen myynti (maksuperusteinen alv)'],
    [428, 'KOHDENTAMATON MAKSUPERUSTEINEN Verollinen osto (maksuperusteinen alv)'],
    [932, 'Vähennyskelvottoman oston veron osuus'],
    [914, 'ALV-koodi 914'],
  ])('%i -> %s', (koodi, nimi) => {
    expect(erittelyRyhmanNimi(koodi)).toBe(nimi);
  });
});
