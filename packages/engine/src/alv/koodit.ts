/** In-scope VAT codes (verbatim from kitsas.h namespace AlvKoodi) + the offset constants. */
export const AlvKoodi = {
  EIALV: 0,
  ALV0: 19,
  MYYNNIT_NETTO: 11,
  OSTOT_NETTO: 21,
  MYYNNIT_BRUTTO: 12,
  OSTOT_BRUTTO: 22,
  MYYNNIT_MARGINAALI: 13,
  OSTOT_MARGINAALI: 23,
  YHTEISOMYYNTI_TAVARAT: 14,
  YHTEISOHANKINNAT_TAVARAT: 24,
  YHTEISOMYYNTI_PALVELUT: 15,
  YHTEISOHANKINNAT_PALVELUT: 25,
  RAKENNUSPALVELU_MYYNTI: 16,
  RAKENNUSPALVELU_OSTO: 26,
  MAAHANTUONTI_PALVELUT: 29,
  MAKSUPERUSTEINEN_MYYNTI: 18,
  MAKSUPERUSTEINEN_OSTO: 28,
  ALVKIRJAUS: 100,
  ALVVAHENNYS: 200,
  MAKSUPERUSTEINEN_KOHDENTAMATON: 400,
  VAHENNYSKELVOTON: 932,
} as const;

/** base code + offset (e.g. MYYNNIT_NETTO + ALVKIRJAUS = 111). */
export function alvKoodilla(kanta: number, offset: number): number {
  return kanta + offset;
}

/**
 * Whether a code's period sum is taken from the DEBIT side.
 * Verbatim port of AlvLaskelma::debetistaKoodilla (alvlaskelma.cpp:1106-1109);
 * C++ integer division -> Math.floor (codes are non-negative).
 */
export function debetistaKoodilla(koodi: number): boolean {
  const sadat = Math.floor(koodi / 100);
  return (
    ((sadat === 0 || sadat === 4) && Math.floor((koodi % 20) / 10) === 0) ||
    sadat === 2 ||
    koodi === AlvKoodi.VAHENNYSKELVOTON
  );
}

export interface VeroTyyppi {
  koodi: number;
  selite: string;
  puoli: 'myynti' | 'osto';
  /** reverse-charge: buyer self-assesses (output + deductible legs). */
  kaanteinen: boolean;
  /** zero-rated: no separate VAT leg generated. */
  nollalaji: boolean;
  /** margin scheme: booked at full amount, VAT computed at period-end. */
  marginaali?: boolean;
}

/** In-scope selectable VAT types (verbatim selite from verotyyppimodel.cpp:32-51). */
export const VEROTYYPIT: readonly VeroTyyppi[] = [
  { koodi: AlvKoodi.EIALV, selite: 'Veroton', puoli: 'myynti', kaanteinen: false, nollalaji: true },
  {
    koodi: AlvKoodi.MYYNNIT_NETTO,
    selite: 'Verollinen myynti (netto)',
    puoli: 'myynti',
    kaanteinen: false,
    nollalaji: false,
  },
  {
    koodi: AlvKoodi.MYYNNIT_BRUTTO,
    selite: 'Verollinen myynti (brutto)',
    puoli: 'myynti',
    kaanteinen: false,
    nollalaji: false,
  },
  {
    koodi: AlvKoodi.OSTOT_NETTO,
    selite: 'Verollinen osto (netto)',
    puoli: 'osto',
    kaanteinen: false,
    nollalaji: false,
  },
  {
    koodi: AlvKoodi.OSTOT_BRUTTO,
    selite: 'Verollinen osto (brutto)',
    puoli: 'osto',
    kaanteinen: false,
    nollalaji: false,
  },
  {
    koodi: AlvKoodi.MYYNNIT_MARGINAALI,
    selite: 'Marginaaliverollinen myynti',
    puoli: 'myynti',
    kaanteinen: false,
    nollalaji: false,
    marginaali: true,
  },
  {
    koodi: AlvKoodi.OSTOT_MARGINAALI,
    selite: 'Marginaaliverollinen osto',
    puoli: 'osto',
    kaanteinen: false,
    nollalaji: false,
    marginaali: true,
  },
  {
    koodi: AlvKoodi.ALV0,
    selite: 'Nollaverokannan alainen myynti',
    puoli: 'myynti',
    kaanteinen: false,
    nollalaji: true,
  },
  {
    koodi: AlvKoodi.YHTEISOMYYNTI_TAVARAT,
    selite: 'Tavaroiden yhteisömyynti',
    puoli: 'myynti',
    kaanteinen: false,
    nollalaji: true,
  },
  {
    koodi: AlvKoodi.YHTEISOMYYNTI_PALVELUT,
    selite: 'Palveluiden yhteisömyynti',
    puoli: 'myynti',
    kaanteinen: false,
    nollalaji: true,
  },
  {
    koodi: AlvKoodi.RAKENNUSPALVELU_MYYNTI,
    selite: 'Rakennuspalveluiden myynti',
    puoli: 'myynti',
    kaanteinen: false,
    nollalaji: true,
  },
  {
    koodi: AlvKoodi.YHTEISOHANKINNAT_TAVARAT,
    selite: 'Tavaroiden yhteisöhankinnat',
    puoli: 'osto',
    kaanteinen: true,
    nollalaji: false,
  },
  {
    koodi: AlvKoodi.YHTEISOHANKINNAT_PALVELUT,
    selite: 'Palveluiden yhteisöhankinnat',
    puoli: 'osto',
    kaanteinen: true,
    nollalaji: false,
  },
  {
    koodi: AlvKoodi.RAKENNUSPALVELU_OSTO,
    selite: 'Rakennuspalveluiden osto',
    puoli: 'osto',
    kaanteinen: true,
    nollalaji: false,
  },
  {
    koodi: AlvKoodi.MAAHANTUONTI_PALVELUT,
    selite: 'Palveluostot EU:n ulkopuolelta',
    puoli: 'osto',
    kaanteinen: true,
    nollalaji: false,
  },
];

const TYYPPI_KOODILLA = new Map<number, VeroTyyppi>(VEROTYYPIT.map((t) => [t.koodi, t]));

export function veroTyyppi(koodi: number): VeroTyyppi | undefined {
  return TYYPPI_KOODILLA.get(koodi);
}

/** Tilitysvientien alv-koodi, verbatim kitsas.h:49 (AlvKoodi::TILITYS). Jää kaikkien
 *  palautuskoodikaistojen ulkopuolelle, joten kausisummaus ohittaa tilitysviennit. */
export const TILITYS = 901;

/** Kiinteät vientikoodi -> veroilmoituksen koodi -kuvaukset (verokannasta riippumattomat). */
const KIINTEAT_PALAUTUSKOODIT = new Map<number, number>([
  [124, 305], // yhteisöhankinnat tavarat, vero
  [125, 306], // yhteisöhankinnat palvelut, vero
  [126, 318], // rakennuspalveluostot, vero
  [221, 307], // vähennettävä vero (kaikki lajit -> 307)
  [222, 307], // bruttokirjatun oston vähennettävä vero (brutto-oikaisu, alvlaskelma.cpp:1091-1097)
  [224, 307],
  [225, 307],
  [226, 307],
  [228, 307], // maksuperusteinen recognized deduction -> vähennettävä vero
  [229, 307], // palveluostot EU:n ulkopuolelta, vähennettävä vero (kaista 200-299)
  [19, 309], // 0-verokannan myynti
  [14, 311], // tavaroiden yhteisömyynti
  [15, 312], // palveluiden yhteisömyynti
  [24, 313], // tavaroiden yhteisöhankinnat, peruste
  [25, 314], // palveluiden yhteisöhankinnat, peruste
  [16, 319], // rakennuspalvelumyynti, peruste
  [26, 320], // rakennuspalveluostot, peruste
]);

/**
 * Kuvaa tallennetun viennin alv-koodin veroilmoituksen koodiksi. `rateKey` on
 * Math.round(alvProsentti * 100) ja vaikuttaa vain kotimaan myynnin veroon (111).
 * Kuvaamaton koodi -> undefined (ohitetaan summauksessa).
 */
export function palautuskoodi(alvKoodi: number, rateKey: number): number | undefined {
  if (
    alvKoodi === alvKoodilla(AlvKoodi.MYYNNIT_NETTO, AlvKoodi.ALVKIRJAUS) ||
    // Bruttokirjatun myynnin vero (112) kuuluu kotimaan myynnin veroon (alvlaskelma.cpp:467).
    alvKoodi === alvKoodilla(AlvKoodi.MYYNNIT_BRUTTO, AlvKoodi.ALVKIRJAUS) ||
    alvKoodi === alvKoodilla(AlvKoodi.MAKSUPERUSTEINEN_MYYNTI, AlvKoodi.ALVKIRJAUS) ||
    alvKoodi === alvKoodilla(AlvKoodi.MYYNNIT_MARGINAALI, AlvKoodi.ALVKIRJAUS) ||
    // EU:n ulkopuolisen palveluoston suoritettava vero (129) summautuu kotimaan myyntiin
    // (alvlaskelma.cpp:472, kotimaanmyyntivero) -> 301/302/303.
    alvKoodi === alvKoodilla(AlvKoodi.MAAHANTUONTI_PALVELUT, AlvKoodi.ALVKIRJAUS)
  ) {
    if (rateKey === 2550 || rateKey === 2400) return 301;
    if (rateKey === 1400 || rateKey === 1350) return 302;
    if (rateKey === 1000) return 303;
    return undefined;
  }
  return KIINTEAT_PALAUTUSKOODIT.get(alvKoodi);
}
