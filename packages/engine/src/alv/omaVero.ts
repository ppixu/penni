import type { Cents } from '@penni/euro';
import { tarkistaYtunnus } from '@penni/validator';
import type { AlvIlmoitus, Kausityyppi } from '../resources/alvIlmoitus.js';
import type { IsoDate } from '../vouchers/types.js';

/**
 * Rahasumma OmaVeron syöttökenttään ja Ilmoitin.fi-aineistoon: desimaalipilkku, aina kaksi
 * desimaalia, ei tuhaterotinta eikä €-merkkiä, negatiivinen ASCII-miinuksella ("-12,30").
 * Sama muoto kuin tietuekuvauksen G13,2 (sähköisen ilmoittamisen yleiskuvaus §3: "Gn,n …
 * desimaalierotin (pilkku) on pakollinen … negatiiviset luvut sallitaan"). OmaVero ja
 * paperilomake 4001 ottavat summat euroina JA sentteinä (lomakkeen sarakkeet "euroa | snt"),
 * joten sentit ilmoitetaan sellaisinaan — ei kokonaiseuropyöristystä.
 */
export function muotoileVeroSumma(c: Cents): string {
  const abs = Math.abs(c);
  const eurot = Math.trunc(abs / 100);
  const sentit = abs % 100;
  return `${c < 0 ? '-' : ''}${eurot},${String(sentit).padStart(2, '0')}`;
}

export interface OmaVeroKentta {
  /** Tietuekuvauksen VSRALVKV tunnus (sama koodi kuin haeAlvLaskelman kartassa). */
  koodi: number;
  /** Kentän nimi OmaVerossa / lomakkeella 4001. */
  nimi: string;
}

export interface OmaVeroRyhma {
  otsikko: string;
  kentat: readonly OmaVeroKentta[];
}

/**
 * OmaVeron arvonlisäveroilmoituksen kentät lomakkeen järjestyksessä ja ryhmittelyssä.
 * Lähteet (tarkistettu 10.10.2026):
 * - https://www.vero.fi/yritykset-ja-yhteisot/tietoa-yritysverotuksesta/arvonlisaverotus/milloin-ilmoitan-ja-maksan/n%C3%A4in-annat-arvonlis%C3%A4veroilmoituksen-omaverossa/
 *   ("Näin ilmoitat arvonlisäveron", päivitetty 1.1.2026; kohdat ja ryhmät tässä järjestyksessä)
 * - https://vero.fi/contentassets/48f889722c1e43f1a4a0589f817e9d95/4001v25-2_ws.pdf
 *   (lomake 4001 v. 2026, kenttien nimet: "25,5 %:n vero", "13,5 %:n vero", …)
 * - Koodit: VSRALVKV-tietuekuvaus v1.10 (27.2.2026), ks. muodostaIlmoitinAineisto.
 * 304/310 (maahantuonti) ovat lomakkeella, vaikka moottori ei niitä laske — ne näkyvät vain,
 * jos koodikartassa on arvo. 308 on OmaVerossa laskettu kenttä (ei syötetä).
 */
export const OMAVERO_LOMAKE: readonly OmaVeroRyhma[] = [
  {
    otsikko: 'Vero kotimaan myynnistä verokannoittain',
    kentat: [
      { koodi: 301, nimi: '25,5 %:n vero' },
      { koodi: 302, nimi: '13,5 %:n vero' },
      { koodi: 303, nimi: '10 %:n vero' },
    ],
  },
  {
    otsikko: 'Vero ostoista ja maahantuonneista',
    kentat: [
      { koodi: 305, nimi: 'Vero tavaraostoista muista EU-maista' },
      { koodi: 306, nimi: 'Vero palveluostoista muista EU-maista' },
      { koodi: 304, nimi: 'Vero tavaroiden maahantuonneista EU:n ulkopuolelta' },
      { koodi: 318, nimi: 'Vero rakentamispalvelun ja metalliromun ostoista' },
    ],
  },
  {
    otsikko: 'Vähennettävä vero',
    kentat: [{ koodi: 307, nimi: 'Verokauden vähennettävä vero' }],
  },
  {
    otsikko: 'Maksettava vero tai palautukseen oikeuttava vero',
    kentat: [{ koodi: 308, nimi: 'Maksettava vero' }],
  },
  {
    otsikko: 'Myynnit, ostot ja maahantuonnit',
    kentat: [
      { koodi: 309, nimi: '0-verokannan alainen liikevaihto' },
      { koodi: 311, nimi: 'Tavaroiden myynnit muihin EU-maihin' },
      { koodi: 312, nimi: 'Palvelujen myynnit muihin EU-maihin' },
      { koodi: 313, nimi: 'Tavaraostot muista EU-maista' },
      { koodi: 314, nimi: 'Palveluostot muista EU-maista' },
      { koodi: 310, nimi: 'Tavaroiden maahantuonnit EU:n ulkopuolelta' },
      { koodi: 319, nimi: 'Rakentamispalvelun ja metalliromun myynnit' },
      { koodi: 320, nimi: 'Rakentamispalvelun ja metalliromun ostot' },
    ],
  },
];

/**
 * Kentät, joille on annettava arvo (myös 0,00), kun pari on annettu: VSRALVKV-tarkistukset
 * #1144 (313 ≠ 0 → 305 ei tyhjä) ja #1146 (314 ≠ 0 → 306 ei tyhjä). Esim. verottomat
 * EU-tavaraostot: 313 täytetään, 305 = 0,00.
 */
const PAKOLLINEN_PARI: ReadonlyMap<number, number> = new Map([
  [305, 313],
  [306, 314],
]);

export interface OmaVeroRivi {
  koodi: number;
  nimi: string;
  arvo: Cents;
  /** Valmiiksi muotoiltu syöte (muotoileVeroSumma). */
  syote: string;
  /** OmaVero laskee kentän itse (308) — näytetään vertailuksi, ei syötetä. */
  laskettu: boolean;
}

export interface OmaVeroRyhmaRivit {
  otsikko: string;
  rivit: OmaVeroRivi[];
}

export interface OmaVeroTayttoapu {
  /** "Ei toimintaa verokaudella" -ilmoitus: kaudella ei yhtään alv-koodia. */
  eiToimintaa: boolean;
  /** Vain ryhmät, joissa on täytettävää; nollailmoituksella tyhjä. */
  ryhmat: OmaVeroRyhmaRivit[];
}

/** Täytettävä arvo kentälle: kartan arvo, pakollinen nolla tai undefined (jätä tyhjäksi). */
function kentanArvo(koodit: ReadonlyMap<number, Cents>, koodi: number): Cents | undefined {
  const arvo = koodit.get(koodi);
  if (arvo !== undefined) return arvo;
  const pari = PAKOLLINEN_PARI.get(koodi);
  if (pari !== undefined && (koodit.get(pari) ?? 0) !== 0) return 0 as Cents;
  return undefined;
}

/**
 * OmaVeron täyttöapu: kauden luvut lomakkeen järjestyksessä, vain täytettävät kentät (tyhjäksi
 * jäävät kentät = nolla, paitsi PAKOLLINEN_PARI). 308 tulee aina maksettava-kentästä ja sen nimi
 * seuraa etumerkkiä (negatiivinen = "Palautukseen oikeuttava vero"); haeAlvLaskelma suodattaa
 * nolla-arvoisen 308:n kartasta, mutta ei-tyhjällä ilmoituksella lopputulos näytetään aina.
 */
export function omaVeroTayttoapu(
  ilmoitus: Pick<AlvIlmoitus, 'koodit' | 'maksettava'>,
): OmaVeroTayttoapu {
  if (ilmoitus.koodit.size === 0) return { eiToimintaa: true, ryhmat: [] };
  const ryhmat: OmaVeroRyhmaRivit[] = [];
  for (const ryhma of OMAVERO_LOMAKE) {
    const rivit: OmaVeroRivi[] = [];
    for (const kentta of ryhma.kentat) {
      if (kentta.koodi === 308) {
        const arvo = ilmoitus.maksettava;
        rivit.push({
          koodi: 308,
          nimi: arvo < 0 ? 'Palautukseen oikeuttava vero' : 'Maksettava vero',
          arvo,
          syote: muotoileVeroSumma(arvo),
          laskettu: true,
        });
        continue;
      }
      const arvo = kentanArvo(ilmoitus.koodit, kentta.koodi);
      if (arvo === undefined) continue;
      rivit.push({ ...kentta, arvo, syote: muotoileVeroSumma(arvo), laskettu: false });
    }
    if (rivit.length > 0) ryhmat.push({ otsikko: ryhma.otsikko, rivit });
  }
  return { eiToimintaa: false, ryhmat };
}

/** Ilmoitin.fi-aineiston verokausitiedot: 050 pituus, 052 kausi (K/Q), 053 vuosi. */
export interface IlmoitinKausi {
  pituus: Kausityyppi;
  kausi?: number;
  vuosi: number;
}

/**
 * Verokausi kalenteriyksikkönä. Vajaa ensimmäinen kausi (AlvAlkaa kesken kuun) ilmoitetaan
 * sen kalenterikuukauden/-neljänneksen/-vuoden kautena, joten vain yksikön sisällä pysyminen
 * tarkistetaan. Rajat ylittävä kausi → null (ei ilmoitettavissa yhdellä tietueella).
 */
export function ilmoitinKausi(
  alkupvm: IsoDate,
  loppupvm: IsoDate,
  pituus: Kausityyppi,
): IlmoitinKausi | null {
  const vuosi = Number(loppupvm.slice(0, 4));
  if (Number(alkupvm.slice(0, 4)) !== vuosi || alkupvm > loppupvm) return null;
  const alkuKk = Number(alkupvm.slice(5, 7));
  const loppuKk = Number(loppupvm.slice(5, 7));
  if (pituus === 'V') return { pituus, vuosi };
  if (pituus === 'K') return alkuKk === loppuKk ? { pituus, kausi: loppuKk, vuosi } : null;
  const neljannes = Math.ceil(loppuKk / 3);
  return Math.ceil(alkuKk / 3) === neljannes ? { pituus, kausi: neljannes, vuosi } : null;
}

export interface IlmoitinPerustiedot {
  /** 010 — ilmoittajan Y-tunnus. */
  ytunnus: string;
  /** 198 — aineiston muodostushetki paikallista aikaa, 'YYYY-MM-DDTHH:MM:SS'. */
  aikaleima: string;
  /** 048 — ohjelmiston nimi (AN35). Oletus 'Penni'. */
  ohjelmisto?: string;
  /** 014 — ohjelmiston yksilöivä tieto Y-TUNNUS_AN2. Oletus `${ytunnus}_PE`: yleiskuvauksen
   *  §8.1 mukaan itse tuotetulla ohjelmistolla käytetään omaa Y-tunnusta + kahta merkkiä. */
  ohjelmistotunniste?: string;
  /** 042 — yhteyshenkilön puhelinnumero (valinnainen). */
  puhelin?: string;
}

/** Aineiston rivinvaihto: ANSI-tekstitiedosto (yleiskuvaus §9: ISO-8859-1, txt = ANSI). */
const RIVINVAIHTO = '\r\n';

/** Tietoluettelon järjestys alv-summille (VSRALVKV §7). 315–317/336/337 päättyivät 12/2024. */
const SUMMAKOODIT: readonly number[] = [
  301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 318, 319, 320,
];

/** Tunnus:tieto-arvo ei saa sisältää rivinvaihtoja; rajataan tulostettavaan ASCIIin, jolloin
 *  UTF-8- ja ISO-8859-1-tavut ovat samat (selaimen Blob kirjoittaa UTF-8:aa). */
function tarkistaTeksti(tunnus: string, arvo: string, maksimi: number): string {
  if (!/^[\x20-\x7e]+$/.test(arvo) || arvo.length > maksimi) {
    throw new Error(`Ilmoitin-aineiston tieto ${tunnus} on virheellinen: "${arvo}"`);
  }
  return arvo;
}

/** 'YYYY-MM-DDTHH:MM:SS' → PPKKVVVVHHMMSS (tieto 198). */
function aikaleima198(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(iso);
  if (m === null) throw new Error(`Ilmoitin-aineiston aikaleima on virheellinen: "${iso}"`);
  const [, v, kk, pp, hh, mi, ss] = m;
  return `${pp}${kk}${v}${hh}${mi}${ss}`;
}

/**
 * Ilmoitin.fi-aineisto "Veroilmoitus oma-aloitteisista veroista, arvonlisäveron tiedot"
 * (tietovirta VSRALVKV, tunnus:tieto-muoto). Puhdas sarjallistus — ei verkkoa; käyttäjä
 * lähettää tiedoston itse Ilmoitin.fi-palvelussa.
 *
 * Lähteet (tarkistettu 10.10.2026):
 * - Tietuekuvaus VSRALVKV v1.10 (27.2.2026):
 *   https://www.vero.fi/contentassets/ef5905e0f5b74bcba89aa9ba9c34015d/verohallinto_tietuekuvaus_vsralvkv_290824.pdf
 * - Sähköisen ilmoittamisen yleiskuvaus v6.12 (13.2.2026; tunnus:tieto-muoto, G13,2, 014, merkistö):
 *   https://vero.fi/globalassets/tietoa-verohallinnosta/ohjelmistokehittajille/verohallinto_s%C3%A4hk%C3%B6isen-ilmoittamisen-yleiskuvaus.pdf
 *
 * Sisältö: 000, 198, 048, 014, 010, 050, (052), 053; nollailmoituksella 056:1, muuten
 * kartan summat + aina 308 (#1924: 308 = verot − 307) + pakolliset nollat (#1144/#1146);
 * (042); 999:1. 049 (sanomatunniste) on välityspalvelun täyttämä, joten sitä ei anneta.
 * Legacy (ilmoitintuottaja.cpp) haki 014:n Kitsas-pilvestä — se oli vain Kitsas Oy:n
 * Y-tunnus + tarkiste, ei viranomaisen myöntämä koodi.
 */
export function muodostaIlmoitinAineisto(
  ilmoitus: Pick<AlvIlmoitus, 'alkupvm' | 'loppupvm' | 'kausityyppi' | 'koodit' | 'maksettava'>,
  perustiedot: IlmoitinPerustiedot,
): string {
  const ytunnus = perustiedot.ytunnus.trim();
  if (!tarkistaYtunnus(ytunnus) || !/^\d{7}-\d$/.test(ytunnus)) {
    throw new Error(`Y-tunnus on virheellinen: "${perustiedot.ytunnus}"`);
  }
  const kausi = ilmoitinKausi(ilmoitus.alkupvm, ilmoitus.loppupvm, ilmoitus.kausityyppi);
  if (kausi === null) {
    throw new Error(
      `Kausi ${ilmoitus.alkupvm} – ${ilmoitus.loppupvm} ei ole yksi kuukausi, neljännes tai vuosi`,
    );
  }
  const ohjelmistotunniste = perustiedot.ohjelmistotunniste ?? `${ytunnus}_PE`;
  if (!/^\d{7}-\d_[\x21-\x7e]{2}$/.test(ohjelmistotunniste)) {
    throw new Error(`Ohjelmiston tunniste (014) on virheellinen: "${ohjelmistotunniste}"`);
  }

  const rivit: string[] = [
    '000:VSRALVKV',
    `198:${aikaleima198(perustiedot.aikaleima)}`,
    `048:${tarkistaTeksti('048', perustiedot.ohjelmisto ?? 'Penni', 35)}`,
    `014:${ohjelmistotunniste}`,
    `010:${ytunnus}`,
    `050:${kausi.pituus}`,
  ];
  if (kausi.kausi !== undefined) rivit.push(`052:${kausi.kausi}`);
  rivit.push(`053:${kausi.vuosi}`);

  if (ilmoitus.koodit.size === 0) {
    rivit.push('056:1');
  } else {
    for (const koodi of SUMMAKOODIT) {
      const arvo = koodi === 308 ? ilmoitus.maksettava : kentanArvo(ilmoitus.koodit, koodi);
      if (arvo !== undefined) rivit.push(`${koodi}:${muotoileVeroSumma(arvo)}`);
    }
  }
  if (perustiedot.puhelin !== undefined && perustiedot.puhelin.trim() !== '') {
    rivit.push(`042:${tarkistaTeksti('042', perustiedot.puhelin.trim(), 35)}`);
  }
  rivit.push('999:1');
  // Ei rivinvaihtoa viimeisen tiedon perään (yleiskuvaus §2.1: ei ylimääräisiä rivinvaihtoja).
  return rivit.join(RIVINVAIHTO);
}
