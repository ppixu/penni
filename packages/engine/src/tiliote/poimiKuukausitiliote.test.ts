import { type Cents, Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { lueSumma, onkoKuukausitiliote, poimiKuukausitiliote } from './poimiKuukausitiliote.js';
import { poimiTiliotteet } from './poimiTiliotteet.js';

const e = (s: string): Cents => Euro.fromString(s);

// Keksitty kuukausitiliote pdf.js-poiminnan muodossa (rivit hasEOL-lipun mukaan, kentät
// välilyönnein). Nimet ja summat ovat synteettisiä.
const OTSAKE = [
  'Tiliote',
  'ESIMERKKI TMI',
  'Tilinumero FI00 1234 5600 0000 00',
  'Kausi: 01.07.2026 - 31.07.2026',
  'Kirjauspäivä Arvopäivä Saaja/Maksaja Määrä Saldo',
];
const KUUKAUSI = [
  ...OTSAKE,
  '30.06.2026 Saldo 2 000,00',
  '01.07 01.07 PILVIPALVELU* PRO TILAUS -20,00',
  'Korttiosto',
  '412345******1234',
  'EUR 20,00 PILVIPALVELU.EXAMPLE',
  'Arkistointitunnus 260701100200',
  '03.07 03.07 ASIAKAS OY 1 240,00 3 220,00',
  'FI00 9876 5400 0000 00',
  'BIC ESIMFIHH',
  'Viite 1232',
  '10.07 10.07 KOODIPALVELU, INC. -6,12',
  'Korttiosto',
  'USD 6,26 KOODIPALVELU.EXAMPLE',
  'Sivu 1 / 2',
  // Sivunvaihto toistaa otsakkeen.
  ...OTSAKE,
  '15.07 15.07 VEROHALLINTO -300,00',
  'Viite RF18 0000 0000 0000 01',
  'Viesti',
  'Ennakkovero heinäkuu',
  '20.07 21.07 MEIKÄLÄINEN MATTI -1 000,00 1 913,88',
  'Viesti: Yksityisnosto',
  '31.07.2026 Saldo 1 913,88',
  'Sivu 2 / 2',
].join('\n');

describe('lueSumma', () => {
  it('lukee etu- ja takamerkit sekä tuhaterottimet', () => {
    expect(lueSumma('1 234,56')).toBe(e('1234.56'));
    expect(lueSumma('-18,00')).toBe(e('-18.00'));
    expect(lueSumma('18,00-')).toBe(e('-18.00'));
    expect(lueSumma('+5,00')).toBe(e('5.00'));
    expect(lueSumma('12.345,00')).toBe(e('12345.00'));
  });
});

describe('poimiKuukausitiliote', () => {
  const t = poimiKuukausitiliote(KUUKAUSI);

  it('lukee kauden sekä alku- ja loppusaldon', () => {
    expect(t.muoto).toBe('kuukausitiliote');
    expect(t.kausi).toEqual({ alkaa: '2026-07-01', loppuu: '2026-07-31' });
    expect(t.alkusaldo).toBe(e('2000.00'));
    expect(t.loppusaldo).toBe(e('1913.88'));
  });

  it('poimii kaikki tapahtumat sivunvaihdon yli ja täsmää saldoihin', () => {
    expect(t.tapahtumat).toHaveLength(5);
    const summa = t.tapahtumat.reduce((s, x) => s + x.maara, 0);
    expect(summa).toBe((t.loppusaldo ?? 0) - (t.alkusaldo ?? 0));
  });

  it('ottaa vuoden kaudesta, nimen ja etumerkillisen summan (juokseva saldo ei sekoitu)', () => {
    expect(t.tapahtumat[0]).toMatchObject({
      pvm: '2026-07-01',
      nimi: 'PILVIPALVELU* PRO TILAUS',
      maara: e('-20.00'),
    });
    expect(t.tapahtumat[1]).toMatchObject({
      pvm: '2026-07-03',
      nimi: 'ASIAKAS OY',
      maara: e('1240.00'),
      viite: '1232',
    });
  });

  it('lukee alkuperäisen valuuttasumman korttiostosta', () => {
    expect(t.tapahtumat[0]?.alkuperainen).toEqual({ valuutta: 'EUR', maara: e('20.00') });
    expect(t.tapahtumat[2]?.alkuperainen).toEqual({ valuutta: 'USD', maara: e('6.26') });
  });

  it('lukee RF-viitteen ja seuraavalle riville jatkuvan viestin', () => {
    expect(t.tapahtumat[3]).toMatchObject({
      nimi: 'VEROHALLINTO',
      viite: 'RF1800000000000001',
      viesti: 'Ennakkovero heinäkuu',
    });
    expect(t.tapahtumat[4]).toMatchObject({
      pvm: '2026-07-20',
      nimi: 'MEIKÄLÄINEN MATTI',
      maara: e('-1000.00'),
      viesti: 'Yksityisnosto',
    });
  });

  it('erottaa numeroon päättyvän nimen summasta juoksevan saldon avulla', () => {
    const teksti = [
      'Kausi: 01.08.2026 - 31.08.2026',
      '31.07.2026 Saldo 100,00',
      '05.08 05.08 KAUPPA 24 150,00 250,00',
      '31.08.2026 Saldo 250,00',
    ].join('\n');
    const r = poimiKuukausitiliote(teksti);
    expect(r.tapahtumat).toEqual([{ pvm: '2026-08-05', nimi: 'KAUPPA 24', maara: e('150.00') }]);
  });

  it('hakee seuraavalle riville pudonneen summan', () => {
    const teksti = [
      'Kausi: 01.08.2026 - 31.08.2026',
      '31.07.2026 Saldo 100,00',
      '05.08 05.08 KAHVILA',
      '-4,50',
      '31.08.2026 Saldo 95,50',
    ].join('\n');
    expect(poimiKuukausitiliote(teksti).tapahtumat).toEqual([
      { pvm: '2026-08-05', nimi: 'KAHVILA', maara: e('-4.50') },
    ]);
  });

  it('vuodenvaihteen yli menevä kausi: tammikuun päivät seuraavalle vuodelle', () => {
    const teksti = [
      'Kausi: 15.12.2026 - 14.01.2027',
      '14.12.2026 Saldo 10,00',
      '20.12 20.12 A -1,00',
      '05.01 05.01 B -2,00',
      '14.01.2027 Saldo 7,00',
    ].join('\n');
    expect(poimiKuukausitiliote(teksti).tapahtumat.map((x) => x.pvm)).toEqual([
      '2026-12-20',
      '2027-01-05',
    ]);
  });
});

// Keksitty tiliote siinä lohkomuodossa, jonka pdf.js oikeasti tuottaa Nordean kuukausitiliotteesta:
// päiväysrivi (kirjaus + arvopäivä), maksupäivä, tapahtumanumero, nimi, lisätiedot ja vasta
// lopuksi summa (+ juokseva saldo). Loppusaldon määrä on 'Saldo'-rivin jälkeen omalla rivillään.
const LOHKOT = [
  'Sivu 1/2',
  'ESIMERKKI MATTI',
  'Tiliote',
  'Kausi: 01.03.2026 - 31.03.2026   Valuutta: EUR',
  'Kirjaus-',
  'päivä',
  'Arvop',
  'Maksup',
  'Saaja ja tilinumero/Maksaja',
  'Viesti',
  'Määrä   Saldo',
  '28.02.2026   Saldo   1 000,00',
  '02.03   02.03',
  '02.03',
  'Tap.no. 1',
  'ESIMERKKIPALVELU* PRO',
  'Korttiosto',
  '260302111111A11111',
  'USD   12,00 ESIMERKKI.COM',
  '-10,50',
  '05.03   05.03',
  '05.03',
  '2',
  'VEROTOIMISTO',
  'FI0000000000000000',
  'Itsepalvelu',
  'RF1100000000000000',
  '-2 345,60   -1 356,10',
  '1',
  'Sivu 2/2',
  'Tiliote',
  'Kausi: 01.03.2026 - 31.03.2026   Valuutta: EUR',
  'Määrä   Saldo',
  '20.03   20.03',
  '20.03',
  '3',
  'Asiakas Oy',
  'FI0000000000000001',
  '5 000,00   3 643,90',
  '31.03.2026   Saldo',
  'Panot yhteensä',
  'Otot yhteensä',
  '3 643,90',
  '5 000,00',
  '-2 356,10',
].join('\n');

describe('poimiKuukausitiliote — pdf.js-lohkomuoto', () => {
  const t = poimiKuukausitiliote(LOHKOT);

  it('lukee alku- ja loppusaldon (loppusaldon määrä omalla rivillään)', () => {
    expect(t.alkusaldo).toBe(e('1000.00'));
    expect(t.loppusaldo).toBe(e('3643.90'));
  });

  it('poimii tapahtumat lohkoista sivunvaihdon yli ja täsmää saldoihin', () => {
    expect(t.tapahtumat.map((x) => [x.pvm, x.nimi, x.maara])).toEqual([
      ['2026-03-02', 'ESIMERKKIPALVELU* PRO', e('-10.50')],
      ['2026-03-05', 'VEROTOIMISTO', e('-2345.60')],
      ['2026-03-20', 'Asiakas Oy', e('5000.00')],
    ]);
    const summa = t.tapahtumat.reduce((a, x) => a + x.maara, 0);
    expect(summa).toBe((t.loppusaldo ?? 0) - (t.alkusaldo ?? 0));
  });

  it('lukee lohkon lisätiedoista valuuttasumman ja RF-viitteen', () => {
    expect(t.tapahtumat[0]?.alkuperainen).toEqual({ valuutta: 'USD', maara: e('12.00') });
    expect(t.tapahtumat[1]?.viite).toBe('RF1100000000000000');
  });
});

describe('poimiTiliotteet', () => {
  it('tunnistaa kuukausitiliotteen', () => {
    expect(onkoKuukausitiliote(KUUKAUSI)).toBe(true);
    expect(poimiTiliotteet(KUUKAUSI).muoto).toBe('kuukausitiliote');
  });

  it('käsittelee Tapahtumat-luettelon ja lukee sen kauden', () => {
    const teksti = [
      'Tapahtumat 1.4.2026–22.6.2026',
      'Päivämäärä Nimi Viitenumero Määrä',
      '22.6.2026 ASIAKAS OY 1232 1 240,00',
      '16.6.2026 KOODIPALVELU, INC. -6,12',
    ].join('\n');
    const r = poimiTiliotteet(teksti);
    expect(r.muoto).toBe('tapahtumat');
    expect(r.kausi).toEqual({ alkaa: '2026-04-01', loppuu: '2026-06-22' });
    expect(r.tapahtumat).toHaveLength(2);
    expect(r.alkusaldo).toBeUndefined();
  });
});
