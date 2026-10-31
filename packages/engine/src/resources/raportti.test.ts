import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { type Tili, lataaKartta } from '../accounts/tili.js';
import { type RaporttiMaaritys, laadiRaportti, tulkitseRaportti } from './raportti.js';

const c = (n: number): Cents => n as Cents;
const chart: Tili[] = lataaKartta([
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  { numero: 7000, tyyppi: 'D', nimi: { fi: 'Muut kulut' } },
]);
const saldot = new Map<number, Cents>([
  [3000, c(10000)], // income +
  [4000, c(-4000)], // expense -
  [7000, c(-1000)], // expense -
]);

const maaritys: RaporttiMaaritys = {
  nimi: { fi: 'Tuloslaskelma' },
  rivit: [
    { fi: 'Liikevaihto', L: '30..35', M: 'bold' },
    { fi: 'Ostot', L: '4', S: 1 },
    { fi: 'Muut kulut', L: '7..8', S: 1 },
    { fi: 'Tilikauden tulos', L: '3..9 S', M: 'bold', V: 1 },
  ],
};

describe('tulkitseRaportti', () => {
  const rows = tulkitseRaportti(maaritys, saldot, chart, 'fi');
  const byLabel = (t: string) => rows.find((r) => r.teksti === t);

  it('sums account ranges, sign already normalized', () => {
    expect(byLabel('Liikevaihto')?.arvo).toBe(10000);
    expect(byLabel('Ostot')?.arvo).toBe(-4000);
  });
  it('a range subtotal nets income and expenses', () => {
    expect(byLabel('Tilikauden tulos')?.arvo).toBe(5000); // 10000 - 4000 - 1000
  });
  it('carries indent + bold from S/M', () => {
    expect(byLabel('Ostot')?.sisennys).toBe(1);
    expect(byLabel('Liikevaihto')?.lihava).toBe(true);
  });
  it('emits a blank spacer before a row with V', () => {
    const idx = rows.findIndex((r) => r.teksti === 'Tilikauden tulos');
    expect(rows[idx - 1]?.tyhja).toBe(true);
  });

  it('header rows (h) carry a label but no value', () => {
    const r = tulkitseRaportti({ rivit: [{ fi: 'OSASTO', L: '7 h' }] }, saldot, chart, 'fi');
    expect(r[0]?.teksti).toBe('OSASTO');
    expect(r[0]?.arvo).toBeNull();
  });
  it('a pure title row (empty L) renders label only', () => {
    const r = tulkitseRaportti({ rivit: [{ fi: 'VASTAAVAA', M: 'bold' }] }, saldot, chart, 'fi');
    expect(r[0]?.teksti).toBe('VASTAAVAA');
    expect(r[0]?.arvo).toBeNull();
  });
  it('skips an empty row unless S/H forces it', () => {
    const r1 = tulkitseRaportti({ rivit: [{ fi: 'Tyhjä', L: '5' }] }, saldot, chart, 'fi');
    expect(r1.find((x) => x.teksti === 'Tyhjä')).toBeUndefined(); // no account 5*, not forced
    const r2 = tulkitseRaportti({ rivit: [{ fi: 'Tyhjä', L: '5 S' }] }, saldot, chart, 'fi');
    expect(r2.find((x) => x.teksti === 'Tyhjä')?.arvo).toBe(0); // forced visible, zero
  });
  it('+ includes only income, - only expense', () => {
    const inc = tulkitseRaportti({ rivit: [{ fi: 'Tulot', L: '3..9 + S' }] }, saldot, chart, 'fi');
    expect(inc.find((x) => x.teksti === 'Tulot')?.arvo).toBe(10000); // income only
    const exp = tulkitseRaportti({ rivit: [{ fi: 'Kulut', L: '3..9 - S' }] }, saldot, chart, 'fi');
    expect(exp.find((x) => x.teksti === 'Kulut')?.arvo).toBe(-5000); // expenses only
  });
  it('= emits the running subtotal (accumulated section sums)', () => {
    const m: RaporttiMaaritys = {
      rivit: [
        { fi: 'A', L: '3' },
        { fi: 'B', L: '4' },
        { fi: 'Yhteensä', L: '=' },
      ],
    };
    const r = tulkitseRaportti(m, saldot, chart, 'fi');
    expect(r.find((x) => x.teksti === 'Yhteensä')?.arvo).toBe(6000); // 10000 + (-4000)
  });
});

describe('tulkitseRaportti — tilikohtaiset erittelyt (*)', () => {
  // Pääotsikko + erittelyrivi kuten yritys/raportit.json "Ostot tilikauden aikana" (L "40..43 *").
  const erChart: Tili[] = lataaKartta([
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 3010, tyyppi: 'CL', nimi: { fi: 'Palvelumyynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    { numero: 4010, tyyppi: 'D', nimi: { fi: 'Tarvikeostot' } },
    { numero: 7000, tyyppi: 'D', nimi: { fi: 'Muut kulut' } },
  ]);
  const erSaldot = new Map<number, Cents>([
    [3000, c(10000)],
    [3010, c(0)], // nollasaldo -> ei erittelyriviä
    [4000, c(-2881)],
    [4010, c(-119)],
    [7000, c(-1000)],
  ]);
  const erMaaritys: RaporttiMaaritys = {
    rivit: [
      { fi: 'Liikevaihto', L: '30..35 S *', M: 'bold' },
      { fi: 'Materiaalit ja palvelut', L: '4' },
      { fi: 'Ostot tilikauden aikana', L: '40..43 *', S: 2 },
      { fi: 'Muut kulut', L: '7..8' }, // ei '*' -> ei erittelyä
      { fi: 'Tulos', L: '3..9 S', M: 'bold' },
    ],
  };

  it('ei erittelyrivejä oletuksena (tilinpäätös ja muut kutsujat ennallaan)', () => {
    const r = tulkitseRaportti(erMaaritys, erSaldot, erChart, 'fi');
    expect(r.some((x) => x.tili !== undefined)).toBe(false);
  });

  it('lisää *-rivin alle tilirivit: numero + nimi, saldo, sisennys +1', () => {
    const r = tulkitseRaportti(erMaaritys, erSaldot, erChart, 'fi', { erittelyt: true });
    const i = r.findIndex((x) => x.teksti === 'Ostot tilikauden aikana');
    expect(r[i]?.arvo).toBe(-3000);
    expect(r[i + 1]).toEqual({
      teksti: '4000 Ostot',
      sisennys: 3,
      lihava: false,
      arvo: -2881,
      tili: 4000,
      kaavarivi: 2,
    });
    expect(r[i + 2]).toMatchObject({ teksti: '4010 Tarvikeostot', arvo: -119, tili: 4010 });
    expect(r[i + 3]?.teksti).toBe('Muut kulut');
  });

  it('kaavarivi on kaavarivin indeksi määrityksessä, myös kun rivejä jää pois; erittelyrivit perivät emon', () => {
    const maaritys: RaporttiMaaritys = {
      rivit: [
        { fi: 'Otsikko', L: '' },
        { fi: 'Tyhjä', L: '9' }, // ei tilejä -> pois, mutta indeksi 1 on varattu
        { fi: 'Ostot', L: '40..43 *' },
        { fi: 'Tulos', L: '3..9 S', V: 1 },
      ],
    };
    const r = tulkitseRaportti(maaritys, erSaldot, erChart, 'fi', { erittelyt: true });
    expect(r.filter((x) => !x.tyhja).map((x) => [x.teksti, x.kaavarivi])).toEqual([
      ['Otsikko', 0],
      ['Ostot', 2],
      ['4000 Ostot', 2],
      ['4010 Tarvikeostot', 2],
      ['Tulos', 3],
    ]);
    // Välirivillä ei ole indeksiä.
    expect(r.find((x) => x.tyhja)?.kaavarivi).toBeUndefined();
  });

  it('jättää nollasaldoiset tilit pois', () => {
    const r = tulkitseRaportti(erMaaritys, erSaldot, erChart, 'fi', { erittelyt: true });
    expect(r.find((x) => x.tili === 3010)).toBeUndefined();
    const i = r.findIndex((x) => x.teksti === 'Liikevaihto');
    expect(r[i + 1]).toMatchObject({ teksti: '3000 Myynti', sisennys: 1, arvo: 10000 });
  });

  it('ei erittelyä riveille ilman *-lippua', () => {
    const r = tulkitseRaportti(erMaaritys, erSaldot, erChart, 'fi', { erittelyt: true });
    expect(r.find((x) => x.tili === 7000)).toBeUndefined();
  });

  it('+/- rajaa myös erittelyrivit', () => {
    const r = tulkitseRaportti(
      { rivit: [{ fi: 'Kulut', L: '3..9 - *' }] },
      erSaldot,
      erChart,
      'fi',
      { erittelyt: true },
    );
    expect(r.filter((x) => x.tili !== undefined).map((x) => x.tili)).toEqual([4000, 4010, 7000]);
  });

  it('ohittaa tilin, jota ei ole kartassa lehtitilinä (otsikko samalla numerolla)', () => {
    const kartta = lataaKartta([
      { numero: 4000, tyyppi: 'H2', nimi: { fi: 'Ostot-otsikko' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    ]);
    const r = tulkitseRaportti(
      { rivit: [{ fi: 'Ostot', L: '4 *' }] },
      new Map([
        [4000, c(-500)],
        [4999, c(-1)], // ei kartassa -> ohitetaan (Kitsas: !tili)
      ]),
      kartta,
      'fi',
      { erittelyt: true },
    );
    expect(r.filter((x) => x.tili !== undefined).map((x) => x.teksti)).toEqual(['4000 Ostot']);
  });

  it('erittelyrivit eivät vaikuta välisummiin', () => {
    const r = tulkitseRaportti(erMaaritys, erSaldot, erChart, 'fi', { erittelyt: true });
    expect(r.find((x) => x.teksti === 'Tulos')?.arvo).toBe(6000);
  });
});

describe('laadiRaportti', () => {
  const env = { aika: '2026-06-01T00:00:00.000Z' };
  const tulosLayout: RaporttiMaaritys = {
    nimi: { fi: 'Tuloslaskelma' },
    rivit: [{ fi: 'Tulos', L: '3..9 S', M: 'bold' }],
  };
  const seed = {
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { 'tulos/yleinen': JSON.stringify(tulosLayout) },
  };

  it('fetches the layout from settings and renders the period result', async () => {
    const s = createMemoryStorage(seed);
    await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(7000),
            kredit: c(0),
            pvm: '2026-06-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(7000),
            pvm: '2026-06-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const rows = await laadiRaportti(s, env, {
      muoto: 'tulos/yleinen',
      pvm: '2026-12-31',
      alkupvm: '2026-01-01',
    });
    expect(rows.find((r) => r.teksti === 'Tulos')?.arvo).toBe(7000);
    expect(rows.some((r) => r.tili !== undefined)).toBe(false);

    const eritelty = await laadiRaportti(s, env, {
      muoto: 'tulos/yleinen',
      pvm: '2026-12-31',
      alkupvm: '2026-01-01',
      erittelyt: true,
    });
    // Layoutin rivillä ei ole '*'-lippua -> erittelyt-valinta ei lisää rivejä.
    expect(eritelty).toEqual(rows);
  });

  it('erittelyt: true lisää tilirivit *-riveille', async () => {
    const s = createMemoryStorage({
      ...seed,
      asetukset: {
        'tulos/yleinen': JSON.stringify({ rivit: [{ fi: 'Tulos', L: '3..9 S *', M: 'bold' }] }),
      },
    });
    await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(7000),
            kredit: c(0),
            pvm: '2026-06-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(7000),
            pvm: '2026-06-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const rows = await laadiRaportti(s, env, {
      muoto: 'tulos/yleinen',
      pvm: '2026-12-31',
      alkupvm: '2026-01-01',
      erittelyt: true,
    });
    expect(rows).toEqual([
      { teksti: 'Tulos', sisennys: 0, lihava: true, arvo: 7000, kaavarivi: 0 },
      {
        teksti: '3000 Myynti',
        sisennys: 1,
        lihava: false,
        arvo: 7000,
        tili: 3000,
        kaavarivi: 0,
      },
    ]);
  });

  it('throws when the named layout is missing from settings', async () => {
    const s = createMemoryStorage(seed);
    await expect(
      laadiRaportti(s, env, { muoto: 'tase/yleinen', pvm: '2026-12-31' }),
    ).rejects.toMatchObject({ code: 'EIRAPORTTIA' });
  });
});

describe('tulkitseRaportti — kaikkiRivit', () => {
  // Kitsas yhdistys tulos/yleinen -tyyppinen jono: '='-rivit peräkkäin, kun avustusrivi jää pois.
  const m: RaporttiMaaritys = {
    rivit: [
      { fi: 'Otsikko', L: '' },
      { fi: 'Tuotto', L: '3 S' },
      { fi: 'Kulujäämä', L: '=', V: 1 },
      { fi: 'Avustukset', L: '88 *' },
      { fi: 'Tulos', L: '=' },
    ],
  };
  const s = new Map<number, Cents>([[3000, c(10000)]]);

  it('oletuksena ohittaa tyhjän rivin ja peräkkäisen välisumman', () => {
    const r = tulkitseRaportti(m, s, chart, 'fi');
    expect(r.filter((x) => !x.tyhja).map((x) => x.teksti)).toEqual([
      'Otsikko',
      'Tuotto',
      'Kulujäämä',
    ]);
    expect(r.some((x) => x.kaavaLaji !== undefined)).toBe(false);
  });

  it('kaikkiRivit emittoi jokaisen kaavarivin arvoineen ja merkitsee lajin', () => {
    const r = tulkitseRaportti(m, s, chart, 'fi', { kaikkiRivit: true });
    expect(
      r.filter((x) => !x.tyhja).map((x) => [x.kaavarivi, x.teksti, x.arvo, x.kaavaLaji]),
    ).toEqual([
      [0, 'Otsikko', null, 'otsikko'],
      [1, 'Tuotto', 10000, undefined],
      [2, 'Kulujäämä', 10000, 'valisumma'],
      [3, 'Avustukset', 0, 'ohitettava'],
      [4, 'Tulos', 10000, 'valisumma'],
    ]);
    // Välirivi (V) säilyy.
    expect(r.filter((x) => x.tyhja)).toHaveLength(1);
  });
});
