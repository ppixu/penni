import { AlvKoodi } from './koodit.js';

/** Mistä osto/myynti on: Suomi, muu EU-maa vai EU:n ulkopuoli. */
export type Alkupera = 'kotimaa' | 'eu' | 'muu';

/** MAAHANTUONTI (kitsas.h:40) ja MAAHANTUONTI_VERO (kitsas.h:50) — ei Penni-valittavissa,
 *  mutta tuoduissa Kitsas-kirjoissa voi esiintyä. */
const MAAHANTUONTI = 27;
const MAAHANTUONTI_VERO = 927;

/**
 * Viennin alv-koodin alkupera. Vero-/vähennys-/kohdentamaton-viennit (+100/+200/+400) luokitellaan
 * peruskoodinsa mukaan. Semantiikka Kitsasin alv-laskelmasta (alvlaskelma.cpp):
 *  - yhteisömyynti/-hankinta (14/15/24/25) = muut EU-maat (rivit 305-306, 311-314)
 *  - maahantuonti (27/29/927) = EU:n ulkopuolelta (rivit 304, 310)
 *  - rakentamispalvelut (16/26) ovat kotimaan käännettyä verovelvollisuutta (rivit 318-320)
 * ALV0 (19) ei luokittele: 0-verokannan liikevaihto (rivi 309) kattaa myös viennin EU:n
 * ulkopuolelle. Veroton (0), tilitys (901) ja vähennyskelvoton (932) eivät myöskään.
 */
export function alkuperaKoodista(koodi: number): Alkupera | undefined {
  if (koodi === MAAHANTUONTI_VERO) return 'muu';
  const sadat = Math.floor(koodi / 100);
  if (sadat !== 0 && sadat !== 1 && sadat !== 2 && sadat !== 4) return undefined;
  switch (koodi % 100) {
    case AlvKoodi.MYYNNIT_NETTO:
    case AlvKoodi.MYYNNIT_BRUTTO:
    case AlvKoodi.MYYNNIT_MARGINAALI:
    case AlvKoodi.OSTOT_NETTO:
    case AlvKoodi.OSTOT_BRUTTO:
    case AlvKoodi.OSTOT_MARGINAALI:
    case AlvKoodi.MAKSUPERUSTEINEN_MYYNTI:
    case AlvKoodi.MAKSUPERUSTEINEN_OSTO:
    case AlvKoodi.RAKENNUSPALVELU_MYYNTI:
    case AlvKoodi.RAKENNUSPALVELU_OSTO:
      return 'kotimaa';
    case AlvKoodi.YHTEISOMYYNTI_TAVARAT:
    case AlvKoodi.YHTEISOMYYNTI_PALVELUT:
    case AlvKoodi.YHTEISOHANKINNAT_TAVARAT:
    case AlvKoodi.YHTEISOHANKINNAT_PALVELUT:
      return 'eu';
    case MAAHANTUONTI:
    case AlvKoodi.MAAHANTUONTI_PALVELUT:
      return 'muu';
    default:
      return undefined;
  }
}

/** EU-jäsenmaat ISO 3166-1 alpha-2 -koodeina (+ 'el', Kreikan alv-tunnisteen etuliite). */
const EU_MAAT = new Set([
  'at',
  'be',
  'bg',
  'hr',
  'cy',
  'cz',
  'dk',
  'ee',
  'fi',
  'fr',
  'de',
  'gr',
  'el',
  'hu',
  'ie',
  'it',
  'lv',
  'lt',
  'lu',
  'mt',
  'nl',
  'pl',
  'pt',
  'ro',
  'sk',
  'si',
  'es',
  'se',
]);

/** Kumppanin maakoodin (Kumppani.maa) alkupera; muu kuin kaksikirjaiminen koodi ei luokittele. */
export function alkuperaMaasta(maa: string): Alkupera | undefined {
  const m = maa.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(m)) return undefined;
  if (m === 'fi') return 'kotimaa';
  return EU_MAAT.has(m) ? 'eu' : 'muu';
}

const JARJESTYS: Record<Alkupera, number> = { kotimaa: 1, eu: 2, muu: 3 };

/**
 * Tositteen alkupera listan lippua varten: ulkomaisin vientien alv-koodeista (muu > eu > kotimaa),
 * tai — kun mikään vienti ei luokittele (veroton, siirto, muistio) — kumppanin maa, jos se on
 * annettu. Muuten undefined (ei lippua).
 */
export function tositteenAlkupera(
  viennit: readonly { alvKoodi: number }[],
  kumppaninMaa?: string,
): Alkupera | undefined {
  let alkupera: Alkupera | undefined;
  for (const v of viennit) {
    const a = alkuperaKoodista(v.alvKoodi);
    if (a !== undefined && (alkupera === undefined || JARJESTYS[a] > JARJESTYS[alkupera]))
      alkupera = a;
  }
  if (alkupera !== undefined) return alkupera;
  return kumppaninMaa !== undefined ? alkuperaMaasta(kumppaninMaa) : undefined;
}
