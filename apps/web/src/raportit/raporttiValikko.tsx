import { useRaportti } from '@/app/kysely';
import { Budjettivertailu } from '@/raportit/Budjettivertailu';
import { Kustannuspaikat, Projektit } from '@/raportit/KohdennusRaportti';
import { KuukausiRaportti } from '@/raportit/KuukausiRaportti';
import { Laskut } from '@/raportit/Laskut';
import { Lataustila } from '@/raportit/Lataustila';
import { Paakirja } from '@/raportit/Paakirja';
import { Paivakirja } from '@/raportit/Paivakirja';
import { RaporttiTaulu } from '@/raportit/RaporttiTaulu';
import { TaseErittely } from '@/raportit/TaseErittely';
import { Tililuettelo } from '@/raportit/Tililuettelo';
import { Tositeluettelo } from '@/raportit/Tositeluettelo';
import type { RaporttiProps } from '@/raportit/raporttiProps';
import { KohdennusTyyppi, type RaporttiParams } from '@penni/engine';
import { type ComponentType, useMemo } from 'react';

export interface Raportti {
  avain: string;
  nimi: string;
  /** "Mikä tämä on?" -ohje: mitä raportti näyttää ja mihin sitä käytetään. */
  selite: string;
  /** Tase- tai tuloslaskelmakaavaa käyttävä raportti: 'tase' tai 'tulos'. */
  kaava?: 'tase' | 'tulos';
  /** "Näytä tilit" -valinta (kaavaraportin tilikohtaiset erittelyt). */
  tiliValinta?: boolean;
  /** Tuloslaskelman Kohdennus-suodatin (näkyy vain, kun kirjassa on kohdennuksia). */
  kohdennussuodatin?: boolean;
  /** Näkyy valikossa vain, kun kirjassa on tämän tyypin kohdennus. */
  vaatii?: typeof KohdennusTyyppi.KUSTANNUSPAIKKA | typeof KohdennusTyyppi.PROJEKTI;
  /** Näkymä tulostaa oman otsikkonsa (omat kausi- ja päivävalinnat). */
  omaOtsikko?: boolean;
  /** Tilanne yhtenä päivänä (kauden lopussa): tulosteen otsikossa päivä eikä jakso. */
  tilanneLopussa?: boolean;
  /** Raportin voi rajata tiliin tai tiliryhmään (osoitteen tili/tiliryhma). */
  tilirajaus?: boolean;
  Nakyma: ComponentType<RaporttiProps>;
}

/**
 * Raporttivalikko Kitsaksen järjestyksessä (raporttisivu.cpp:67-112). Kustannuspaikat ja
 * projektit näkyvät vain, kun kirjassa on sellaisia (:78-81); budjettivertailu näkyy aina, koska
 * budjetista on hyötyä ilman kohdennuksiakin. Myynti puuttuu, koska Pennissä ei vielä ole
 * tuoterekisteriä.
 */
export const RAPORTIT: readonly Raportti[] = [
  {
    avain: 'paivakirja',
    nimi: 'Päiväkirja',
    selite:
      'Kaikki kirjaukset aikajärjestyksessä tosite kerrallaan: päivä, tosite, tilit ja summat. Kirjanpitolain vaatima peruskirja, josta näet mitä milloinkin on kirjattu.',
    Nakyma: Paivakirja,
  },
  {
    avain: 'paakirja',
    nimi: 'Pääkirja',
    selite:
      'Kirjaukset tileittäin: jokaisen tilin tapahtumat ja saldo. Tästä näet, mistä tilin saldo koostuu, esim. kun pankkitilin saldo ei täsmää tiliotteeseen. Tilikartan kirja-kuvake avaa pääkirjan yhdelle tilille.',
    tilirajaus: true,
    Nakyma: Paakirja,
  },
  {
    avain: 'tositeluettelo',
    nimi: 'Tositeluettelo',
    selite:
      'Tositteet numerojärjestyksessä: numero, päivä, otsikko ja summa. Osoittaa, ettei numerosarjasta puutu tositteita, ja toimii kirjanpidon sisällysluettelona.',
    Nakyma: Tositeluettelo,
  },
  {
    avain: 'tase',
    nimi: 'Tase',
    selite:
      'Yrityksen taloudellinen tilanne tilikauden lopussa. Vastaavaa = mitä yritys omistaa ja mitä sille ollaan velkaa; vastattavaa = mistä ne on rahoitettu (oma pääoma ja velat). Molempien puolien summa on aina sama.',
    kaava: 'tase',
    tilanneLopussa: true,
    tiliValinta: true,
    Nakyma: KaavaRaportti,
  },
  {
    avain: 'tulos',
    nimi: 'Tuloslaskelma',
    selite:
      'Tilikauden tulot ja kulut ryhmittäin sekä niiden erotus eli voitto tai tappio. Kertoo, kannattiko toiminta kauden aikana.',
    kaava: 'tulos',
    tiliValinta: true,
    kohdennussuodatin: true,
    Nakyma: KaavaRaportti,
  },
  {
    avain: 'tase-kk',
    nimi: 'Tase kuukausittain',
    selite:
      'Tase jokaisen kuukauden lopussa rinnakkain. Näet, miten rahat, saatavat, velat ja oma pääoma kehittyvät kauden mittaan.',
    kaava: 'tase',
    tiliValinta: true,
    Nakyma: KuukausiRaportti,
  },
  {
    avain: 'tulos-kk',
    nimi: 'Tuloslaskelma kuukausittain',
    selite:
      'Tulot ja kulut kuukausi kerrallaan rinnakkain. Näet kausivaihtelun ja sen, minkä kuukauden luvut poikkeavat muista.',
    kaava: 'tulos',
    tiliValinta: true,
    kohdennussuodatin: true,
    Nakyma: KuukausiRaportti,
  },
  {
    avain: 'kustannuspaikat',
    nimi: 'Kustannuspaikat',
    selite:
      'Tuloslaskelma jokaiselle kustannuspaikalle erikseen, projektit mukaan lukien, sekä Yleinen eli kohdentamattomat kirjaukset. Näet esim. juniorijoukkueen tai seurantalon oman tuloksen; osiot yhteensä ovat koko tuloslaskelma.',
    kaava: 'tulos',
    vaatii: KohdennusTyyppi.KUSTANNUSPAIKKA,
    Nakyma: Kustannuspaikat,
  },
  {
    avain: 'projektit',
    nimi: 'Projektit',
    selite:
      'Tuloslaskelma jokaiselle projektille erikseen, esim. kesäleirille tai myyjäisille: kannattiko se? Kustannuspaikka-valinnalla näet vain yhden kustannuspaikan projektit.',
    kaava: 'tulos',
    vaatii: KohdennusTyyppi.PROJEKTI,
    Nakyma: Projektit,
  },
  {
    avain: 'budjettivertailu',
    nimi: 'Budjettivertailu',
    selite:
      'Tilikauden budjetti ja toteutuneet tulot ja kulut rinnakkain. Ero € on negatiivinen, kun toteuma on budjettia huonompi. Valitse päivä, johon asti toteumaa verrataan koko vuoden budjettiin, esim. hallituksen kokousta varten.',
    kaava: 'tulos',
    omaOtsikko: true,
    Nakyma: Budjettivertailu,
  },
  {
    avain: 'tase-erittely',
    nimi: 'Tase-erittely',
    selite:
      'Taseen tilien saldot eriteltyinä tilikauden lopussa: mistä kunkin tilin loppusaldo koostuu, esim. avoimet laskut tai käyttöomaisuus. Tilinpäätökseen kuuluva liite, jota ei julkaista.',
    tilanneLopussa: true,
    Nakyma: TaseErittely,
  },
  {
    avain: 'tililuettelo',
    nimi: 'Tililuettelo',
    selite:
      'Luettelo kirjanpidossa käytetyistä tileistä otsikoineen. Kuuluu kirjanpitoaineistoon, joka säilytetään kirjanpidon mukana.',
    Nakyma: Tililuettelo,
  },
  {
    avain: 'laskut',
    nimi: 'Laskut',
    selite:
      'Myynti- ja ostolaskut eräpäivineen ja maksamatta olevine summineen. Oletuksena vain kauden lopussa avoimet laskut: kuka on sinulle velkaa ja mitä sinun pitää vielä maksaa.',
    Nakyma: Laskut,
  },
];

/**
 * Lajin kaava: yleinen, jos kirjassa on sellainen (Kitsaksen oletus, tasetulosraportti.cpp:154),
 * muuten ensimmäinen lajinsa kaava. Pien-, mikro- ja PMA-kaavat ovat yleisen tiivistelmiä, joten
 * niitä ei tarjota erikseen.
 */
export function kaavaAvain(
  asetukset: Record<string, string>,
  laji: 'tase' | 'tulos',
): string | undefined {
  const avaimet = Object.keys(asetukset)
    .filter((a) => a.startsWith(`${laji}/`))
    .sort();
  return avaimet.includes(`${laji}/yleinen`) ? `${laji}/yleinen` : avaimet[0];
}

/**
 * Tase tai tuloslaskelma kirjan kaavalla; tase kauden lopussa, tuloslaskelma koko kaudelta ja
 * valinnaisesti yhdelle kohdennukselle.
 */
export function KaavaRaportti({ alkupvm, loppupvm, muoto, naytaTilit, kohdennus }: RaporttiProps) {
  const tase = muoto?.startsWith('tase/') ?? false;
  const params: RaporttiParams = muoto
    ? tase
      ? { muoto, pvm: loppupvm, erittelyt: true }
      : {
          muoto,
          pvm: loppupvm,
          alkupvm,
          erittelyt: true,
          ...(kohdennus !== undefined ? { kohdennus } : {}),
        }
    : { muoto: '', pvm: '' };
  // Erittelyt haetaan aina mukaan ja suodatetaan näkymässä, jolloin valinnan vaihto ei käynnistä
  // uutta kyselyä.
  const { data: kaikkiRivit, isError } = useRaportti(params, Boolean(muoto));
  const rivit = useMemo(
    () => (naytaTilit ? kaikkiRivit : kaikkiRivit?.filter((r) => r.tili === undefined)),
    [kaikkiRivit, naytaTilit],
  );
  return rivit ? <RaporttiTaulu rivit={rivit} /> : <Lataustila virhe={isError} />;
}
