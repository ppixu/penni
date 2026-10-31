import { describe, expect, it } from 'vitest';
import { LukuVirhe, lueTiliotePdf } from './lueTiliote.js';
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
