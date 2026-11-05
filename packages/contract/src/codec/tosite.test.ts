import { type PalkkaAjo, type StoredTosite, type Tosite, TositeTyyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  decodeListattuTosite,
  decodeTosite,
  encodeListattuTosite,
  encodeTosite,
} from './tosite.js';

const c = (n: number) => Euro.fromCents(n);

const voucher: Tosite & { id: number } = {
  id: 1234,
  pvm: '2026-03-15',
  tyyppi: 100,
  tila: 100,
  tunniste: 87,
  sarja: 'A',
  otsikko: 'Toimistotarvikkeet',
  kumppani: 42,
  viite: '13245',
  viennit: [
    {
      tili: 4000,
      debet: c(10000),
      kredit: c(0),
      pvm: '2026-03-15',
      alvKoodi: 9,
      alvProsentti: 25.5,
    },
    { tili: 1900, debet: c(0), kredit: c(10000), pvm: '2026-03-15', alvKoodi: 0, alvProsentti: 0 },
  ],
};

describe('encodeTosite', () => {
  it('nests kumppani as {id}, encodes viennit, omits empty scalars, always emits tila', () => {
    const w = encodeTosite(voucher);
    expect(w).toMatchObject({
      id: 1234,
      pvm: '2026-03-15',
      tyyppi: 100,
      tila: 100,
      tunniste: 87,
      sarja: 'A',
      otsikko: 'Toimistotarvikkeet',
      kumppani: { id: 42 },
      viite: '13245',
    });
    expect(w.viennit).toHaveLength(2);
    expect(w.viennit[0]).toMatchObject({
      tili: 4000,
      debet: '100.00',
      alvkoodi: 9,
      alvprosentti: '25.50',
    });
    expect(w.viennit[1]).toMatchObject({ tili: 1900, kredit: '100.00' });
    expect('rivit' in w).toBe(false); // omitted when absent
  });

  it('always emits tila even when 0 (POISTETTU)', () => {
    const w = encodeTosite({ ...voucher, tila: 0 });
    expect(w.tila).toBe(0);
  });

  it('omits zero tyyppi/tunniste and empty sarja', () => {
    const w = encodeTosite({ ...voucher, tyyppi: 0, tunniste: 0, sarja: '' });
    expect('tyyppi' in w).toBe(false);
    expect('tunniste' in w).toBe(false);
    expect('sarja' in w).toBe(false);
  });
});

describe('decodeTosite', () => {
  it('reconstitutes defaults for absent scalars and unwraps kumppani', () => {
    const t = decodeTosite({
      pvm: '2026-03-15',
      tila: 100,
      viennit: [{ tili: 1900, debet: '5.00', pvm: '2026-03-15' }],
    });
    expect(t).toMatchObject({ pvm: '2026-03-15', tyyppi: 0, tila: 100, tunniste: 0, sarja: '' });
    expect(t.viennit[0]?.debet).toBe(500);
    expect('kumppani' in t).toBe(false);
  });

  it('defaults tila to 100 when absent (legacy DB default)', () => {
    const t = decodeTosite({ pvm: '2026-03-15', viennit: [] });
    expect(t.tila).toBe(100);
  });
});

describe('round-trip', () => {
  it('decode(encode(voucher)) preserves the voucher (incl. id)', () => {
    expect(decodeTosite(encodeTosite(voucher))).toEqual(voucher);
  });

  it('preserves alkuperainenTosite (hyvityslasku: credited original voucher id)', () => {
    const hyvitys: Tosite & { id: number } = { ...voucher, alkuperainenTosite: 7 };
    expect(decodeTosite(encodeTosite(hyvitys)).alkuperainenTosite).toBe(7);
  });

  it('preserves info (Kitsaksen vapaamuotoiset lisätiedot)', () => {
    const w = encodeTosite({ ...voucher, info: 'Muista karhuta' });
    expect(w.info).toBe('Muista karhuta');
    expect(decodeTosite(w).info).toBe('Muista karhuta');
  });

  it('round-trips tiliote (saldot euroina langalla, sentteinä sisällä)', () => {
    const t = {
      pvm: '2026-09-30',
      tyyppi: 400,
      tila: 100,
      tunniste: 0,
      sarja: '',
      viennit: [],
      tiliote: {
        tili: 1910,
        alkupvm: '2026-09-01',
        loppupvm: '2026-09-30',
        iban: 'FI2112345600000785',
        alkusaldo: 123_456 as Cents,
        loppusaldo: -5_00 as Cents,
      },
    };
    const w = encodeTosite(t);
    expect(w.tiliote).toEqual({
      tili: 1910,
      alkupvm: '2026-09-01',
      loppupvm: '2026-09-30',
      iban: 'FI2112345600000785',
      alkusaldo: '1234.56',
      loppusaldo: '-5.00',
    });
    expect(decodeTosite(w).tiliote).toEqual(t.tiliote);
  });

  it('lukee Kitsaksen tiliote-kartan (tili merkkijonona, ei saldoja)', () => {
    const t = decodeTosite({
      pvm: '2026-09-30',
      tila: 100,
      viennit: [],
      tiliote: { tili: '1910', alkupvm: '2026-09-01', loppupvm: '2026-09-30' },
    });
    expect(t.tiliote).toEqual({ tili: 1910, alkupvm: '2026-09-01', loppupvm: '2026-09-30' });
  });

  it('palkka-snapshot säilyy koodekin läpi', () => {
    const palkka: PalkkaAjo = {
      versio: 1,
      kausiAlkaa: '2026-10-01',
      kausiLoppuu: '2026-10-31',
      laskettu: '2026-10-31T12:00:00.000Z',
      henkilot: [
        {
          tyontekijaId: 'tyontekija-1',
          nimi: 'Testi Työntekijä',
          vakuutusperuste: 'tyontekija',
          verokortti: {
            alkaa: '2026-01-01',
            paattyy: '2026-12-31',
            perusBp: 1500,
            lisaBp: 3500,
            tuloraja: 1_500_000 as Cents,
            tammikuuSaanto: false,
          },
          prosentit: {
            tyelTyontekijaBp: 715,
            tyelKokonaisBp: 2490,
            tvrTyontekijaBp: 31,
            tvrTyonantajaBp: 52,
            savaBp: 0,
          },
          rivit: [
            { laji: 'kuukausipalkka', selite: 'Lokakuun palkka', summa: 300_000 as Cents },
            {
              laji: 'km',
              selite: 'Helsinki–Tampere asiakaskäynti',
              maara: 17_000,
              ahinta: 57 as Cents,
              summa: 9_690 as Cents,
              pvm: '2026-10-12',
            },
            { laji: 'kulukorvaus', selite: 'Parkkimaksu', summa: 800 as Cents, tili: 7690 },
          ],
          tulos: {
            rahapalkka: 300_000 as Cents,
            luontoisedut: 0 as Cents,
            verovapaat: 10_490 as Cents,
            pidatysperuste: 300_000 as Cents,
            pidatysOsat: [{ bp: 1500, peruste: 300_000 as Cents }],
            ennakonpidatys: 45_000 as Cents,
            tyelTyontekija: 21_450 as Cents,
            tyelTyonantaja: 53_250 as Cents,
            tvrTyontekija: 930 as Cents,
            tvrTyonantaja: 1_560 as Cents,
            sava: 0 as Cents,
            nettopalkka: 243_110 as Cents,
            kertymaJalkeen: 3_000_000 as Cents,
            varoitukset: ['Tuloraja lähestyy'],
          },
        },
      ],
      ilmoitus: { lahetetty: '2026-11-03', deliveryId: 'abc-123', sha256: 'f'.repeat(64) },
    };
    const t: Tosite = {
      pvm: '2026-10-31',
      tyyppi: TositeTyyppi.PALKKA,
      tila: 100,
      tunniste: 0,
      sarja: '',
      viennit: [],
      palkka,
    };
    const w = encodeTosite(t);
    // Senttimäärät pysyvät kokonaislukusentteinä langalla (Penni-laajennus).
    expect(w.palkka?.henkilot[0]?.tulos.nettopalkka).toBe(243_110);
    expect(decodeTosite(w)).toEqual(t);
    // Tuntematon versio pudotetaan.
    expect(decodeTosite({ ...w, palkka: { versio: 2 } }).palkka).toBeUndefined();
    expect('palkka' in decodeTosite({ ...w, palkka: { versio: 2 } })).toBe(false);
  });

  it('round-trips marginaalialijaama', () => {
    const t = {
      pvm: '2026-06-30',
      tyyppi: 9105,
      tila: 100,
      tunniste: 1,
      sarja: '',
      viennit: [],
      marginaalialijaama: { '25.50': 20000 },
    } as StoredTosite;
    expect(decodeTosite(encodeTosite(t)).marginaalialijaama?.['25.50']).toBe(20000);
  });
});

describe('listattu tosite (liitteita)', () => {
  it('lisää liitemäärän tositteen langalle ja purkaa sen takaisin', () => {
    const listattu = { ...voucher, liitteita: 3 };
    const w = encodeListattuTosite(listattu);
    expect(w.liitteita).toBe(3);
    expect(decodeListattuTosite(w)).toEqual(listattu);
  });

  it('nolla kulkee langalla, puuttuva tulkitaan nollaksi', () => {
    expect(encodeListattuTosite({ ...voucher, liitteita: 0 }).liitteita).toBe(0);
    expect(decodeListattuTosite(encodeTosite(voucher)).liitteita).toBe(0);
  });

  it('kuljettaa alkuperän listarivillä', () => {
    const listattu = { ...voucher, liitteita: 1, alkupera: 'muu' as const };
    const w = encodeListattuTosite(listattu);
    expect(w.alkupera).toBe('muu');
    expect(decodeListattuTosite(w)).toEqual(listattu);
    expect('alkupera' in encodeListattuTosite({ ...voucher, liitteita: 0 })).toBe(false);
  });

  it('yksittäisen tositteen koodekki ei lisää liitteita-avainta', () => {
    expect('liitteita' in encodeTosite(voucher)).toBe(false);
  });
});

describe('laskutuksen lisäkentät', () => {
  const laskutus: Tosite & { id: number } = {
    ...voucher,
    jakso: { alkaa: '2026-05-01', loppuu: '2026-05-31' },
    muistutus: {
      maksu: c(500),
      korko: c(945),
      viivkorko: 11.5,
      korkoalkaa: '2026-05-01',
      korkoloppuu: '2026-05-30',
      aiempiSaldo: c(100000),
      aiemmat: [7],
    },
    viivkorko: 11.5,
    toisto: 3,
    toistoPvm: '2026-05-01',
    ryhma: 'r-1',
    rivit: [
      {
        selite: 'Ylläpito',
        myyntiKpl: 1,
        aNetto: 100,
        alvKoodi: 11,
        alvProsentti: 25.5,
        tuote: 4,
        ennakkoTosite: 9,
      },
    ],
  };

  it('jakso, muistutus, toisto, ryhmä, viivkorko sekä rivin tuote ja ennakkotosite säilyvät', () => {
    const t = decodeTosite(encodeTosite(laskutus));
    expect(t.jakso).toEqual({ alkaa: '2026-05-01', loppuu: '2026-05-31' });
    expect(t.muistutus).toEqual(laskutus.muistutus);
    expect(t.viivkorko).toBe(11.5);
    expect(t.toisto).toBe(3);
    expect(t.toistoPvm).toBe('2026-05-01');
    expect(t.ryhma).toBe('r-1');
    expect(t.rivit?.[0]).toMatchObject({ tuote: 4, ennakkoTosite: 9 });
  });

  it('muistutuksen rahasummat palaavat senttinä (langalla euroina)', () => {
    const w = encodeTosite(laskutus);
    expect(w.muistutus).toMatchObject({ maksu: '5.00', korko: '9.45', aiempiSaldo: '1000.00' });
    const m = decodeTosite(w).muistutus;
    expect([m?.maksu, m?.korko, m?.aiempiSaldo]).toEqual([500, 945, 100000]);
  });

  it('puuttuvat lisäkentät eivät tule langalle', () => {
    const w = encodeTosite(voucher);
    for (const k of ['jakso', 'muistutus', 'viivkorko', 'toisto', 'toistoPvm', 'ryhma'])
      expect(k in w).toBe(false);
  });
});
