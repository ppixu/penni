import { type Cents, Euro } from '@penni/euro';
import { laskeViite, rfViite, tarkistaIban, tarkistaRfViite } from '@penni/validator';
import { describe, expect, it } from 'vitest';
import { poimiTito } from './tito.js';
import { t00, t10, t11, t11Sepa, t11Valuutta, t40, titoTiedosto } from './tito.testiapu.js';
import { TiliotetiedostoVirhe } from './yhteiset.js';

const e = (s: string): Cents => Euro.fromString(s);

// Keksityt tilinumerot, joiden IBAN-tarkiste on kunnossa.
const OMA_IBAN = 'FI2112345600000785';
const TOINEN_IBAN = 'FI7020010000012349';
const VASTAPUOLEN_IBAN = 'FI6950000010001237';
const VIITE = laskeViite('1234');
const KOKO_TUNNUS = 'FI-TESTI-20261012-0000000012345-A01'; // 35 merkkiä

/** T11/00-lisätietueen data on 35 merkin paloissa. */
const viesti = (teksti: string): string => t11('00', teksti.padEnd(35));

function perustiedosto(): string[] {
  return [
    t00({ alku: '261001', loppu: '261031', alkusaldo: e('1000,00'), iban: OMA_IBAN }),
    t10({
      nro: 1,
      arkisto: '261005ARKISTO0001',
      pvm: '261005',
      maara: e('-49,90'),
      nimi: 'TESTIKAUPPA OY',
    }),
    viesti('Lasku 123'),
    t10({
      nro: 2,
      arkisto: '261012ARKISTO0002',
      pvm: '261012',
      maara: e('250,00'),
      nimi: 'MAIJA MALLI',
      viite: VIITE.padStart(20, '0'),
    }),
    t11Sepa({ iban: VASTAPUOLEN_IBAN, arkistotunnus: KOKO_TUNNUS }),
    t40({ pvm: '261031', saldo: e('1200,10') }),
  ];
}

describe('testiapu', () => {
  it('tuottaa oikean mittaisia tietueita ja kelvollisia fixture-tunnuksia', () => {
    expect(t00({ alku: '261001', loppu: '261031', iban: OMA_IBAN }).length).toBe(322);
    expect(t10({ pvm: '261005', maara: e('1,00') }).length).toBe(188);
    expect(t40({ pvm: '261031', saldo: e('1,00') }).length).toBe(50);
    expect(KOKO_TUNNUS.length).toBe(35);
    for (const iban of [OMA_IBAN, TOINEN_IBAN, VASTAPUOLEN_IBAN])
      expect(tarkistaIban(iban)).toBe(true);
  });
});

describe('poimiTito', () => {
  it('lukee kuukausitiliotteen: kauden, saldot, tapahtumat ja lisätietueet', () => {
    const tiliote = poimiTito(titoTiedosto(perustiedosto()));

    expect(tiliote.lahde).toBe('tito');
    expect(tiliote.muoto).toBe('kuukausitiliote');
    expect(tiliote.kausi).toEqual({ alkaa: '2026-10-01', loppuu: '2026-10-31' });
    expect(tiliote.alkusaldo).toBe(100000);
    expect(tiliote.loppusaldo).toBe(120010);
    // Tiliotteen oma IBAN tulee T00:sta eikä T11/11:n vastapuolen IBAN korvaa sitä.
    expect(tiliote.iban).toBe(OMA_IBAN);
    expect(tiliote.kausiPaatelty).toBeUndefined();
    expect(tiliote.tapahtumat).toEqual([
      {
        pvm: '2026-10-05',
        nimi: 'TESTIKAUPPA OY',
        maara: -4990,
        viesti: 'Lasku 123',
        arkistotunnus: '261005ARKISTO0001',
      },
      {
        pvm: '2026-10-12',
        nimi: 'MAIJA MALLI',
        maara: 25000,
        viite: VIITE,
        iban: VASTAPUOLEN_IBAN,
        arkistotunnus: KOKO_TUNNUS,
      },
    ]);
  });

  it('purkaa erän: kokoomarivi pois ja erittelyrivit mukaan', () => {
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
        t10({ pvm: '261015', maara: e('300,00'), nimi: 'VIITEMAKSUT', taso: 0 }),
        t11('01', '00000003'),
        t10({ pvm: '261015', maara: e('100,00'), nimi: 'ERA YKSI', taso: 1 }),
        t10({ pvm: '261015', maara: e('120,00'), nimi: 'ERA KAKSI', taso: 1 }),
        t10({ pvm: '261015', maara: e('80,00'), nimi: 'ERA KOLME', taso: 1 }),
        t40({ pvm: '261031', saldo: e('300,00') }),
      ]),
    );
    expect(tiliote.tapahtumat.map((t) => [t.nimi, t.maara])).toEqual([
      ['ERA YKSI', 10000],
      ['ERA KAKSI', 12000],
      ['ERA KOLME', 8000],
    ]);
    expect(tiliote.tapahtumat.some((t) => t.viesti?.includes('VIITEMAKSUJA'))).toBe(false);
  });

  it('pitää kokoomarivin, kun erittelyrivien summa ei täsmää siihen', () => {
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
        t10({ pvm: '261015', maara: e('300,00'), nimi: 'VIITEMAKSUT', taso: 0 }),
        t11('01', '00000003'),
        t10({ pvm: '261015', maara: e('100,00'), nimi: 'ERA YKSI', taso: 1 }),
        t10({ pvm: '261015', maara: e('110,00'), nimi: 'ERA KAKSI', taso: 1 }),
        t10({ pvm: '261015', maara: e('80,00'), nimi: 'ERA KOLME', taso: 1 }),
        t40({ pvm: '261031', saldo: e('300,00') }),
      ]),
    );
    expect(tiliote.tapahtumat).toHaveLength(1);
    expect(tiliote.tapahtumat[0]).toMatchObject({
      nimi: 'VIITEMAKSUT',
      maara: 30000,
      viesti: 'VIITEMAKSUJA 3 kpl',
    });
  });

  describe('hylätty erittelyrivi erässä', () => {
    const era = (hylatynSumma: string, ...rivit: string[]): string[] => [
      t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
      t10({ pvm: '261015', maara: e('300,00'), nimi: 'VIITEMAKSUT', taso: 0 }),
      t11('01', '00000003'),
      t10({ pvm: '261015', tunnus: '9', maara: e(hylatynSumma), nimi: 'HYLATTY ERA', taso: 1 }),
      t11('05', ''), // hylätyn rivin lisätietueita ei lueta
      ...rivit,
      t40({ pvm: '261031', saldo: e('300,00') }),
    ];

    it('ei laske erää kahteen kertaan, kun summa täsmää ilman hylättyä riviä', () => {
      const tiliote = poimiTito(
        titoTiedosto(
          era(
            '50,00',
            t10({ pvm: '261015', maara: e('100,00'), nimi: 'ERA YKSI', taso: 1 }),
            t10({ pvm: '261015', maara: e('200,00'), nimi: 'ERA KAKSI', taso: 1 }),
          ),
        ),
      );
      expect(tiliote.tapahtumat.map((t) => [t.nimi, t.maara])).toEqual([
        ['ERA YKSI', 10000],
        ['ERA KAKSI', 20000],
      ]);
    });

    it('pitää kokoomarivin yksin, kun summa ei täsmää, eikä hylättyä riviä lasketa mukaan', () => {
      const tiliote = poimiTito(
        titoTiedosto(
          era(
            '200,00', // jos hylätty laskettaisiin mukaan, summa täsmäisi
            t10({ pvm: '261015', maara: e('100,00'), nimi: 'ERA YKSI', taso: 1 }),
            t10({ pvm: '261015', maara: e('0,00'), nimi: 'ERA KAKSI', taso: 1 }),
          ),
        ),
      );
      expect(tiliote.tapahtumat.map((t) => [t.nimi, t.maara])).toEqual([['VIITEMAKSUT', 30000]]);
    });
  });

  it('ohittaa hylätyn kokoomarivin erittelyrivit (tunnus 9 tasolla 0)', () => {
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
        t10({ pvm: '261015', tunnus: '9', maara: e('300,00'), nimi: 'HYLATTY ERA', taso: 0 }),
        t10({ pvm: '261015', maara: e('100,00'), nimi: 'ERA YKSI', taso: 1 }),
        t10({ pvm: '261015', maara: e('200,00'), nimi: 'ERA KAKSI', taso: 1 }),
        t10({ pvm: '261016', maara: e('-5,00'), nimi: 'TESTIKAUPPA OY', taso: 0 }),
        t40({ pvm: '261031', saldo: e('-5,00') }),
      ]),
    );
    expect(tiliote.tapahtumat.map((t) => [t.nimi, t.maara])).toEqual([['TESTIKAUPPA OY', -500]]);
  });

  it('ohittaa T11/05-tietueen, jonka summa tai valuutta on tyhjä, kaatamatta tiedostoa', () => {
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
        t10({ pvm: '261005', maara: e('-5,70'), nimi: 'KORTTIOSTO TESTIKAUPPA' }),
        t11('05', ''),
        t11('05', '+                  '),
        t40({ pvm: '261031', saldo: e('-5,70') }),
      ]),
    );
    expect(tiliote.tapahtumat).toHaveLength(1);
    expect(tiliote.tapahtumat[0]?.alkuperainen).toBeUndefined();
  });

  it('ohittaa hylätyn tapahtuman (tunnus 9) lisätietueineen', () => {
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
        t10({ pvm: '261005', tunnus: '9', maara: e('-10,00'), nimi: 'HYLATTY OY' }),
        viesti('Hylätty maksu'),
        t10({ pvm: '261006', maara: e('-20,00'), nimi: 'TESTIKAUPPA OY' }),
        t40({ pvm: '261031', saldo: e('-20,00') }),
      ]),
    );
    expect(tiliote.tapahtumat.map((t) => t.nimi)).toEqual(['TESTIKAUPPA OY']);
  });

  it('lukee RF-viitteen T11/00:n ensimmäisestä palasta viitteeksi, ei viestiksi', () => {
    const rf = rfViite(VIITE); // pankin ryhmittelemä, välilyönnein
    expect(tarkistaRfViite(rf)).toBe(true);
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
        t10({ pvm: '261005', maara: e('50,00'), nimi: 'MAIJA MALLI' }),
        viesti(rf),
        t40({ pvm: '261031', saldo: e('50,00') }),
      ]),
    );
    expect(tiliote.tapahtumat[0]?.viite).toBe(rf.replace(/\s/g, ''));
    expect(tiliote.tapahtumat[0]?.viesti).toBeUndefined();
  });

  it('liittää T11/00-palat ja T11/06:n yhdeksi viestiksi', () => {
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
        t10({ pvm: '261005', maara: e('50,00'), nimi: 'MAIJA MALLI' }),
        viesti('Kiitos vuokrasta, tässä'),
        viesti('lokakuun erä'),
        t11('06', 'Toimeksiantajan tieto'),
        t40({ pvm: '261031', saldo: e('50,00') }),
      ]),
    );
    expect(tiliote.tapahtumat[0]?.viesti).toBe(
      'Kiitos vuokrasta, tässä lokakuun erä Toimeksiantajan tieto',
    );
  });

  it('lukee T11/05:n alkuperäiseksi valuuttasummaksi', () => {
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
        t10({ pvm: '261005', maara: e('-5,70'), nimi: 'KORTTIOSTO TESTIKAUPPA' }),
        t11Valuutta(e('-6,26'), 'USD'),
        t40({ pvm: '261031', saldo: e('-5,70') }),
      ]),
    );
    expect(tiliote.tapahtumat[0]?.alkuperainen).toEqual({ valuutta: 'USD', maara: 626 });
  });

  describe('7-bittinen merkistö', () => {
    const tiedosto = (nimi: string, selite: string): string =>
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
        t10({ pvm: '261005', maara: e('-5,00'), nimi }),
        viesti(selite),
        t40({ pvm: '261031', saldo: e('-5,00') }),
      ]);

    it('muuntaa {|} [\\] skandeiksi, kun tiedostossa ei ole oikeita skandeja', () => {
      const t = poimiTito(tiedosto('M[KEL[ OY MY{L{', 'Kiitos t{st{ |ljy \\ }ij ]')).tapahtumat[0];
      expect(t?.nimi).toBe('MÄKELÄ OY MYäLä');
      expect(t?.viesti).toBe('Kiitos tästä öljy Ö åij Å');
    });

    it('jättää aaltosulut rauhaan, kun tiedostossa on jo oikeita skandeja', () => {
      const t = poimiTito(tiedosto('MÄKELÄ OY', 'Viite {abc} t{st{')).tapahtumat[0];
      expect(t?.nimi).toBe('MÄKELÄ OY');
      expect(t?.viesti).toBe('Viite {abc} t{st{');
    });
    it('jättää aaltosulut rauhaan, kun tiedostossa on muu 8-bittinen merkki kuin skandi', () => {
      const t = poimiTito(tiedosto('CAFÉ {BAR} OY', 'Hinta 5 € t{st{')).tapahtumat[0];
      expect(t?.nimi).toBe('CAFÉ {BAR} OY');
      expect(t?.viesti).toBe('Hinta 5 € t{st{');
    });
  });

  it('yhdistää useat T00-lohkot (päiväkohtaiset tiliotteet) ketjutetuin saldoin', () => {
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261001', alkusaldo: e('100,00'), iban: OMA_IBAN }),
        t10({ pvm: '261001', maara: e('-20,00'), nimi: 'TESTIKAUPPA OY' }),
        t40({ pvm: '261001', saldo: e('80,00') }),
        t00({ alku: '261002', loppu: '261002', alkusaldo: e('80,00'), iban: OMA_IBAN }),
        t10({ pvm: '261002', maara: e('30,00'), nimi: 'MAIJA MALLI' }),
        t40({ pvm: '261002', saldo: e('110,00') }),
      ]),
    );
    expect(tiliote.muoto).toBe('kuukausitiliote');
    expect(tiliote.kausi).toEqual({ alkaa: '2026-10-01', loppuu: '2026-10-02' });
    expect(tiliote.alkusaldo).toBe(10000);
    expect(tiliote.loppusaldo).toBe(11000);
    expect(tiliote.iban).toBe(OMA_IBAN);
    expect(tiliote.tapahtumat.map((t) => t.nimi)).toEqual(['TESTIKAUPPA OY', 'MAIJA MALLI']);
  });

  it('hylkää päiväkohtaiset lohkot, joiden saldot eivät ketjuudu', () => {
    const lue = (): unknown =>
      poimiTito(
        titoTiedosto([
          t00({ alku: '261001', loppu: '261001', alkusaldo: e('100,00'), iban: OMA_IBAN }),
          t40({ pvm: '261001', saldo: e('100,00') }),
          t00({ alku: '261003', loppu: '261003', alkusaldo: e('90,00'), iban: OMA_IBAN }),
          t40({ pvm: '261003', saldo: e('90,00') }),
        ]),
      );
    expect(lue).toThrow(TiliotetiedostoVirhe);
  });

  it('hylkää useat T00-lohkot eri IBANeilla', () => {
    const lue = (): unknown =>
      poimiTito(
        titoTiedosto([
          t00({ alku: '261001', loppu: '261001', alkusaldo: e('100,00'), iban: OMA_IBAN }),
          t40({ pvm: '261001', saldo: e('100,00') }),
          t00({ alku: '261002', loppu: '261002', alkusaldo: e('100,00'), iban: TOINEN_IBAN }),
          t40({ pvm: '261002', saldo: e('100,00') }),
        ]),
      );
    expect(lue).toThrow(TiliotetiedostoVirhe);
    expect(lue).toThrow(/tili/i);
  });

  it('merkitsee muiden valuuttojen kuin EUR-tilin virheeksi VALUUTTA', () => {
    try {
      poimiTito(
        titoTiedosto([
          t00({
            alku: '261001',
            loppu: '261031',
            alkusaldo: e('0,00'),
            valuutta: 'USD',
            iban: OMA_IBAN,
          }),
          t40({ pvm: '261031', saldo: e('0,00') }),
        ]),
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TiliotetiedostoVirhe);
      expect((err as TiliotetiedostoVirhe).koodi).toBe('VALUUTTA');
    }
  });

  it('antaa virheestä rivinumeron, kun summa ei ole numeroita', () => {
    const rivit = perustiedosto();
    // Toisen T10:n summakenttä (kohdat 89–106) rikki.
    const rikki = rivit[3] as string;
    rivit[3] = `${rikki.slice(0, 88)}12345678901234567X${rikki.slice(106)}`;
    try {
      poimiTito(titoTiedosto(rivit));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TiliotetiedostoVirhe);
      expect((err as TiliotetiedostoVirhe).koodi).toBe('VAARA_MUOTO');
      expect((err as TiliotetiedostoVirhe).rivi).toBe(4);
    }
  });

  it('hylkää tiedoston, joka ei ala T00-tietueella', () => {
    expect(() => poimiTito(titoTiedosto(perustiedosto().slice(1)))).toThrow(TiliotetiedostoVirhe);
    expect(() => poimiTito('')).toThrow(TiliotetiedostoVirhe);
  });

  it('on immuuni rivinvaihdoille, trimmatuille välilyönneille ja tiedoston lopun SUB-merkille', () => {
    const rivit = perustiedosto();
    const odotettu = poimiTito(titoTiedosto(rivit));

    const lfVainTrimmattu = `${rivit.map((r) => r.trimEnd()).join('\n')}\n\x1A`;
    expect(poimiTito(lfVainTrimmattu)).toEqual(odotettu);

    // Viimeisellä rivillä ei rivinvaihtoa, ei SUB-merkkiä.
    expect(poimiTito(rivit.join('\r\n'))).toEqual(odotettu);
    // SUB heti viimeisen rivin perässä.
    expect(poimiTito(`${rivit.join('\r\n')}\x1A`)).toEqual(odotettu);
    // Pelkkä CR (vanhat Mac-rivinvaihdot).
    expect(poimiTito(`${rivit.join('\r')}\r`)).toEqual(odotettu);
  });

  it('laskee muodon tapahtumiksi, kun tiedostossa ei ole alkusaldoa tai loppusaldoa', () => {
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', iban: OMA_IBAN }),
        t10({ pvm: '261005', maara: e('-5,00'), nimi: 'TESTIKAUPPA OY' }),
      ]),
    );
    expect(tiliote.muoto).toBe('tapahtumat');
    expect(tiliote.alkusaldo).toBeUndefined();
    expect(tiliote.loppusaldo).toBeUndefined();
    expect(tiliote.kausi).toEqual({ alkaa: '2026-10-01', loppuu: '2026-10-31' });
  });

  it('valitsee loppusaldoksi viimeisen kauden loppuun mennessä päivätyn T40:n', () => {
    const tiliote = poimiTito(
      titoTiedosto([
        t00({ alku: '261001', loppu: '261031', alkusaldo: e('0,00'), iban: OMA_IBAN }),
        t40({ pvm: '261015', saldo: e('50,00') }),
        t40({ pvm: '261031', saldo: e('70,00') }),
        t40({ pvm: '261101', saldo: e('999,00') }),
      ]),
    );
    expect(tiliote.loppusaldo).toBe(7000);
  });
});
