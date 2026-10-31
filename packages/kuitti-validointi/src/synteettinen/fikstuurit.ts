/**
 * Synteettiset kuittifikstuurit: keksittyä dataa ("Testi Oy"), ei koskaan oikeita kuitteja.
 * Jokaisella fikstuurilla on sivun määrittely (renderöidään PDF:ksi → kuvaksi) ja totuus
 * (pisteytyksen vastaus). Totuus on tässä, ja `totuus.json` generoidaan siitä — testi vahtii ettei
 * tiedosto ja määrittelyt eriä.
 */
import type { PdfLaatikko, PdfSivu, PdfTeksti } from './pdf.js';

/** brutto/alv sentteinä. `null` = asiakirjassa ei ole kyseistä arvoa lainkaan (ei hintaa / tyhjä ALV-rivi). */
export interface SyntTotuus {
  tiedosto: string;
  kuvaus: string;
  pvm: string | null;
  myyja: string;
  brutto: number | null;
  alv: number | null;
}

export type Muoto = 'png' | 'pdf' | 'jpg-exif';

export interface Fikstuuri {
  totuus: SyntTotuus;
  muoto: Muoto;
  sivu: PdfSivu;
  /** Vain `jpg-exif`: orientaatiotagi jonka kuvaan kirjoitetaan (pikselit kierretään vastaavasti). */
  exif?: number;
}

const PAPERI: [number, number, number] = [0.98, 0.98, 0.96];
const PIMEA: [number, number, number] = [0.22, 0.2, 0.19];

/** Pinoaa rivit ylhäältä alas: palauttaa tekstit ja tarvittavan sivukorkeuden. */
function pinoa(
  rivit: readonly string[],
  o: { x: number; fontti: PdfTeksti['fontti']; koko: number; marginaali: number; harmaa?: number },
): { tekstit: PdfTeksti[]; korkeus: number } {
  const rk = o.koko * 1.3;
  const korkeus = Math.ceil(o.marginaali * 2 + rivit.length * rk);
  const tekstit = rivit.flatMap((teksti, i) =>
    teksti === ''
      ? []
      : [
          {
            x: o.x,
            y: korkeus - o.marginaali - o.koko - i * rk,
            teksti,
            fontti: o.fontti,
            koko: o.koko,
            ...(o.harmaa === undefined ? {} : { harmaa: o.harmaa }),
          },
        ],
  );
  return { tekstit, korkeus };
}

/** Kiinteälevyinen rivi: vasen teksti + oikealle tasattu arvo. */
const sarake = (vasen: string, oikea: string, leveys: number): string =>
  vasen + ' '.repeat(Math.max(1, leveys - vasen.length - oikea.length)) + oikea;

/** Kassakuitti-tyylinen kapea Courier-sivu (80 mm). */
function kassa(rivit: readonly string[], leveysMerkkia = 38, koko = 9.5): PdfSivu {
  const leveys = Math.ceil(leveysMerkkia * koko * 0.6 + 24);
  const { tekstit, korkeus } = pinoa(rivit, { x: 12, fontti: 'Courier', koko, marginaali: 16 });
  return {
    leveys,
    korkeus,
    laatikot: [{ x: 0, y: 0, leveys, korkeus, vari: PAPERI }],
    tekstit,
  };
}

const W = 38;

const kauppa: Fikstuuri = {
  totuus: {
    tiedosto: '01-kauppakuitti.png',
    kuvaus: 'suomalainen kauppakuitti, yksi ALV-kanta',
    pvm: '2026-03-14',
    myyja: 'Testi Market Oy',
    brutto: 1655,
    alv: 336,
  },
  muoto: 'png',
  sivu: kassa([
    '       TESTI MARKET OY',
    '    Esimerkkikatu 1, 00100 Helsinki',
    '        Y-tunnus 1234567-1',
    '',
    sarake('Paristot AA 8kpl', '8,90', W),
    sarake('Teippirulla', '3,45', W),
    sarake('Kirjoituskynät 4kpl', '4,20', W),
    '-'.repeat(W),
    sarake('YHTEENSÄ', '16,55', W),
    sarake('Korttimaksu', '16,55', W),
    '',
    sarake('ALV 25,5 %  veroton 13,19', 'vero 3,36', W),
    '',
    '14.03.2026  15:42   Kassa 3',
    '      Kiitos käynnistä!',
  ]),
};

const kahvila: Fikstuuri = {
  totuus: {
    tiedosto: '02-kahvilakuitti.png',
    kuvaus: 'kapea terminen kuitti, yksi ALV-kanta (14 %)',
    pvm: '2026-05-02',
    myyja: 'Testi Kahvila Tmi',
    brutto: 770,
    alv: 95,
  },
  muoto: 'png',
  sivu: kassa(
    [
      '   TESTI KAHVILA TMI',
      '   Torikatu 7, Tampere',
      '',
      '02.05.2026 10:17',
      '',
      sarake('1 x Kahvi', '3,50', 30),
      sarake('1 x Korvapuusti', '4,20', 30),
      '-'.repeat(30),
      sarake('YHT', '7,70 EUR', 30),
      '',
      'ALV 14 %  0,95',
      '',
      'VISA ****1234',
      'Hyväksytty',
    ],
    30,
    10.5,
  ),
};

const monialv: Fikstuuri = {
  totuus: {
    tiedosto: '03-monialv.png',
    kuvaus: 'kolme ALV-kantaa (14 / 25,5 / 10 %) ja ALV-erittely',
    pvm: '2026-06-21',
    myyja: 'Testi Kauppahalli Oy',
    brutto: 5964,
    alv: 864,
  },
  muoto: 'png',
  sivu: kassa([
    '     TESTI KAUPPAHALLI OY',
    '  Hallikatu 2, 20100 Turku',
    '',
    'Pvm 21.06.2026   Kuitti 004518',
    '',
    sarake('Ruokakori', '12,54', W),
    sarake('Kotitaloustarvikkeet', '25,10', W),
    sarake('Kirja: Merikarttoja', '22,00', W),
    '='.repeat(W),
    sarake('YHTEENSÄ', '59,64 EUR', W),
    '',
    'ALV   Netto   Vero   Brutto',
    sarake('14 %', '11,00    1,54   12,54', W),
    sarake('25,5 %', '20,00    5,10   25,10', W),
    sarake('10 %', '20,00    2,00   22,00', W),
    sarake('Yht', '51,00    8,64   59,64', W),
  ]),
};

/** Lasku A4-tyyppiselle sivulle: otsikko- ja arvosarakkeet erikseen, Helvetica. */
function lasku(
  rivit: readonly (readonly [string, string])[],
  o: { otsikko: string; alaotsikko: string[]; fontti?: PdfTeksti['fontti'] },
): PdfSivu {
  const leveys = 420;
  const koko = 11;
  const fontti = o.fontti ?? 'Helvetica';
  const tekstit: PdfTeksti[] = [
    { x: 36, y: 560, teksti: o.otsikko, fontti: 'Helvetica-Bold', koko: 16 },
  ];
  o.alaotsikko.forEach((t, i) => {
    tekstit.push({ x: 36, y: 538 - i * 14, teksti: t, fontti, koko: 9.5 });
  });
  const alku = 538 - o.alaotsikko.length * 14 - 24;
  rivit.forEach(([a, b], i) => {
    const y = alku - i * 20;
    tekstit.push({ x: 36, y, teksti: a, fontti, koko });
    if (b !== '') tekstit.push({ x: 250, y, teksti: b, fontti, koko });
  });
  return {
    leveys,
    korkeus: 595,
    laatikot: [{ x: 0, y: 0, leveys, korkeus: 595, vari: [1, 1, 1] }],
    tekstit,
  };
}

const saas: Fikstuuri = {
  totuus: {
    tiedosto: '04-saas-lasku.png',
    kuvaus: 'ulkomainen (Irlanti) SaaS-lasku, englanniksi, ALV 0 % (reverse charge)',
    pvm: '2026-03-03',
    myyja: 'Sample Cloud Ltd',
    brutto: 12000,
    alv: 0,
  },
  muoto: 'png',
  sivu: lasku(
    [
      ['Invoice number', 'SC-2026-04417'],
      ['Invoice date', 'March 3, 2026'],
      ['Bill to', 'Testi Oy, Helsinki, Finland'],
      ['', ''],
      ['Description', 'Amount'],
      ['Team plan, 5 seats, monthly', 'EUR 120.00'],
      ['', ''],
      ['Subtotal', 'EUR 120.00'],
      ['VAT 0 % (reverse charge)', 'EUR 0.00'],
      ['Total', 'EUR 120.00'],
    ],
    {
      otsikko: 'Invoice from Sample Cloud Ltd',
      alaotsikko: ['1 Example Quay, Dublin, Ireland', 'VAT IE0000000TT'],
    },
  ),
};

const elokuva: Fikstuuri = {
  totuus: {
    tiedosto: '05-elokuvalippu.png',
    kuvaus: 'elokuvalippu ilman hintaa; pitkä tilausnumero houkuttelee keksimään summan',
    pvm: '2026-04-08',
    myyja: 'Testi Teatteri Oy',
    brutto: null,
    alv: null,
  },
  muoto: 'png',
  sivu: kassa(
    [
      '   TESTI TEATTERI OY',
      '   ELOKUVALIPPU',
      '',
      'Elokuva: Merenkulkijan paluu',
      'Näyttely: 08.04.2026 klo 18:30',
      'Sali 2   Rivi 7   Paikat 11-12',
      '',
      'Tilausnumero 48201937560',
      'Lippu 1/2   Lippu 2/2',
      '',
      'Esitys alkaa 18:30, ovet aukeavat',
      '18:10. Lippu on voimassa vain',
      'merkittyyn näyttelyyn.',
    ],
    34,
    10,
  ),
};

const pysakointi: Fikstuuri = {
  totuus: {
    tiedosto: '06-pysakointilippu.png',
    kuvaus: 'pysäköintilippu ilman hintaa, vain aika- ja tunnistetietoja',
    pvm: '2026-05-12',
    myyja: 'Testi Pysäköinti Oy',
    brutto: null,
    alv: null,
  },
  muoto: 'png',
  sivu: kassa(
    [
      ' TESTI PYSÄKÖINTI OY',
      ' Pysäköintilaitos Keskus',
      '',
      'Saapui   12.05.2026  09:14',
      'Poistui  12.05.2026  11:02',
      'Rekisteri ABC-123',
      'Lippu nro 7700228139',
      'Kuitti nro 000417',
      '',
      'Hinta maksetaan poistuttaessa',
      'kassalla tai kuittiautomaatilla.',
    ],
    32,
    10,
  ),
};

const lomake: Fikstuuri = {
  totuus: {
    tiedosto: '07-lomake-alv-tyhja.png',
    kuvaus: 'käsin täytetty lomake, ALV-rivi jätetty tyhjäksi',
    pvm: '2026-02-17',
    myyja: 'Testi Taidevälitys Tmi',
    brutto: 47500,
    alv: null,
  },
  muoto: 'png',
  sivu: lasku(
    [
      ['Pvm', '17.2.2026'],
      ['Myyjä', 'Testi Taidevälitys Tmi'],
      ['Ostaja', 'Matti Meikäläinen'],
      ['', ''],
      ['Kuvaus', 'Maalaus "Meri", 40 x 60 cm'],
      ['Hinta yhteensä', '475,00 EUR'],
      ['', ''],
      ['ALV-kanta', '_______ %'],
      ['ALV-osuus', '_______ EUR'],
      ['', ''],
      ['Maksutapa', 'käteinen'],
      ['Allekirjoitus', 'T. Taiteilija'],
    ],
    { otsikko: 'MYYNTIKUITTI', alaotsikko: ['Taidevälitys, kuittilomake'], fontti: 'Times-Italic' },
  ),
};

const asema: Fikstuuri = {
  totuus: {
    tiedosto: '08-polttoaine.png',
    kuvaus: 'polttoainekuitti, määrä x hinta, yksi ALV-kanta',
    pvm: '2026-01-30',
    myyja: 'Testi Asema Oy',
    brutto: 7824,
    alv: 1590,
  },
  muoto: 'png',
  sivu: kassa([
    '       TESTI ASEMA OY',
    '     Valtatie 9, Jyväskylä',
    '      Y-tunnus 2345678-2',
    '',
    '30.01.2026 07:55  Pumppu 4',
    '',
    'Diesel    41,20 l x 1,899 EUR/l',
    sarake('', '78,24 EUR', W),
    '-'.repeat(W),
    sarake('YHTEENSÄ', '78,24 EUR', W),
    sarake('ALV 25,5 %', '15,90 EUR', W),
    sarake('Veroton', '62,34 EUR', W),
    '',
    'Maksukortti MASTERCARD ****5678',
  ]),
};

const laskuPdf: Fikstuuri = {
  totuus: {
    tiedosto: '09-lasku.pdf',
    kuvaus: 'suomalainen lasku PDF:nä (tekstikerros), tuhaterottimellinen summa',
    pvm: '2026-03-10',
    myyja: 'Testi Konsultointi Oy',
    brutto: 100400,
    alv: 20400,
  },
  muoto: 'pdf',
  sivu: lasku(
    [
      ['Laskun numero', '2026-014'],
      ['Laskun pvm', '10.3.2026'],
      ['Eräpäivä', '24.3.2026'],
      ['Laskuttaja', 'Testi Konsultointi Oy, 3456789-3'],
      ['', ''],
      ['Kuvaus', 'Asiantuntijatyö maaliskuu'],
      ['Veroton hinta', '800,00 EUR'],
      ['ALV 25,5 %', '204,00 EUR'],
      ['Yhteensä', '1 004,00 EUR'],
    ],
    { otsikko: 'LASKU', alaotsikko: ['Testi Konsultointi Oy', 'Asiakas: Testi Oy'] },
  ),
};

/** Valokuvamainen: tumma pöytä, kuitti vinossa keskellä ja kuva tallennettu sivuttain + EXIF 6. */
const valokuva: Fikstuuri = (() => {
  const rivit = [
    '     TESTI KIOSKI OY',
    ' Asemakatu 3, 90100 Oulu',
    '',
    '11.09.2026  16:31',
    '',
    sarake('Aikakauslehti', '5,90', 30),
    sarake('Suklaalevy', '2,20', 30),
    sarake('Juoma 0,5 l', '3,10', 30),
    '-'.repeat(30),
    sarake('YHTEENSÄ', '11,20', 30),
    sarake('ALV 25,5 %', '2,28', 30),
    '',
    '       Kiitos!',
  ];
  const koko = 10.5;
  const paperi = kassa(rivit, 30, koko);
  const reunaX = 50;
  const reunaY = 120;
  const leveys = paperi.leveys + reunaX * 2;
  const korkeus = paperi.korkeus + reunaY * 2;
  const laatikot: PdfLaatikko[] = [
    { x: 0, y: 0, leveys, korkeus, vari: PIMEA },
    { x: reunaX, y: reunaY, leveys: paperi.leveys, korkeus: paperi.korkeus, vari: PAPERI },
  ];
  const tekstit = paperi.tekstit.map((t) => ({ ...t, x: t.x + reunaX, y: t.y + reunaY }));
  return {
    totuus: {
      tiedosto: '10-valokuva-exif.jpg',
      kuvaus:
        'puhelinkuvamainen JPEG: kuitti tummalla pöydällä, tallennettu sivuttain EXIF-orientaatiolla 6',
      pvm: '2026-09-11',
      myyja: 'Testi Kioski Oy',
      brutto: 1120,
      alv: 228,
    },
    muoto: 'jpg-exif',
    exif: 6,
    sivu: { leveys, korkeus, laatikot, tekstit },
  };
})();

export const FIKSTUURIT: readonly Fikstuuri[] = [
  kauppa,
  kahvila,
  monialv,
  saas,
  elokuva,
  pysakointi,
  lomake,
  asema,
  laskuPdf,
  valokuva,
];

export const TOTUUDET: readonly SyntTotuus[] = FIKSTUURIT.map((f) => f.totuus);
