import type { Cents } from '@penni/euro';
import type { Kuitti } from '../kuitti/kuitti.js';
import type { IsoDate } from '../vouchers/types.js';
import { type Aliasryhma, merkitsevatSanat, nimetTasmaavat } from './nimi.js';
import type { Tilitapahtuma } from './poimiTiliote.js';

/** Yksi kuitti lähteineen (tiedostonimi tms. tunniste). */
export interface Kuittilahde {
  tiedosto: string;
  kuitti: Kuitti;
}

/**
 * Tapahtuman luokka täsmäytyksessä. 'tasmays' = summa + päiväys täsmää (varma);
 * 'nimitasmays' = myyjän nimi + päiväys täsmää mutta summa ei (todennäköinen, esim.
 * valuuttamuunnos — vaatii tarkistuksen); 'omaPaaoma' = omistajan liike; 'kuittiPuuttuu'.
 */
export type Luokka = 'tasmays' | 'nimitasmays' | 'kuittiPuuttuu' | 'omaPaaoma';

export interface TapahtumaTulos {
  tapahtuma: Tilitapahtuma;
  luokka: Luokka;
  /** Täsmätty kuitti, kun luokka = 'tasmays' tai 'nimitasmays'. */
  kuitti?: Kuittilahde;
}

export interface TasmaysRaportti {
  tapahtumat: TapahtumaTulos[];
  /** Kuitit joille ei löytynyt pankkitapahtumaa. */
  kuititIlmanTapahtumaa: Kuittilahde[];
}

export interface TasmaysAsetukset {
  /**
   * Omistajan nimet tai nimen osat; näiden mukaiset tapahtumat = oman pääoman liikkeitä.
   * Täsmäys tehdään kokonaisina sanoina (ks. `onOmistajanLiike`), ei osamerkkijonona.
   */
  omistajanNimet: string[];
  /** Sallittu päiväysero päivinä tapahtuman ja kuitin välillä (oletus 10). */
  pvmVara?: number;
  /** Aliasryhmät nimitäsmäykseen (esim. brändi ↔ juridinen nimi, ['cursor','anysphere']). */
  vendorAliakset?: readonly Aliasryhma[];
}

/** Kahden ISO-päiväyksen ero päivinä (itseisarvo). */
function paiviaValissa(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = a.split('-').map((x) => Number.parseInt(x, 10));
  const [by, bm, bd] = b.split('-').map((x) => Number.parseInt(x, 10));
  const ms = Date.UTC(ay ?? 0, (am ?? 1) - 1, ad ?? 1) - Date.UTC(by ?? 0, (bm ?? 1) - 1, bd ?? 1);
  return Math.abs(Math.round(ms / 86_400_000));
}

/** Päiväysetäisyys tapahtuman ja kuitin välillä (iso jos kuitilla ei päiväystä → viimeinen valinta). */
function etaisyys(t: Tilitapahtuma, k: Kuittilahde): number {
  return k.kuitti.pvm ? paiviaValissa(t.pvm, k.kuitti.pvm) : 9_999;
}

/**
 * Onko pankkitapahtuma omistajan oma rahaliike. Kaksi ehtoa, molemmat tarpeen:
 *
 * 1. Vertailu tehdään **kokonaisina sanoina** samalla normalisoinnilla kuin nimitäsmäys
 *    (`merkitsevatSanat`), ei osamerkkijonona — osamerkkijono luokittelisi
 *    'MATTILA OY':n omistajaksi sanalla 'matti'.
 * 2. Monisanaisesta omistajanimestä vaaditaan **kaikki** merkitsevät sanat, ei mitä tahansa
 *    yhtä: omistajalla 'Matti Meikäläinen' pelkkä 'MATTI VIRTANEN' ei ole omistajan liike.
 *    Sanajärjestys ei ratkaise, joten 'MEIKÄLÄINEN MATTI' täsmää yhtä lailla.
 *
 * Väärä omaPaaoma-luokitus on kallis: ryhmä on kasassa eikä rivejä esivalita, joten
 * tapahtuma katoaisi käyttäjän silmistä juuri kun hän luulee kauden olevan kirjattu.
 */
function onOmistajanLiike(nimi: string, omistajat: readonly (readonly string[])[]): boolean {
  if (omistajat.length === 0) return false;
  const sanat = new Set(merkitsevatSanat(nimi));
  return omistajat.some((osat) => osat.every((osa) => sanat.has(osa)));
}

/**
 * Täsmäyttää pankkitapahtumat kuitteihin poimitun sisällön perusteella kahdessa vaiheessa:
 * 1) tarkka summa + päiväysikkuna ('tasmays', varma), 2) jäljelle jääneille myyjän nimi +
 * päiväysikkuna ('nimitasmays', todennäköinen — esim. USD-lasku josta pankki veloittaa eurot).
 * Vaihe 1 ratkaistaan kokonaan ennen vaihetta 2, jotta nimipass ei varaa kuittia jonka toinen
 * tapahtuma tarvitsee tarkkaan täsmäykseen. Kukin kuitti käytetään enintään kerran (lähin
 * päiväys voittaa). Omistajan liikkeet ('omaPaaoma') päätellään ennen nimipassia, joten niitä
 * ei nimitäsmätä. Loput jäävät puuttuvaksi kuitiksi.
 */
export function tasmaytaTiliote(
  tapahtumat: Tilitapahtuma[],
  kuitit: Kuittilahde[],
  asetukset: TasmaysAsetukset,
): TasmaysRaportti {
  const pvmVara = asetukset.pvmVara ?? 10;
  // Nimikohtaisina sanalistoina, ei yhtenä joukkona: kaikki-sanat-ehto on nimen sisäinen.
  // Tyhjät pudotetaan, koska every() tyhjälle listalle on tosi ja täsmäisi jokaiseen riviin.
  const omistajat = asetukset.omistajanNimet
    .map((n) => merkitsevatSanat(n))
    .filter((osat) => osat.length > 0);
  const aliakset = asetukset.vendorAliakset ?? [];
  const kaytetyt = new Set<Kuittilahde>();

  const ikkunassa = (t: Tilitapahtuma, k: Kuittilahde): boolean =>
    k.kuitti.pvm === undefined || paiviaValissa(t.pvm, k.kuitti.pvm) <= pvmVara;
  const lahin = (t: Tilitapahtuma, ehdokkaat: Kuittilahde[]): Kuittilahde | undefined =>
    ehdokkaat
      .filter((k) => !kaytetyt.has(k) && ikkunassa(t, k))
      .sort((a, b) => etaisyys(t, a) - etaisyys(t, b))[0];

  // Vaihe 1: tarkka summatäsmäys + omistajan liikkeiden luokittelu.
  const tulokset: TapahtumaTulos[] = tapahtumat.map((tapahtuma) => {
    const maara: number = Math.abs(tapahtuma.maara);
    const osuma = lahin(
      tapahtuma,
      kuitit.filter(
        (k) => k.kuitti.bruttoSumma !== undefined && (k.kuitti.bruttoSumma as Cents) === maara,
      ),
    );
    if (osuma) {
      kaytetyt.add(osuma);
      return { tapahtuma, luokka: 'tasmays', kuitti: osuma };
    }
    if (onOmistajanLiike(tapahtuma.nimi, omistajat)) return { tapahtuma, luokka: 'omaPaaoma' };
    return { tapahtuma, luokka: 'kuittiPuuttuu' };
  });

  // Vaihe 2: nimitäsmäys jäljelle jääneille (summa ei täsmää, esim. valuuttamuunnos).
  for (const tulos of tulokset) {
    if (tulos.luokka !== 'kuittiPuuttuu') continue;
    const osuma = lahin(
      tulos.tapahtuma,
      kuitit.filter(
        (k) =>
          k.kuitti.myyja !== undefined &&
          nimetTasmaavat(tulos.tapahtuma.nimi, k.kuitti.myyja, aliakset),
      ),
    );
    if (osuma) {
      kaytetyt.add(osuma);
      tulos.luokka = 'nimitasmays';
      tulos.kuitti = osuma;
    }
  }

  return { tapahtumat: tulokset, kuititIlmanTapahtumaa: kuitit.filter((k) => !kaytetyt.has(k)) };
}
