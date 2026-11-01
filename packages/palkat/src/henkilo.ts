import type { IsoDate } from '@penni/engine';
import { jasennaPvm } from './pvm.js';

/**
 * Henkilötunnus (DDMMYYCZZZT) ja iästä johtuvat vakuutusvelvollisuudet.
 * Henkilötunnusta ei koskaan lokiteta eikä sitä sisällytetä virheviesteihin.
 */

const TARKISTEMERKIT = '0123456789ABCDEFHJKLMNPRSTUVWXY';

/** Vuosisatamerkki -> vuosisata (DVV: + 1800, -/YXWVU 1900, ABCDEF 2000). */
const VUOSISATA: Record<string, number> = {
  '+': 1800,
  '-': 1900,
  Y: 1900,
  X: 1900,
  W: 1900,
  V: 1900,
  U: 1900,
  A: 2000,
  B: 2000,
  C: 2000,
  D: 2000,
  E: 2000,
  F: 2000,
};

const HETU = /^(\d{2})(\d{2})(\d{2})([+\-YXWVUABCDEF])(\d{3})([0-9A-Y])$/;

function pura(hetu: string) {
  const m = HETU.exec(hetu.trim().toUpperCase());
  if (!m) return null;
  const [, pp, kk, vv, merkki, yksilo, tarkiste] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const vuosi = (VUOSISATA[merkki] as number) + Number(vv);
  const kuukausi = Number(kk);
  const paiva = Number(pp);
  // Päivämäärän on oltava olemassa kalenterissa (karkausvuodet mukaan lukien).
  const d = new Date(Date.UTC(vuosi, kuukausi - 1, paiva));
  if (
    d.getUTCFullYear() !== vuosi ||
    d.getUTCMonth() !== kuukausi - 1 ||
    d.getUTCDate() !== paiva
  ) {
    return null;
  }
  const odotettu = TARKISTEMERKIT[Number(`${pp}${kk}${vv}${yksilo}`) % 31];
  if (odotettu !== tarkiste) return null;
  return { vuosi, kuukausi, paiva };
}

/** Muoto, vuosisatamerkki, kalenteripäivä ja mod-31-tarkistemerkki. */
export function tarkistaHetu(hetu: string): boolean {
  return pura(hetu) !== null;
}

/** Syntymäpäivä ISO-muodossa tai null, jos tunnus ei ole kelvollinen. */
export function syntymapaiva(hetu: string): IsoDate | null {
  const p = pura(hetu);
  if (!p) return null;
  return `${String(p.vuosi).padStart(4, '0')}-${String(p.kuukausi).padStart(2, '0')}-${String(p.paiva).padStart(2, '0')}`;
}

export interface Velvollisuudet {
  /** TyEL-vakuutusvelvollisuus (17 v - yläikäraja 68/69/70). */
  tyel: boolean;
  /** 2025: korotettu työntekijän TyEL-osuus (53-62-vuotiaat); 2026 alkaen ei käytössä. */
  tyel53_62: boolean;
  /** Työntekijän ja työnantajan työttömyysvakuutusmaksu. */
  tvr: boolean;
  /** Työnantajan sairausvakuutusmaksu. */
  sava: boolean;
}

/** Kuukausi absoluuttisena indeksinä (vuosi*12 + kuukausi-1). */
const kk = (v: number, k: number) => v * 12 + (k - 1);

/**
 * Mitkä vakuutukset ja maksut koskevat henkilöä maksupäivänä. Kaikki rajat ovat
 * kalenterikuukausipohjaisia: ratkaisevaa on syntymäpäivän kuukausi, ei päivä.
 * Olkoon S = kuukausi, jona henkilö täyttää N vuotta (syntymäkuukausi + 12·N).
 *
 *  - TyEL: alkaa kuukautta S(17) seuraavan kuukauden alusta ja jatkuu kuukauden S(yläraja) loppuun.
 *    Yläraja 68 (synt. 1957 tai aiemmin), 69 (1958-1961), 70 (1962 tai myöhemmin).
 *    Lähteet: Tulorekisteri, soveltamisohje 2026 (ansiotietoilmoitus), PDF s. 32 (painettu s. 31),
 *    "Earnings-related pension insurance information" (17-68, yläraja syntymävuoden mukaan);
 *    kuukausiraja: Elo, Työnantajan TyEL-vakuutusopas 2026 ("17 vuoden iän täyttämistä seuraavan
 *    kuukauden alusta ja jatkuu sen kuukauden loppuun, jolloin vakuuttamisen yläikäraja täyttyy").
 *  - TyEL 53-62 (vain 2025): kuukautta S(53) seuraavan kuukauden alusta kuukauden S(63) loppuun
 *    (Ilmarinen, TyEL lyhyesti: "53 vuoden täyttämistä seuraavan kuukauden alusta sen kuukauden
 *    loppuun, jona työntekijä täyttää 63 vuotta").
 *  - Työttömyysvakuutus: kuukautta S(18) seuraavan kuukauden alusta kuukauden S(65) loppuun.
 *    Työllisyysrahasto, "Työttömyysvakuutusmaksuvelvollisuus": alaikäraja 18 v 1.8.2022 alkaen,
 *    "maksuvelvollisuus alkaa syntymäpäivää seuraavan kuukauden alusta", 65 vuotta täyttäneellä
 *    "maksuvelvollisuus päättyy syntymäpäivää seuraavan kuukauden alkuun". Sivun yleissääntö
 *    "18 vuotta täyttänyt ja alle 65-vuotias" on tulkittu tämän täsmällisen kuukausirajan mukaan,
 *    eli maksu kuuluu vielä 65-vuotiskuukauden palkoista.
 *  - Sava: kuukautta S(16) seuraavan kuukauden alusta kuukauden S(68) loppuun. Verohallinto
 *    VH/7272/00.01.00/2025 luku 4.2: velvollisuus "alkaa sen kalenterikuukauden jälkeen, jona
 *    työntekijä täyttää 16 vuotta"; maksua ei tarvitse maksaa "sen kalenterikuukauden jälkeen,
 *    jona työntekijä täyttää 68 vuotta".
 */
export function velvollisuudet(syntymapaiva: IsoDate, maksupaiva: IsoDate): Velvollisuudet {
  const s = jasennaPvm(syntymapaiva);
  const m = jasennaPvm(maksupaiva);
  const syntymaKk = kk(s.v, s.k);
  const maksuKk = kk(m.v, m.k);
  /** Maksukuukausi on S(alku):n jälkeen ja enintään S(loppu). */
  const valilla = (alkuIka: number, loppuIka: number) =>
    maksuKk > syntymaKk + 12 * alkuIka && maksuKk <= syntymaKk + 12 * loppuIka;

  const tyelYlaraja = s.v <= 1957 ? 68 : s.v <= 1961 ? 69 : 70;
  return {
    tyel: valilla(17, tyelYlaraja),
    tyel53_62: valilla(53, 63),
    tvr: valilla(18, 65),
    sava: valilla(16, 68),
  };
}
