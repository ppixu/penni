/** Millimetri- ja pistemitat sekä A4-asettelun vakiot. Kaikki asettelu lasketaan millimetreinä. */

/** 1 mm = 72/25.4 pt (PDF:n yksikkö). */
export const MM_PT = 72 / 25.4;
export const mm = (n: number): number => n * MM_PT;

export const A4_LEVEYS_MM = 210;
export const A4_KORKEUS_MM = 297;
export const A4_LEVEYS = mm(A4_LEVEYS_MM);
export const A4_KORKEUS = mm(A4_KORKEUS_MM);

/** Ylhäältä mitattu mm → pdf-lib:n y-koordinaatti (origo vasemmassa alakulmassa), pt. */
export const yPt = (ylaMm: number): number => mm(A4_KORKEUS_MM - ylaMm);

export const MARGINAALI_MM = 15;
export const SISALTO_VASEN_MM = MARGINAALI_MM;
export const SISALTO_OIKEA_MM = A4_LEVEYS_MM - MARGINAALI_MM;
export const SISALTO_LEVEYS_MM = SISALTO_OIKEA_MM - SISALTO_VASEN_MM;

/** Alatunnisteen yläviiva (ylhäältä, mm); teksti sen alla alamarginaaliin asti. */
export const ALATUNNISTE_YLA_MM = 265;
/** Sisällön alaraja kaikilla sivuilla: alatunnisteen yläpuolella 3 mm ilmaa. */
export const SISALTO_ALA_MM = ALATUNNISTE_YLA_MM - 3;

/**
 * Maksuosan varattu korkeus viimeisen sivun alalaidassa (mm): viivakoodirivi, maksulaatikko
 * ja QR rinnakkain sekä niiden alla 12 mm:n viivakoodi. Maksuosa piirretään alueelle
 * [SISALTO_ALA_MM − MAKSUOSA_KORKEUS_MM, SISALTO_ALA_MM] (ylhäältä mitattuna).
 */
export const MAKSUOSA_KORKEUS_MM = 56;

/**
 * Pankkiviivakoodin mitat: Finanssiala, Pankkiviivakoodi-opas v5.3 (korjattu 21.10.2019),
 * https://www.finanssiala.fi/wp-content/uploads/2021/03/Pankkiviivakoodi-opas.pdf
 * - s. 3 (luku 6 "Pankkiviivakoodin tuntomerkit"): leveys ensimmäisen viivan etureunasta
 *   viimeisen takareunaan 70–105 mm, korkeus 10,0–12,7 mm; leveämpi (lähellä 105 mm) on
 *   luettavuuden kannalta parempi.
 * - s. 4 (luku 9, "Tyhjä alue 1" ja "Tyhjä alue 2"): tyhjä alue 20 mm vasemmalla ja
 *   vähintään 20 mm oikealla; alueille ei saa tulostaa mitään.
 * Opas ei anna moduulin leveyttä erikseen: 332 moduulin symbolille 70–105 mm tarkoittaa
 * 0,211–0,316 mm. Valittu 0,30 mm → 99,6 mm (lähellä suositeltua enimmäisleveyttä).
 * Huom: speksin alkuarvot (palkki ≥ 13 mm, tyhjä alue 6,4 mm) olivat vanhentuneet — 13 mm
 * ylittäisi oppaan 12,7 mm:n enimmäiskorkeuden ja tyhjä alue on 20 mm.
 */
export const VIIVAKOODI_MODUULI_MM = 0.3;
export const VIIVAKOODI_KORKEUS_MM = 12;
export const VIIVAKOODI_KORKEUS_MIN_MM = 10;
export const VIIVAKOODI_KORKEUS_MAX_MM = 12.7;
export const VIIVAKOODI_LEVEYS_MIN_MM = 70;
export const VIIVAKOODI_LEVEYS_MAX_MM = 105;
export const VIIVAKOODI_HILJAINEN_ALUE_MM = 20;

/** Ostajan osoite ikkunakuoren kohdalla (mm ylhäältä/vasemmalta). */
export const OSTAJA = { vasen: 20, yla: 45, leveys: 90, korkeus: 30 } as const;
/** Tietolaatikko osoitteen oikealla puolella. */
export const INFO = { vasen: 115, oikea: SISALTO_OIKEA_MM, yla: 45, arvoVasen: 148 } as const;

/** Rivitaulukon sarakkeet (mm). Numerosarakkeet tasataan oikeaan reunaan. */
export const SARAKE = {
  seliteVasen: SISALTO_VASEN_MM,
  seliteOikea: 103,
  /** Määrä-sarakkeen alku: selitteen teksti ei saa ulottua tähän. */
  maaraAlku: 105,
  maaraOikea: 120,
  aHintaOikea: 148,
  alvOikea: 164,
  yhteensaOikea: SISALTO_OIKEA_MM,
} as const;
