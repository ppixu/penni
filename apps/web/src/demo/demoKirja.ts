import { valmisteleAlvTilitys } from '@/app/kysely';
import { type KirjanpitoSyote, luoKirjanpidonSiemen } from '@/client/luoSiemen';
import { luoPaikallinenClient } from '@/client/makeClient';
import type { KpClient } from '@penni/asiakas';
import {
  AlvKoodi,
  type IsoDate,
  type Kuitti,
  type Kuittilahde,
  type Tili,
  type Tiliote,
  type Tilitapahtuma,
  TositeTila,
  TositeTyyppi,
  type TositeVienti,
  generoiVeroviennit,
  lataaKartta,
  nettoBrutosta,
  normalisoiNimi,
  poimiKuittiTekstista,
} from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';
import { luoKuittiPdf } from './kuittiPdf.js';

/**
 * Demokirjanpito: kuvitteellinen pieni suunnittelutoimisto, tilikausi 2026. Kaikki rakennetaan
 * moottorin kautta (KpClient) — numerointi, ALV-viennit ja tilitykset syntyvät samoin kuin
 * käyttäjän omassa kirjassa. Kaikki nimet, tunnukset ja summat ovat keksittyjä.
 */

export const DEMO_SYOTE: KirjanpitoSyote = {
  nimi: 'Demokirjat Oy',
  muoto: 'oy',
  alvVelvollinen: true,
  kausiAlkaa: '2026-01-01',
  kausiLoppuu: '2026-12-31',
};

const PANKKI = 1910;
const VEROVELKA = 2920;
const PALVELUMAKSU = 8560;
const KORTTI = '**** 4417';

/** Täsmäytysdemon aineisto: tapahtumaluettelo ja "kuittikansio", jota kirjassa ei vielä ole. */
export interface DemoAineisto {
  tiliote: Tiliote & { tiedosto: string };
  kuitit: Kuittilahde[];
  /** Kaikki demon tiedostot nimellä: tapahtumaluettelo ja kansion kuitit. */
  tiedostot: Map<string, Uint8Array>;
}

// ---------------------------------------------------------------------------------------------
// Muotoilu (kuitit ovat tekstiä: pdf.js lukee ne ja poimiKuittiTekstista jäsentää)

function eurot(c: number): string {
  const etumerkki = c < 0 ? '-' : '';
  const a = Math.abs(c);
  const kokonaiset = String(Math.trunc(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${etumerkki}${kokonaiset},${String(a % 100).padStart(2, '0')}`;
}

function pvmFi(iso: IsoDate): string {
  const [v, k, p] = iso.split('-');
  return `${p}.${k}.${v}`;
}

function sarakkeet(vasen: string, oikea: string, leveys = 34): string {
  return `${vasen}${' '.repeat(Math.max(1, leveys - vasen.length - oikea.length))}${oikea}`;
}

function snt(euroa: string): Cents {
  return Euro.fromString(euroa);
}

interface Myyja {
  nimi: string;
  ytunnus: string;
  osoite: string;
}

interface KuittiSyote {
  myyja: Myyja;
  pvm: IsoDate;
  klo: string;
  tuotteet: [string, Cents][];
  alv: number;
  otsikko?: string;
}

function kuitinRivit(k: KuittiSyote): string[] {
  const brutto = k.tuotteet.reduce((a, [, s]) => a + s, 0) as Cents;
  const netto = nettoBrutosta(brutto, k.alv);
  return [
    k.myyja.nimi.toUpperCase(),
    k.myyja.osoite,
    `Y-tunnus ${k.myyja.ytunnus}`,
    '',
    k.otsikko ?? 'KUITTI',
    `Päiväys ${pvmFi(k.pvm)} klo ${k.klo}`,
    '',
    ...k.tuotteet.map(([nimi, s]) => sarakkeet(nimi, eurot(s))),
    '-'.repeat(34),
    sarakkeet('Veroton', eurot(netto)),
    sarakkeet(`Alv ${String(k.alv).replace('.', ',')} %`, eurot(brutto - netto)),
    sarakkeet('Yhteensä EUR', eurot(brutto)),
    '',
    `KORTTI ${KORTTI}`,
    'Kiitos käynnistä!',
  ];
}

function laskunRivit(
  myyja: Myyja,
  pvm: IsoDate,
  erapvm: IsoDate,
  numero: string,
  selite: string,
  netto: Cents,
  alv: number,
): string[] {
  const vero = Math.round((netto * alv) / 100);
  return [
    myyja.nimi,
    myyja.osoite,
    `Y-tunnus ${myyja.ytunnus}`,
    '',
    `LASKU ${numero}`,
    `Laskun päiväys ${pvmFi(pvm)}`,
    `Eräpäivä ${pvmFi(erapvm)}`,
    '',
    'Asiakas: Demokirjat Oy',
    '',
    sarakkeet(selite, eurot(netto), 48),
    '-'.repeat(48),
    sarakkeet('Veroton', eurot(netto), 48),
    sarakkeet(`Alv ${String(alv).replace('.', ',')} %`, eurot(vero), 48),
    sarakkeet('Yhteensä EUR', eurot(netto + vero), 48),
  ];
}

// ---------------------------------------------------------------------------------------------
// Kumppanit (kaikki keksittyjä; Y-tunnusten tarkisteet ovat kelvollisia)

const ASIAKKAAT = {
  kaupunki: {
    nimi: 'Kaupunki Studio Oy',
    alvtunnus: 'FI32014474',
    osoite: 'Tehtaankatu 14 B',
    postinumero: '00140',
    kaupunki: 'Helsinki',
    email: 'laskut@kaupunkistudio.example',
  },
  lumi: {
    nimi: 'Lumi Analytics Oy',
    alvtunnus: 'FI29147380',
    osoite: 'Keilaranta 9',
    postinumero: '02150',
    kaupunki: 'Espoo',
    email: 'ostolaskut@lumianalytics.example',
  },
  saaristo: {
    nimi: 'Saaristomatkat Oy',
    alvtunnus: 'FI30588212',
    osoite: 'Linnankatu 31',
    postinumero: '20100',
    kaupunki: 'Turku',
  },
  paahto: {
    nimi: 'Kahvila Pieni Paahto Oy',
    alvtunnus: 'FI28765435',
    osoite: 'Hämeenkatu 7',
    postinumero: '33100',
    kaupunki: 'Tampere',
  },
  kulma: {
    nimi: 'Vihreä Kulma Ay',
    alvtunnus: 'FI33129054',
    osoite: 'Aleksanterinkatu 22',
    postinumero: '15140',
    kaupunki: 'Lahti',
  },
} as const;

// biome-ignore format: taulukko luetaan riveittäin
const TOIMITTAJAT = {
  tyotila: { nimi: 'Työtila Kallio Oy', ytunnus: '2457719-7', osoite: 'Fleminginkatu 5, 00530 Helsinki' },
  pilvikone: { nimi: 'Pilvikone Oy', ytunnus: '1987364-5', osoite: 'Ratapihantie 11, 00520 Helsinki' },
  linkki: { nimi: 'Linkki Mobiili Oy', ytunnus: '3090017-3', osoite: 'Valimotie 2, 00380 Helsinki' },
  datakauppa: { nimi: 'Datakauppa Oy', ytunnus: '3145678-0', osoite: 'Konepajankatu 3, 00510 Helsinki' },
  junat: { nimi: 'Junamatkat Pohjola Oy', ytunnus: '2233445-8', osoite: 'Asemaaukio 1, 00100 Helsinki' },
  ravintola: { nimi: 'Ravintola Pieni Penni', ytunnus: '3399001-2', osoite: 'Fredrikinkatu 24, 00120 Helsinki' },
  paperi: { nimi: 'Toimistotukku Paperi Oy', ytunnus: '2601987-7', osoite: 'Tiilitie 6, 01720 Vantaa' },
  oppi: { nimi: 'Kurssikeskus Oppi Oy', ytunnus: '3011223-0', osoite: 'Kaisaniemenkatu 2, 00100 Helsinki' },
  musta: { nimi: 'Painotalo Musta Oy', ytunnus: '3201447-4', osoite: 'Sörnäisten rantatie 9, 00500 Helsinki' },
  taksi: { nimi: 'Taksi Sininen Oy', ytunnus: '2914738-0', osoite: 'Hakaniemenranta 3, 00530 Helsinki' },
  sivu: { nimi: 'Kirjakauppa Sivu Oy', ytunnus: '3058821-2', osoite: 'Eerikinkatu 4, 00100 Helsinki' },
  lumo: { nimi: 'Kuvapankki Lumo Oy', ytunnus: '2876543-5', osoite: 'Lapinlahdenkatu 16, 00180 Helsinki' },
  pysakointi: { nimi: 'Pysäköinti Keskusta Oy', ytunnus: '3312905-4', osoite: 'Kampinkuja 2, 00100 Helsinki' },
} satisfies Record<string, Myyja>;

type ToimittajaAvain = keyof typeof TOIMITTAJAT;

/** Myyjäkohtaiset menotilisäännöt: kuitinluku ja täsmäytys ehdottavat näitä tilejä. */
const MENOTILIT: Partial<Record<ToimittajaAvain, number>> = {
  pilvikone: 7660,
  linkki: 8500,
  datakauppa: 7680,
  junat: 7800,
  taksi: 7800,
  ravintola: 7830,
  paperi: 8620,
  oppi: 8340,
  musta: 8050,
  sivu: 8450,
  lumo: 8050,
  pysakointi: 8680,
};

// ---------------------------------------------------------------------------------------------
// Vuoden tapahtumat

/** Myyntilaskut: [laskupäivä, asiakas, [selite, kpl, á netto €][], maksupäivä | null]. */
// biome-ignore format: taulukko luetaan riveittäin
const MYYNTILASKUT: [IsoDate, keyof typeof ASIAKKAAT, [string, number, number][], IsoDate | null][] = [
  ['2026-01-05', 'kaupunki', [['Ylläpito ja jatkokehitys, tammikuu', 1, 2400]], '2026-01-16'],
  ['2026-01-19', 'lumi', [['Raporttinäkymien suunnittelu', 46, 95]], '2026-02-02'],
  ['2026-02-02', 'kaupunki', [['Ylläpito ja jatkokehitys, helmikuu', 1, 2400]], '2026-02-13'],
  ['2026-02-16', 'paahto', [['Verkkokaupan ilme ja tuotesivut', 1, 4200]], '2026-03-03'],
  ['2026-03-02', 'kaupunki', [['Ylläpito ja jatkokehitys, maaliskuu', 1, 2400]], '2026-03-13'],
  ['2026-03-16', 'saaristo', [['Varausjärjestelmän käyttöliittymä', 62, 95], ['Käytettävyystestaus', 1, 900]], '2026-04-01'],
  ['2026-04-01', 'kaupunki', [['Ylläpito ja jatkokehitys, huhtikuu', 1, 2400]], '2026-04-14'],
  ['2026-04-20', 'lumi', [['Mobiilisovelluksen prototyyppi', 58, 95]], '2026-05-05'],
  ['2026-05-04', 'kaupunki', [['Ylläpito ja jatkokehitys, toukokuu', 1, 2400]], '2026-05-15'],
  ['2026-05-18', 'kulma', [['Logo ja visuaalinen ilme', 1, 2800], ['Verkkosivupohja', 1, 1600]], '2026-06-04'],
  ['2026-06-01', 'kaupunki', [['Ylläpito ja jatkokehitys, kesäkuu', 1, 2400]], '2026-06-12'],
  ['2026-06-15', 'saaristo', [['Kesäkampanjan laskeutumissivut', 34, 95]], '2026-06-30'],
  ['2026-06-30', 'kaupunki', [['Palvelumuotoiluprojekti, vaihe 1', 1, 9880.88]], '2026-07-14'],
  ['2026-07-06', 'kaupunki', [['Ylläpito ja jatkokehitys, heinäkuu', 1, 2400]], '2026-07-17'],
  ['2026-08-03', 'kaupunki', [['Ylläpito ja jatkokehitys, elokuu', 1, 2400]], '2026-08-14'],
  ['2026-08-17', 'lumi', [['Analytiikkanäkymien jatkokehitys', 52, 95]], '2026-09-01'],
  ['2026-08-24', 'paahto', [['Kanta-asiakassovelluksen suunnittelu', 40, 95]], '2026-09-08'],
  ['2026-09-01', 'kaupunki', [['Ylläpito ja jatkokehitys, syyskuu', 1, 2400]], '2026-09-11'],
  ['2026-09-15', 'saaristo', [['Talvikauden varaussivut', 28, 95]], null],
  ['2026-09-21', 'kulma', [['Verkkokaupan laajennus', 1, 3200]], '2026-10-06'],
  ['2026-10-01', 'kaupunki', [['Ylläpito ja jatkokehitys, lokakuu', 1, 2400]], '2026-10-13'],
  ['2026-10-12', 'lumi', [['Saavutettavuusauditointi', 36, 95]], null],
  ['2026-10-26', 'paahto', [['Kanta-asiakassovellus, toteutuksen tuki', 24, 95]], null],
];

/** Satunnaiset kortti-/tilisiirtokulut kuitteineen: [pvm, klo, toimittaja, tili, alv %, otsikko, tuotteet]. */
// biome-ignore format: taulukko luetaan riveittäin
const KULUT: [IsoDate, string, ToimittajaAvain, number, number, string, [string, string][]][] = [
  ['2026-01-20', '14:12', 'datakauppa', 7680, 25.5, 'Näytönohjain ja telakka', [['Telakka USB-C', '149,00'], ['HDMI-kaapeli 2 m', '19,90']]],
  ['2026-02-11', '07:41', 'junat', 7800, 13.5, 'Junaliput Tampere, asiakastapaaminen', [['Helsinki-Tampere-Helsinki', '68,40']]],
  ['2026-02-11', '12:41', 'ravintola', 7830, 13.5, 'Lounas asiakkaan kanssa', [['Lounas', '12,45'], ['Lounas', '12,45']]],
  ['2026-03-18', '10:05', 'paperi', 8620, 25.5, 'Toimistotarvikkeet', [['Muistikirjat 5 kpl', '34,50'], ['Tussit', '18,90'], ['Tulostinpaperi', '33,00']]],
  ['2026-04-07', '09:00', 'oppi', 8340, 25.5, 'Saavutettavuuskoulutus', [['Kurssi: WCAG 2.2 käytännössä', '450,00']]],
  ['2026-05-14', '15:30', 'musta', 8050, 25.5, 'Käyntikortit ja esitteet', [['Käyntikortit 500 kpl', '89,00'], ['Esite A5 250 kpl', '231,00']]],
  ['2026-06-02', '23:14', 'taksi', 7800, 13.5, 'Taksi asiakastilaisuudesta', [['Taksimatka', '36,80']]],
  ['2026-06-18', '11:20', 'paperi', 8620, 25.5, 'Toimistotarvikkeet', [['Tulostinmuste', '64,90'], ['Kirjekuoret', '21,50']]],
  ['2026-08-21', '16:48', 'datakauppa', 7680, 25.5, 'Näyttö', [['Näyttö 27" 4K', '349,00']]],
  ['2026-09-09', '06:55', 'junat', 7800, 13.5, 'Junaliput Turku, asiakastapaaminen', [['Helsinki-Turku-Helsinki', '52,20']]],
  ['2026-09-09', '12:15', 'ravintola', 7830, 13.5, 'Lounas asiakkaan kanssa', [['Päivän lounas', '15,75'], ['Päivän lounas', '15,75']]],
  ['2026-09-24', '17:02', 'sivu', 8450, 13.5, 'Alan kirjallisuus', [['Muotoilun käsikirja', '45,90']]],
  ['2026-10-08', '13:37', 'datakauppa', 7680, 25.5, 'Testipuhelin', [['Puhelin (testilaite)', '279,00']]],
];

/** Kuittilaatikon luonnokset (luettu valmiiksi, odottavat kirjausta). */
// biome-ignore format: taulukko luetaan riveittäin
const LUONNOKSET: [IsoDate, string, ToimittajaAvain, number, number, string, [string, string][]][] = [
  ['2026-10-28', '12:41', 'ravintola', 7830, 13.5, 'Lounas, Ravintola Pieni Penni', [['Lounas', '12,45'], ['Lounas', '12,45']]],
  ['2026-10-29', '10:12', 'datakauppa', 7680, 25.5, 'Näppäimistö ja kaapeli, Datakauppa', [['Näppäimistö', '129,00'], ['USB-C-kaapeli', '19,90'], ['Toimitus', '40,10']]],
  ['2026-10-30', '18:22', 'taksi', 7800, 13.5, 'Taksi, Taksi Sininen', [['Taksimatka', '28,60']]],
];

/** Tapahtumaluettelon rivit, joita kirjassa ei vielä ole (täsmäytettäviksi). */
// biome-ignore format: taulukko luetaan riveittäin
const KIRJAAMATTOMAT_KORTTIOSTOT: [IsoDate, string, ToimittajaAvain, [string, string][], boolean][] = [
  // [pvm, klo, toimittaja, tuotteet, onko kuitti kansiossa]
  ['2026-10-20', '09:14', 'lumo', [['Kuvalisenssi, 3 kuvaa', '29,00']], true],
  ['2026-10-22', '15:03', 'pysakointi', [['Pysäköinti 2 h', '14,40']], true],
  ['2026-10-27', '07:30', 'junat', [['Helsinki-Tampere', '46,90']], false],
];

// ---------------------------------------------------------------------------------------------

function paivaa(iso: IsoDate, n: number): IsoDate {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function kk(n: number): string {
  return String(n).padStart(2, '0');
}

// biome-ignore format: taulukko luetaan riveittäin
const KUUKAUDET = [
  'tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu',
  'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu',
];

/**
 * Rakentaa demokirjanpidon annettuun (tyhjään, DEMO_SYOTE:lla siemennettyyn) kirjaan ja palauttaa
 * täsmäytysdemon aineiston. Tapahtumat kirjataan aikajärjestyksessä, joten tositenumerot
 * juoksevat päivämäärien mukaan ja ALV-kaudet tilitetään kauden päätyttyä kuten oikeasti.
 */
export async function rakennaDemokirja(client: KpClient): Promise<DemoAineisto> {
  await client.paivitaAsetukset({
    Ytunnus: '3184562-0',
    Osoite: 'Lönnrotinkatu 11 A 5',
    Postinumero: '00120',
    Kaupunki: 'Helsinki',
    Kotipaikka: 'Helsinki',
    Email: 'hei@demokirjat.example',
    Puhelin: '040 123 4567',
    Kotisivu: 'demokirjat.example',
    LaskuIban: 'FI6015723500087654',
    AlvKausi: '3',
    LaskuSaatavaTili: '1701',
    LaskuMaksutili: String(PANKKI),
    AlvVelkaTili: '2939',
    OstoVelkaTili: '2871',
    TasmaysMenotiliSaannot: JSON.stringify(
      Object.entries(MENOTILIT).map(([avain, tili]) => ({
        hae: normalisoiNimi(TOIMITTAJAT[avain as ToimittajaAvain].nimi),
        tili,
      })),
    ),
  });

  const init = await client.haeInit();
  const chart: Tili[] = lataaKartta(init.tilit);

  const kumppaniId = new Map<string, number>();
  for (const [avain, a] of Object.entries(ASIAKKAAT)) {
    kumppaniId.set(avain, (await client.tallennaKumppani({ ...a })).id);
  }
  for (const [avain, t] of Object.entries(TOIMITTAJAT)) {
    const [katu, postiKaupunki = ''] = t.osoite.split(', ');
    const [postinumero, kaupunki] = postiKaupunki.split(' ');
    kumppaniId.set(
      avain,
      (
        await client.tallennaKumppani({
          nimi: t.nimi,
          alvtunnus: `FI${t.ytunnus.replace('-', '')}`,
          ...(katu ? { osoite: katu } : {}),
          ...(postinumero ? { postinumero } : {}),
          ...(kaupunki ? { kaupunki } : {}),
        })
      ).id,
    );
  }

  /** Kaikki pankkitilin liikkeet aikajärjestyksessä — tapahtumaluettelo rakennetaan näistä. */
  const pankki: Tilitapahtuma[] = [];
  const avausSaldo = snt('24 600,00');

  // Tapahtumat ajetaan päivämäärän mukaan: jokainen kirjaus on sulkeuma, jonka avain on pvm.
  const tapahtumat: { pvm: IsoDate; jarjestys: number; aja: () => Promise<void> }[] = [];
  let jarjestys = 0;
  const ajoita = (pvm: IsoDate, aja: () => Promise<void>) =>
    tapahtumat.push({ pvm, jarjestys: jarjestys++, aja });

  const liita = async (tosite: number, nimi: string, rivit: string[], leveys?: number) => {
    await client.tallennaLiite({
      tosite,
      nimi,
      tyyppi: 'application/pdf',
      luotu: '2026-10-31T09:00:00.000Z',
      data: luoKuittiPdf(rivit, leveys),
    });
  };

  /** Menon viennit bruttosummasta: kulutili + vähennettävä ALV, vastatilinä pankki. */
  const menonViennit = (
    pvm: IsoDate,
    tili: number,
    alv: number,
    brutto: Cents,
    selite: string,
  ): TositeVienti[] => [
    ...generoiVeroviennit(
      [
        {
          tili,
          alvKoodi: alv > 0 ? AlvKoodi.OSTOT_NETTO : AlvKoodi.EIALV,
          alvProsentti: alv,
          maara: brutto,
          bruttoSyotto: true,
          puoli: 'debet',
          pvm,
          selite,
        },
      ],
      chart,
    ),
    {
      tili: PANKKI,
      debet: 0 as Cents,
      kredit: brutto,
      pvm,
      alvKoodi: 0,
      alvProsentti: 0,
      selite,
    },
  ];

  // --- Tilinavaus: edellisen tilikauden päättävät saldot -----------------------------------
  ajoita('2026-01-01', async () => {
    await client.luoTilinavaus({
      pvm: '2026-01-01',
      saldot: [
        { tili: PANKKI, saldo: avausSaldo },
        { tili: 2001, saldo: snt('2 500,00') },
        { tili: VEROVELKA, saldo: snt('3 855,60') }, // joulukuun palkkaverot + Q4/2025 alv
        { tili: 2251, saldo: snt('18 244,40') },
      ],
    });
  });

  // --- Myyntilaskut ja niiden suoritukset --------------------------------------------------
  for (const [pvm, asiakas, rivit, maksettu] of MYYNTILASKUT) {
    const kumppani = kumppaniId.get(asiakas);
    let laskuId = 0;
    let summa = 0 as Cents;
    ajoita(pvm, async () => {
      const lasku = await client.tallennaMyyntilasku({
        pvm,
        laskupvm: pvm,
        erapvm: paivaa(pvm, 14),
        ...(kumppani !== undefined ? { kumppani } : {}),
        otsikko: rivit[0]?.[0] ?? 'Lasku',
        rivit: rivit.map(([selite, kpl, aNetto]) => ({
          myyntiKpl: kpl,
          aNetto,
          alvKoodi: AlvKoodi.MYYNNIT_NETTO,
          alvProsentti: 25.5,
          selite,
          unKoodi: kpl > 1 ? 'HUR' : 'C62',
        })),
      });
      laskuId = lasku.id;
      summa = lasku.viennit.find((v) => v.tili === 1701)?.debet ?? (0 as Cents);
    });
    if (maksettu) {
      ajoita(maksettu, async () => {
        const lasku = await client.haeTosite(laskuId);
        await client.tallennaSuoritus({
          tosite: laskuId,
          pvm: maksettu,
          summa,
          rahatili: PANKKI,
          otsikko: `Maksu: ${ASIAKKAAT[asiakas].nimi}, lasku ${lasku?.numero ?? ''}`,
        });
        pankki.push({
          pvm: maksettu,
          nimi: ASIAKKAAT[asiakas].nimi,
          maara: summa,
          ...(lasku?.viite ? { viite: lasku.viite } : {}),
        });
      });
    }
  }

  // --- Kuukausittaiset kulut ---------------------------------------------------------------
  const palkkaverot = new Map<number, Cents>();
  for (let m = 1; m <= 10; m++) {
    const kuu = KUUKAUDET[m - 1] ?? '';

    // Työtilan vuokra ostolaskuna 1. päivä, maksu eräpäivänä.
    const vuokraPvm: IsoDate = `2026-${kk(m)}-01`;
    const vuokraEra: IsoDate = `2026-${kk(m)}-14`;
    let vuokraId = 0;
    let vuokraSumma = 0 as Cents;
    ajoita(vuokraPvm, async () => {
      const kumppani = kumppaniId.get('tyotila');
      const lasku = await client.tallennaOstolasku({
        pvm: vuokraPvm,
        laskupvm: vuokraPvm,
        erapvm: vuokraEra,
        ...(kumppani !== undefined ? { kumppani } : {}),
        otsikko: `Työpistevuokra, ${kuu}`,
        rivit: [
          {
            myyntiKpl: 1,
            aNetto: 480,
            alvKoodi: AlvKoodi.OSTOT_NETTO,
            alvProsentti: 25.5,
            tili: 7230,
            selite: `Työpistevuokra, ${kuu}`,
          },
        ],
      });
      vuokraId = lasku.id;
      vuokraSumma = lasku.viennit.find((v) => v.tili === 2871)?.kredit ?? (0 as Cents);
      await liita(
        lasku.id,
        `tyotila-kallio-lasku-${kk(m)}-2026.pdf`,
        laskunRivit(
          TOIMITTAJAT.tyotila,
          vuokraPvm,
          vuokraEra,
          `2026-${kk(m)}`,
          `Työpistevuokra, ${kuu}`,
          snt('480,00'),
          25.5,
        ),
        400,
      );
    });
    ajoita(vuokraEra, async () => {
      await client.tallennaSuoritus({
        tosite: vuokraId,
        pvm: vuokraEra,
        summa: vuokraSumma,
        rahatili: PANKKI,
        otsikko: `Maksu: ${TOIMITTAJAT.tyotila.nimi}, työpistevuokra ${kuu}`,
      });
      pankki.push({ pvm: vuokraEra, nimi: TOIMITTAJAT.tyotila.nimi, maara: -vuokraSumma as Cents });
    });

    // Kuukausitilaukset kortilla, kuitti liitteenä.
    // biome-ignore format: taulukko luetaan riveittäin
    const tilaukset: [number, string, ToimittajaAvain, number, string, [string, string][]][] = [
      [3, '06:02', 'pilvikone', 7660, `Ohjelmistotilaukset, ${kuu}`, [['Suunnittelutyökalu 2 lisenssiä', '48,00'], ['Pilvitallennus 2 Tt', '15,20']]],
      [5, '04:10', 'linkki', 8500, `Puhelinliittymä, ${kuu}`, [['Mobiililiittymä 5G', '39,90']]],
    ];
    for (const [paiva, klo, toimittaja, tili, otsikko, tuotteet] of tilaukset) {
      kortti([`2026-${kk(m)}-${kk(paiva)}`, klo, toimittaja, tili, 25.5, otsikko, tuotteet]);
    }

    // Palkka 25. päivä: johdon palkka, TyEL ja sairausvakuutusmaksu; verot OmaVeroon.
    const palkkaPvm: IsoDate = `2026-${kk(m)}-25`;
    ajoita(palkkaPvm, async () => {
      const brutto = snt('3 500,00');
      const ennakonpidatys = snt('875,00');
      const tyel = snt('609,00');
      const sava = snt('40,60');
      const netto = (brutto - ennakonpidatys) as Cents;
      const selite = `Palkka, ${kuu}`;
      const v = (tili: number, debet: number, kredit: number): TositeVienti => ({
        tili,
        debet: debet as Cents,
        kredit: kredit as Cents,
        pvm: palkkaPvm,
        alvKoodi: 0,
        alvProsentti: 0,
        selite,
      });
      await client.luoTosite({
        pvm: palkkaPvm,
        tyyppi: TositeTyyppi.PALKKA,
        tila: TositeTila.KIRJANPIDOSSA,
        sarja: '',
        otsikko: selite,
        viennit: [
          v(5600, brutto, 0),
          v(6130, tyel, 0),
          v(6300, sava, 0),
          v(PANKKI, 0, netto + tyel),
          v(VEROVELKA, 0, ennakonpidatys + sava),
        ],
      });
      palkkaverot.set(m, (ennakonpidatys + sava) as Cents);
      pankki.push({ pvm: palkkaPvm, nimi: 'Palkat ja TyEL', maara: -(netto + tyel) as Cents });
    });

    // Pankin palvelumaksu kuun viimeisenä päivänä (ei alv:ia, ei kuittia).
    const palveluPvm: IsoDate = paivaa(`2026-${kk(m + 1)}-01`, -1);
    ajoita(palveluPvm, async () => {
      const maksu = snt('8,50');
      await client.luoTosite({
        pvm: palveluPvm,
        tyyppi: TositeTyyppi.MENO,
        tila: TositeTila.KIRJANPIDOSSA,
        sarja: '',
        otsikko: `Pankin palvelumaksu, ${kuu}`,
        viennit: menonViennit(palveluPvm, PALVELUMAKSU, 0, maksu, 'Palvelumaksu'),
      });
      pankki.push({ pvm: palveluPvm, nimi: 'Palvelumaksu', maara: -maksu as Cents });
    });

    // Oma-aloitteiset verot 12. päivä: edellisen kuun palkkaverot (+ neljännesvuoden alv).
    const veroPvm: IsoDate = `2026-${kk(m)}-12`;
    ajoita(veroPvm, async () => {
      let maksettava: number = m === 1 ? snt('915,60') : (palkkaverot.get(m - 1) ?? 0);
      if (m === 2) maksettava += snt('2 940,00'); // Q4/2025 alv avaussaldosta
      const alv = alvVelat.get(m);
      if (alv) maksettava += alv;
      const selite = 'OmaVero-maksu';
      await client.luoTosite({
        pvm: veroPvm,
        tyyppi: TositeTyyppi.SIIRTO,
        tila: TositeTila.KIRJANPIDOSSA,
        sarja: '',
        otsikko: `Oma-aloitteiset verot, maksu ${pvmFi(veroPvm)}`,
        viennit: [
          {
            tili: VEROVELKA,
            debet: maksettava as Cents,
            kredit: 0 as Cents,
            pvm: veroPvm,
            alvKoodi: 0,
            alvProsentti: 0,
            selite,
          },
          {
            tili: PANKKI,
            debet: 0 as Cents,
            kredit: maksettava as Cents,
            pvm: veroPvm,
            alvKoodi: 0,
            alvProsentti: 0,
            selite,
          },
        ],
      });
      pankki.push({
        pvm: veroPvm,
        nimi: 'Verohallinto',
        viite: 'RF3931845620',
        maara: -maksettava as Cents,
      });
    });
  }

  // --- Satunnaiset kulut kuitteineen -------------------------------------------------------
  function kortti([pvm, klo, toimittaja, tili, alv, otsikko, tuotteet]: (typeof KULUT)[number]) {
    ajoita(pvm, async () => {
      const myyja = TOIMITTAJAT[toimittaja];
      const rivit = tuotteet.map(([n, s]) => [n, snt(s)] as [string, Cents]);
      const brutto = rivit.reduce((a, [, s]) => a + s, 0) as Cents;
      const kumppani = kumppaniId.get(toimittaja);
      const t = await client.luoTosite({
        pvm,
        tyyppi: TositeTyyppi.MENO,
        tila: TositeTila.KIRJANPIDOSSA,
        sarja: '',
        otsikko,
        ...(kumppani !== undefined ? { kumppani } : {}),
        viennit: menonViennit(pvm, tili, alv, brutto, otsikko),
      });
      await liita(
        t.id,
        `kuitti-${toimittaja}-${pvm}.pdf`,
        kuitinRivit({ myyja, pvm, klo, tuotteet: rivit, alv }),
      );
      pankki.push({ pvm, nimi: myyja.nimi, maara: -brutto as Cents });
    });
  }
  for (const kulu of KULUT) kortti(kulu);

  // --- ALV-kaudet: Q1 ja Q2 tilitetty ja maksettu, Q3 odottaa ilmoitusta --------------------
  const alvVelat = new Map<number, Cents>(); // maksukuukausi -> maksettava alv
  for (const [alkupvm, loppupvm, maksuKk] of [
    ['2026-01-01', '2026-03-31', 5],
    ['2026-04-01', '2026-06-30', 8],
  ] as const) {
    ajoita(loppupvm, async () => {
      const params = { alkupvm, loppupvm };
      await valmisteleAlvTilitys(client, params);
      const tilitys = await client.tallennaAlvTilitys(params);
      const velka = tilitys.viennit
        .filter((v) => v.tili === VEROVELKA)
        .reduce((a, v) => a + v.kredit - v.debet, 0);
      if (velka > 0) alvVelat.set(maksuKk, velka as Cents);
    });
  }

  // Aikajärjestykseen; saman päivän sisällä ajoitusjärjestyksessä, joten kauden viimeisen päivän
  // ALV-tilitys (ajoitettu viimeisenä) näkee kaikki kauden kirjaukset.
  tapahtumat.sort((a, b) => (a.pvm < b.pvm ? -1 : a.pvm > b.pvm ? 1 : a.jarjestys - b.jarjestys));
  for (const t of tapahtumat) await t.aja();

  // --- Kuittilaatikko: luetut luonnokset odottavat kirjausta --------------------------------
  for (const [pvm, klo, toimittaja, tili, alv, otsikko, tuotteet] of LUONNOKSET) {
    const myyja = TOIMITTAJAT[toimittaja];
    const rivit = tuotteet.map(([n, s]) => [n, snt(s)] as [string, Cents]);
    const brutto = rivit.reduce((a, [, s]) => a + s, 0) as Cents;
    const kumppani = kumppaniId.get(toimittaja);
    const t = await client.luoTosite({
      pvm,
      tyyppi: TositeTyyppi.MENO,
      tila: TositeTila.LUONNOS,
      sarja: '',
      otsikko,
      ...(kumppani !== undefined ? { kumppani } : {}),
      viennit: menonViennit(pvm, tili, alv, brutto, otsikko),
    });
    await liita(
      t.id,
      `kuitti-${toimittaja}-${pvm}.pdf`,
      kuitinRivit({ myyja, pvm, klo, tuotteet: rivit, alv }),
    );
  }

  return rakennaTasmaysAineisto(pankki, avausSaldo);
}

/** Lokakuun tapahtumaluettelo (1.–27.10.) ja kuittikansio täsmäytysnäkymälle. */
function rakennaTasmaysAineisto(kirjatut: Tilitapahtuma[], avausSaldo: Cents): DemoAineisto {
  const alkaa: IsoDate = '2026-10-01';
  const loppuu: IsoDate = '2026-10-27';
  const tiedostot = new Map<string, Uint8Array>();
  const kuitit: Kuittilahde[] = [];

  const lisat: Tilitapahtuma[] = [];
  for (const [pvm, klo, toimittaja, tuotteet, kansiossa] of KIRJAAMATTOMAT_KORTTIOSTOT) {
    const myyja = TOIMITTAJAT[toimittaja];
    const rivit = tuotteet.map(([n, s]) => [n, snt(s)] as [string, Cents]);
    const brutto = rivit.reduce((a, [, s]) => a + s, 0) as Cents;
    lisat.push({ pvm, nimi: myyja.nimi, maara: -brutto as Cents });
    if (!kansiossa) continue;
    const tiedosto = `kuitti-${toimittaja}-${pvm}.pdf`;
    const teksti = kuitinRivit({ myyja, pvm, klo, tuotteet: rivit, alv: 25.5 });
    tiedostot.set(tiedosto, luoKuittiPdf(teksti));
    const luettu = poimiKuittiTekstista(teksti.join('\n'));
    const kuitti: Kuitti = luettu.ok ? luettu.kuitti : { valuutta: 'EUR', alv: [] };
    kuitit.push({ tiedosto, kuitti });
  }

  const ennen = kirjatut.filter((t) => t.pvm < alkaa).reduce((a, t) => a + t.maara, 0);
  const alkusaldo = (avausSaldo + ennen) as Cents;
  const tapahtumat = [...kirjatut.filter((t) => t.pvm >= alkaa && t.pvm <= loppuu), ...lisat].sort(
    (a, b) => (a.pvm < b.pvm ? -1 : a.pvm > b.pvm ? 1 : 0),
  );
  const loppusaldo = (alkusaldo + tapahtumat.reduce((a, t) => a + t.maara, 0)) as Cents;

  const tiedosto = 'tapahtumat-2026-10.pdf';
  tiedostot.set(
    tiedosto,
    luoKuittiPdf(
      [
        'Demopankki — tapahtumaluettelo',
        'Demokirjat Oy, FI60 1572 3500 0876 54',
        `Kausi ${pvmFi(alkaa)} - ${pvmFi(loppuu)}`,
        '',
        ...tapahtumat.map((t) => {
          const [v, k, p] = t.pvm.split('-');
          const nimi = t.viite ? `${t.nimi} ${t.viite}` : t.nimi;
          return sarakkeet(`${Number(p)}.${Number(k)}.${v}  ${nimi}`, eurot(t.maara), 76);
        }),
        '',
        sarakkeet('Saldo kauden alussa', eurot(alkusaldo), 76),
        sarakkeet('Saldo kauden lopussa', eurot(loppusaldo), 76),
      ],
      560,
    ),
  );

  return {
    tiliote: {
      muoto: 'tapahtumat',
      kausi: { alkaa, loppuu },
      alkusaldo,
      loppusaldo,
      tapahtumat,
      tiedosto,
    },
    kuitit,
    tiedostot,
  };
}

/** Esimerkkikuitti, jonka vierailija voi pudottaa Uusi tosite -lomakkeelle. */
export function esimerkkikuitti(): { nimi: string; data: Uint8Array } {
  const myyja = TOIMITTAJAT.paperi;
  return {
    nimi: 'esimerkkikuitti-toimistotukku.pdf',
    data: luoKuittiPdf(
      kuitinRivit({
        myyja,
        pvm: '2026-10-31',
        klo: '11:05',
        tuotteet: [
          ['Muistilaput 12 kpl', snt('14,90')],
          ['Kuulakärkikynät 10 kpl', snt('9,50')],
          ['Arkistokotelot 5 kpl', snt('22,40')],
        ],
        alv: 25.5,
      }),
    ),
  };
}

export interface DemoKirja {
  client: KpClient;
  aineisto: DemoAineisto;
}

/** Uusi muistikirja demon siemenellä: jokainen käynti (ja Palauta demo) alkaa samasta tilasta. */
export async function luoDemokirja(): Promise<DemoKirja> {
  const client = luoPaikallinenClient(luoKirjanpidonSiemen(DEMO_SYOTE));
  const aineisto = await rakennaDemokirja(client);
  return { client, aineisto };
}
