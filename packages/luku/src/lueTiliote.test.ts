import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LukuVirhe, esikatseleTiliote, lueTiliotePdf, lueTiliotetiedosto } from './lueTiliote.js';
import { luoTestiPdf } from './testi/luoTestiPdf.js';

// Nordean Tapahtumat-viennin muoto: '<D.M.YYYY>  <nimi [viite]>  <-?rahamaara>'.
const TAPAHTUMAT = [
  'Tapahtumat',
  '4.4.2026 PILVIPALVELU -20,00',
  '14.4.2026 GITHUB -6,37',
  '18.6.2026 REVONTULI OY 12345678 12 480,50',
];

// Keksitty kuukausitiliote rivi per tapahtuma (kirjaus- ja arvopäivä, nimi, määrä [saldo]).
const KUUKAUSI = [
  'Tiliote',
  'ESIMERKKI TMI',
  'Kausi: 01.07.2026 - 31.07.2026',
  'Kirjauspäivä Arvopäivä Saaja/Maksaja Määrä Saldo',
  '30.06.2026 Saldo 2 000,00',
  '01.07 01.07 PILVIPALVELU* PRO TILAUS -20,00',
  'Korttiosto',
  '03.07 03.07 ASIAKAS OY 1 240,00 3 220,00',
  'Viite 1232',
  '15.07 15.07 VEROTOIMISTO -60,00 3 160,00',
  '31.07.2026 Saldo 3 160,00',
];

// Sama pdf.js:n lohkomuodossa: päivärivi 'PP.KK PP.KK', maksupäivä, tap.no, nimi, lisätiedot,
// määrä [+ saldo]; loppusaldon määrä tulee vasta 'PP.KK.VVVV Saldo' -rivin jälkeen.
const LOHKOT = [
  'Tiliote',
  'Kausi: 01.03.2026 - 31.03.2026   Valuutta: EUR',
  '28.02.2026   Saldo   1 000,00',
  'Määrä   Saldo',
  '02.03   02.03',
  '02.03',
  'Tap.no. 1',
  'ESIMERKKIPALVELU* PRO',
  'Korttiosto',
  'USD   12,00 ESIMERKKI.COM',
  '-10,50',
  '05.03   05.03',
  '05.03',
  '2',
  'VEROTOIMISTO',
  'RF1100000000000000',
  '-2 345,60   -1 356,10',
  '20.03   20.03',
  '20.03',
  '3',
  'Asiakas Oy',
  '5 000,00   3 643,90',
  '31.03.2026   Saldo',
  'Panot yhteensä',
  'Otot yhteensä',
  '3 643,90',
  '5 000,00',
  '-2 356,10',
];

describe('lueTiliotePdf', () => {
  it('poimii tapahtumat oikein etumerkkeineen ja viitteineen', async () => {
    const tiliote = await lueTiliotePdf(luoTestiPdf(TAPAHTUMAT));
    expect(tiliote.muoto).toBe('tapahtumat');
    const tapahtumat = tiliote.tapahtumat;
    expect(tapahtumat).toHaveLength(3);
    expect(tapahtumat[0]).toEqual({ pvm: '2026-04-04', nimi: 'PILVIPALVELU', maara: -2000 });
    expect(tapahtumat[2]).toEqual({
      pvm: '2026-06-18',
      nimi: 'REVONTULI OY',
      viite: '12345678',
      maara: 1248050,
    });
  });

  it('lukee kuukausitiliotteen kauden, saldot ja tapahtumat', async () => {
    const tiliote = await lueTiliotePdf(luoTestiPdf(KUUKAUSI));
    expect(tiliote.muoto).toBe('kuukausitiliote');
    expect(tiliote.kausi).toEqual({ alkaa: '2026-07-01', loppuu: '2026-07-31' });
    expect(tiliote.alkusaldo).toBe(200000);
    expect(tiliote.loppusaldo).toBe(316000);
    expect(tiliote.tapahtumat.map((t) => [t.pvm, t.nimi, t.maara])).toEqual([
      ['2026-07-01', 'PILVIPALVELU* PRO TILAUS', -2000],
      ['2026-07-03', 'ASIAKAS OY', 124000],
      ['2026-07-15', 'VEROTOIMISTO', -6000],
    ]);
  });

  it('lukee kuukausitiliotteen pdf.js:n lohkomuodosta, loppusaldo myöhemmällä rivillä', async () => {
    const tiliote = await lueTiliotePdf(luoTestiPdf(LOHKOT));
    expect(tiliote.muoto).toBe('kuukausitiliote');
    expect(tiliote.alkusaldo).toBe(100000);
    expect(tiliote.loppusaldo).toBe(364390);
    expect(tiliote.tapahtumat.map((t) => [t.pvm, t.nimi, t.maara])).toEqual([
      ['2026-03-02', 'ESIMERKKIPALVELU* PRO', -1050],
      ['2026-03-05', 'VEROTOIMISTO', -234560],
      ['2026-03-20', 'Asiakas Oy', 500000],
    ]);
  });

  it('hyväksyy saldollisen kuukausitiliotteen ilman tapahtumia', async () => {
    const tiliote = await lueTiliotePdf(
      luoTestiPdf([
        'Tiliote',
        'Kausi: 01.08.2026 - 31.08.2026',
        '31.07.2026 Saldo 1 000,00',
        '31.08.2026 Saldo 1 000,00',
      ]),
    );
    expect(tiliote.tapahtumat).toEqual([]);
    expect(tiliote.alkusaldo).toBe(100000);
    expect(tiliote.loppusaldo).toBe(100000);
  });

  it('heittää VAARA_MUOTO-virheen kun kumpikaan muoto ei löydä tapahtumia', async () => {
    const pdf = luoTestiPdf(['Tilioteote 4/2026', 'Ei tapahtumia tällä sivulla', '10 740,31']);
    await expect(lueTiliotePdf(pdf)).rejects.toBeInstanceOf(LukuVirhe);
    await expect(lueTiliotePdf(pdf)).rejects.toMatchObject({ koodi: 'VAARA_MUOTO' });
  });

  it('heittää EI_TEKSTIA-virheen kun PDF:ssä ei ole tekstikerrosta', async () => {
    const pdf = luoTestiPdf([]);
    await expect(lueTiliotePdf(pdf)).rejects.toMatchObject({ koodi: 'EI_TEKSTIA' });
  });
});

/** Moottorin synteettiset tiedostofikstuurit: sama aineisto kuin jäsentimien omissa testeissä. */
const fikstuuri = (nimi: string): Uint8Array =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../engine/src/tiliote/tiedosto/fixtures/${nimi}`, import.meta.url)),
    ),
  );

describe('lueTiliotePdf lähde', () => {
  it('merkitsee lähteeksi pdf', async () => {
    const tiliote = await lueTiliotePdf(luoTestiPdf(TAPAHTUMAT));
    expect(tiliote.lahde).toBe('pdf');
  });
});

describe('lueTiliotetiedosto', () => {
  it('lukee camt.053-tiedoston: lähde, IBAN ja tapahtumat', async () => {
    const tiliote = await lueTiliotetiedosto(fikstuuri('camt053-perus.xml'));
    expect(tiliote.lahde).toBe('camt053');
    expect(tiliote.iban).toBe('FI7455550000012343');
    expect(tiliote.tapahtumat.length).toBeGreaterThan(0);
  });

  it('lukee camt.054-tiedoston', async () => {
    const tiliote = await lueTiliotetiedosto(fikstuuri('camt054.xml'));
    expect(tiliote.lahde).toBe('camt054');
  });

  it('lukee tunnetun pankin CSV:n ilman sarakevalintaa', async () => {
    const tiliote = await lueTiliotetiedosto(fikstuuri('csv-nordea.csv'));
    expect(tiliote.lahde).toBe('csv');
    expect(tiliote.tapahtumat.length).toBeGreaterThan(0);
  });

  it('antaa PDF:n PDF-lukijalle', async () => {
    const tiliote = await lueTiliotetiedosto(luoTestiPdf(TAPAHTUMAT));
    expect(tiliote.lahde).toBe('pdf');
    expect(tiliote.muoto).toBe('tapahtumat');
    expect(tiliote.tapahtumat).toHaveLength(3);
  });

  it('PDF ilman tekstikerrosta antaa edelleen EI_TEKSTIA', async () => {
    await expect(lueTiliotetiedosto(luoTestiPdf([]))).rejects.toMatchObject({
      koodi: 'EI_TEKSTIA',
    });
  });

  it('tuntematon CSV ilman sarakevalintaa antaa CSV_SARAKKEET', async () => {
    const virhe = await lueTiliotetiedosto(fikstuuri('csv-tuntematon.csv')).catch((e) => e);
    expect(virhe).toBeInstanceOf(LukuVirhe);
    expect(virhe.koodi).toBe('CSV_SARAKKEET');
    expect(virhe.message).toMatch(/pankkia ei tunnistettu/);
  });

  it('tuntematon CSV luetaan kun sarakevalinta annetaan', async () => {
    const esikatselu = esikatseleTiliote(fikstuuri('csv-tuntematon.csv'));
    const tiliote = await lueTiliotetiedosto(fikstuuri('csv-tuntematon.csv'), {
      csvSarakkeet: esikatselu.csv?.ehdotus,
    });
    expect(tiliote.lahde).toBe('csv');
    expect(tiliote.tapahtumat.length).toBeGreaterThan(0);
  });

  it('JPEG-tavut antavat VAARA_MUOTO-virheen ja luettelevat tuetut muodot', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const virhe = await lueTiliotetiedosto(jpeg).catch((e) => e);
    expect(virhe).toBeInstanceOf(LukuVirhe);
    expect(virhe.koodi).toBe('VAARA_MUOTO');
    // Tuetut muodot luetellaan kerran (moottorin viesti), ei toista listaa perään.
    expect(virhe.message).toContain('Tuettuja muotoja ovat PDF-tiliote');
    expect(virhe.message.match(/camt\.053/g)).toHaveLength(1);
    expect(virhe.message.match(/TITO/g)).toHaveLength(1);
  });

  it('muu XML antaa VAARA_MUOTO-virheen', async () => {
    const xml = new TextEncoder().encode('<?xml version="1.0"?><Laskut><Lasku/></Laskut>');
    await expect(lueTiliotetiedosto(xml)).rejects.toMatchObject({ koodi: 'VAARA_MUOTO' });
  });

  it('jäsentimen virheviesti rivinumeroineen välittyy muuttumattomana', async () => {
    const rikki = new TextEncoder().encode('T00322100\nrikki rivi\n');
    const virhe = await lueTiliotetiedosto(rikki).catch((e) => e);
    expect(virhe).toBeInstanceOf(LukuVirhe);
    expect(virhe.koodi).toBe('VAARA_MUOTO');
    expect(virhe.message).toMatch(/\(rivi \d+\)/);
  });
});

describe('esikatseleTiliote', () => {
  it('antaa CSV:lle otsikot, esimerkit ja ehdotuksen', () => {
    const e = esikatseleTiliote(fikstuuri('csv-tuntematon.csv'));
    expect(e.lahde).toBe('csv');
    expect(e.csv?.otsikot.length).toBeGreaterThan(1);
    expect(e.csv?.esimerkit.length).toBeLessThanOrEqual(5);
    expect(e.csv?.ehdotus).toBeDefined();
  });

  it('tunnistetun pankin CSV:lle kertoo pankin', () => {
    const e = esikatseleTiliote(fikstuuri('csv-nordea.csv'));
    expect(e.csv?.pankki).toBeDefined();
  });

  it('camt-tiedostolle ei ole CSV-osaa', () => {
    const e = esikatseleTiliote(fikstuuri('camt053-perus.xml'));
    expect(e).toEqual({ lahde: 'camt053' });
  });

  it('PDF:lle ei ole CSV-osaa', () => {
    expect(esikatseleTiliote(luoTestiPdf(TAPAHTUMAT))).toEqual({ lahde: 'pdf' });
  });

  it('tuntematon tiedosto antaa VAARA_MUOTO-virheen', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(() => esikatseleTiliote(jpeg)).toThrowError(
      expect.objectContaining({ koodi: 'VAARA_MUOTO' }),
    );
    const viesti = (() => {
      try {
        esikatseleTiliote(jpeg);
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    })();
    expect(viesti.match(/camt\.053/g)).toHaveLength(1);
  });
});
