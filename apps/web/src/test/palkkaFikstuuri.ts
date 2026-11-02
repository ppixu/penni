import type { PalkkaAjoLuonnos } from '@/palkat/tallennaPalkkaAjo';
import type { Cents } from '@penni/euro';
import type { PalkatAsetukset, Tyontekija } from '@penni/palkat';
import type { MemorySeed } from '@penni/storage-memory';

/*
 * Palkkatestien yhteinen aineisto. Kaikki henkilöt ovat keksittyjä; henkilötunnusten
 * yksilönumerot ovat 900–999 (testitunnukset) ja tarkistemerkki lasketaan.
 */

const TARKISTEMERKIT = '0123456789ABCDEFHJKLMNPRSTUVWXY';

/** Testitunnus: `ppkkvv` + vuosisatamerkki + yksilönumero 900–999 + laskettu tarkiste. */
export function testiHetu(ppkkvv: string, merkki: string, yksilo: string): string {
  return `${ppkkvv}${merkki}${yksilo}${TARKISTEMERKIT[Number(`${ppkkvv}${yksilo}`) % 31]}`;
}

const c = (n: number) => n as Cents;

/** Tapaus A: kuukausipalkka 3 000 €, puhelinetu, verokortti 20 % / 40 %, tuloraja 30 000 €. */
export const TYONTEKIJA_A: Tyontekija = {
  id: 'a1b2c3d4',
  nimi: 'Testinen Aino',
  hetu: testiHetu('010190', '-', '900'),
  osoite: { katu: 'Kokeilukuja 1', postinumero: '00100', kaupunki: 'Helsinki' },
  iban: 'FI2112345600000785',
  vakuutusperuste: 'tyontekija',
  ammattikoodi: '41100',
  palkkamuoto: 'kuukausi',
  kuukausipalkka: c(300_000),
  puhelinetu: true,
  verokortit: [
    {
      alkaa: '2026-01-01',
      paattyy: '2026-12-31',
      perusBp: 2000,
      lisaBp: 4000,
      tuloraja: c(3_000_000),
      aiemminMaksettu: c(0),
    },
  ],
  aktiivinen: true,
};

/** Toinen henkilö: kuukausipalkka 2 000 €, ei puhelinetua, verokortti 10 %. */
export const TYONTEKIJA_B: Tyontekija = {
  id: 'e5f6g7h8',
  nimi: 'Kokeilija Pekka',
  hetu: testiHetu('150575', '-', '931'),
  vakuutusperuste: 'tyontekija',
  ammattikoodi: '41100',
  palkkamuoto: 'kuukausi',
  kuukausipalkka: c(200_000),
  puhelinetu: false,
  verokortit: [
    {
      alkaa: '2026-01-01',
      paattyy: '2026-12-31',
      perusBp: 1000,
      lisaBp: 3000,
      tuloraja: c(4_000_000),
      aiemminMaksettu: c(0),
    },
  ],
  aktiivinen: true,
};

export const PALKAT_ASETUKSET: PalkatAsetukset = {
  tyelYhtio: '55',
  tyelSopimus: '5512345',
  tilapainenTyonantaja: false,
  tvrVapautus: false,
  yhteyshenkilo: { nimi: 'Testi Teuvo', puhelin: '0401234567' },
};

const tili = (numero: number, tyyppi: string, nimi: string) => ({
  numero,
  tyyppi,
  nimi: { fi: nimi },
});

/** Yritystilikartan palkkatilit (PALKKATILIT_OLETUS) + pankkitili nettopalkoille. */
export const PALKKATILIT_KARTTA = [
  tili(1910, 'ARP', 'Pankkitili'),
  tili(2920, 'BV', 'Verovelka (oma-aloitteiset verot)'),
  tili(2931, 'BS', 'TyEL-velka'),
  tili(2965, 'B', 'Työttömyysvakuutusmaksuvelka'),
  tili(5000, 'D', 'Palkat'),
  tili(5110, 'D', 'Lisät'),
  tili(5440, 'D', 'Luontoisedut'),
  tili(5990, 'D', 'Luontoisetujen vastatili'),
  tili(6130, 'D', 'TyEL-maksut'),
  tili(6300, 'D', 'Sairausvakuutusmaksut'),
  tili(6410, 'D', 'Työttömyysvakuutusmaksut'),
  tili(7870, 'D', 'Kilometrikorvaukset'),
  tili(7880, 'D', 'Päivärahat'),
  tili(7910, 'D', 'Ateriakorvaukset'),
  tili(8380, 'D', 'Muut kulut'),
];

/** Kirja, jossa on palkkarekisteri, palkka-asetukset ja maksutili (MP = 1910). */
export function palkkaSiemen(asetukset: Record<string, string> = {}): MemorySeed {
  return {
    tilit: PALKKATILIT_KARTTA,
    tilikaudet: [
      { alkaa: '2026-01-01', loppuu: '2026-12-31' },
      { alkaa: '2027-01-01', loppuu: '2027-12-31' },
    ],
    asetukset: {
      Nimi: 'Testi Oy',
      Ytunnus: '1234567-1',
      LaskuMaksutili: '1910',
      tositesarjat: JSON.stringify({ '500': 'P', '*': 'JT' }),
      PalkatTyontekijat: JSON.stringify([TYONTEKIJA_A, TYONTEKIJA_B]),
      PalkatAsetukset: JSON.stringify(PALKAT_ASETUKSET),
      ...asetukset,
    },
  };
}

/** Tapaus A: 31.10.2026, kuukausipalkka + puhelinetu + 100 km. Netto 2 203,66 €. */
export function luonnosA(maksupaiva = '2026-10-31'): PalkkaAjoLuonnos {
  const [v, k] = maksupaiva.split('-');
  return {
    maksupaiva,
    kausiAlkaa: `${v}-${k}-01`,
    kausiLoppuu: maksupaiva,
    syotteet: [
      {
        tyontekijaId: TYONTEKIJA_A.id,
        rivit: [
          { laji: 'kuukausipalkka', selite: 'Palkka 10/2026', summa: c(300_000) },
          { laji: 'puhelinetu', selite: 'Puhelinetu 10/2026' },
          { laji: 'km', selite: 'Helsinki–Espoo asiakaskäynti', maara: 10_000 },
        ],
      },
    ],
  };
}
