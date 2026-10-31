/**
 * The TiliLuonne bitmask lattice — verbatim from
 * kitsas-source/kitsas/db/tilityyppimodel.h:23-68.
 *
 * Bit 0 (OTSIKKO) = heading, bit 1 (TASE) = balance-sheet account,
 * bit 2 (TULOS) = income-statement account. Every derived nature OR's the
 * relevant base bit(s) plus discriminator bits, so more-specific natures are
 * supersets of their generalisations — see `onko`.
 *
 * NOTE: VELKATILI and SIIRTOVELKA share the identical value 722. This is the
 * only exact collision in the enum (kept verbatim); singletons that collide are
 * disambiguated by a named setting in `tiliTyypilla` (see tili.ts).
 */
export const Luonne = {
  TUNTEMATON: 0,
  OTSIKKO: 0b0000000000001, // 1
  TASE: 0b0000000000010, // 2
  TULOS: 0b0000000000100, // 4
  VASTAAVAA: 0b0000000001010, // 10
  VASTATTAVAA: 0b0000000010010, // 18
  POISTETTAVA: 0b0000000101010, // 42
  SAATAVA: 0b0000001001010, // 74
  RAHAVARAT: 0b0000010001010, // 138
  TASAERAPOISTO: 0b0000100101010, // 298
  MENOJAANNOSPOISTO: 0b0001000101010, // 554
  ALVSAATAVA: 0b0000101001010, // 330
  KOHDENTAMATONALVSAATAVA: 0b0001101001010, // 842
  VEROSAATAVA: 0b0001001001010, // 586
  MYYNTISAATAVA: 0b0010001001010, // 1098
  SIIRTOSAATAVA: 0b0100001001010, // 2122
  PANKKITILI: 0b0001010001010, // 650
  KATEINEN: 0b0010010001010, // 1162
  OMAPAAOMA: 0b0000000110010, // 50
  EDELLISTENTULOS: 0b0001000110010, // 562
  KAUDENTULOS: 0b0010000110010, // 1074
  VIERASPAAOMA: 0b0000001010010, // 82
  VELKA: 0b0000011010010, // 210
  VELKATILI: 0b0001011010010, // 722
  ALVVELKA: 0b0010011010010, // 1234
  KOHDENTAMATONALVVELKA: 0b0110011010010, // 3282
  VEROVELKA: 0b0100011010010, // 2258
  OSTOVELKA: 0b0000111010010, // 466
  SIIRTOVELKA: 0b0001011010010, // 722 — collides with VELKATILI (verbatim)
  TULO: 0b0000000010100, // 20
  LVTULO: 0b0000001010100, // 84
  MENO: 0b0000000100100, // 36
  POISTO: 0b0000010100100, // 164
} as const;

export type LuonneArvo = number;

/**
 * Subset / "contains" test (verbatim from TiliTyyppi::onko,
 * tilityyppimodel.cpp:34-37): true iff every bit set in `mask` is also set in
 * `luonne` — i.e. `luonne` is a specialisation of `mask`.
 */
export function onko(luonne: LuonneArvo, mask: LuonneArvo): boolean {
  return (luonne & mask) === mask;
}

export interface TiliTyyppi {
  koodi: string;
  kuvaus: string;
  luonne: LuonneArvo;
  uniikki: boolean;
  /** Heading level for 'H<n>' codes; 0 for leaf accounts. */
  otsikkotaso: number;
}

// Verbatim from TilityyppiModel constructor, tilityyppimodel.cpp:45-79.
const TYYPIT: Record<string, { kuvaus: string; luonne: LuonneArvo; uniikki: boolean }> = {
  A: { kuvaus: 'Vastaavaa', luonne: Luonne.VASTAAVAA, uniikki: false },
  APM: {
    kuvaus: 'Poistokelpoinen omaisuus menojäännöspoisto',
    luonne: Luonne.MENOJAANNOSPOISTO,
    uniikki: false,
  },
  APT: {
    kuvaus: 'Poistokelpoinen omaisuus tasapoistolla',
    luonne: Luonne.TASAERAPOISTO,
    uniikki: false,
  },
  AS: { kuvaus: 'Saatavaa', luonne: Luonne.SAATAVA, uniikki: false },
  AO: { kuvaus: 'Myyntisaatavat', luonne: Luonne.MYYNTISAATAVA, uniikki: false },
  AJ: { kuvaus: 'Siirtosaamiset', luonne: Luonne.SIIRTOSAATAVA, uniikki: false },
  AL: { kuvaus: 'Arvonlisäverosaatava', luonne: Luonne.ALVSAATAVA, uniikki: true },
  ALM: {
    kuvaus: 'Maksuperusteisen alv:n kohdentamaton saatava',
    luonne: Luonne.KOHDENTAMATONALVSAATAVA,
    uniikki: true,
  },
  AV: { kuvaus: 'Verosaatava', luonne: Luonne.VEROSAATAVA, uniikki: true },
  ARK: { kuvaus: 'Käteisvarat', luonne: Luonne.KATEINEN, uniikki: false },
  ARP: { kuvaus: 'Pankkitili', luonne: Luonne.PANKKITILI, uniikki: false },
  B: { kuvaus: 'Vastattavaa', luonne: Luonne.VASTATTAVAA, uniikki: false },
  BE: {
    kuvaus: 'Edellisten tilikausien voitto/tappio',
    luonne: Luonne.EDELLISTENTULOS,
    uniikki: true,
  },
  T: { kuvaus: 'Tilikauden tulos', luonne: Luonne.KAUDENTULOS, uniikki: true },
  BS: { kuvaus: 'Velat', luonne: Luonne.VELKA, uniikki: false },
  BSP: { kuvaus: 'Luottotili', luonne: Luonne.VELKATILI, uniikki: false },
  BO: { kuvaus: 'Ostovelat', luonne: Luonne.OSTOVELKA, uniikki: false },
  BJ: { kuvaus: 'Siirtovelat', luonne: Luonne.SIIRTOVELKA, uniikki: false },
  BL: { kuvaus: 'Arvonlisäverovelka', luonne: Luonne.ALVVELKA, uniikki: true },
  BLM: {
    kuvaus: 'Maksuperusteisen alv:n kohdentamaton velka',
    luonne: Luonne.KOHDENTAMATONALVVELKA,
    uniikki: true,
  },
  BV: { kuvaus: 'Verovelka', luonne: Luonne.VEROVELKA, uniikki: true },
  BY: { kuvaus: 'Yksityistilit', luonne: Luonne.VASTATTAVAA, uniikki: false },
  C: { kuvaus: 'Tulot', luonne: Luonne.TULO, uniikki: false },
  CL: { kuvaus: 'Liikevaihtotulo (myynti)', luonne: Luonne.LVTULO, uniikki: false },
  CZ: { kuvaus: 'Verottomat tulot', luonne: Luonne.TULO, uniikki: false },
  CLZ: { kuvaus: 'Veroton myynti', luonne: Luonne.LVTULO, uniikki: false },
  D: { kuvaus: 'Menot', luonne: Luonne.MENO, uniikki: false },
  DP: { kuvaus: 'Poistot', luonne: Luonne.POISTO, uniikki: false },
  DZ: { kuvaus: 'Vähennyskelvottomat menot', luonne: Luonne.MENO, uniikki: false },
  DH: { kuvaus: 'Puoliksi vähennyskelpoiset menot', luonne: Luonne.MENO, uniikki: false },
  DPZ: { kuvaus: 'Vähennyskelvottomat poistot', luonne: Luonne.POISTO, uniikki: false },
  DVE: { kuvaus: 'Ennakkoverot', luonne: Luonne.MENO, uniikki: false },
};

/**
 * Resolve a chart type-code (e.g. 'APT', 'H1', 'AL') to its TiliTyyppi.
 * Verbatim behaviour from tilityyppimodel.cpp:108-121:
 *   - 'H<n>' -> heading at level n (luonne OTSIKKO).
 *   - known leaf code -> table entry.
 *   - unknown code -> TUNTEMATON nature (koodi preserved).
 */
export function tyyppiKoodilla(koodi: string): TiliTyyppi {
  if (koodi.startsWith('H')) {
    const taso = Number.parseInt(koodi.slice(1), 10) || 0;
    return {
      koodi,
      kuvaus: `Otsikko ${taso}`,
      luonne: Luonne.OTSIKKO,
      uniikki: false,
      otsikkotaso: taso,
    };
  }
  const t = TYYPIT[koodi];
  if (t) {
    return { koodi, kuvaus: t.kuvaus, luonne: t.luonne, uniikki: t.uniikki, otsikkotaso: 0 };
  }
  return { koodi, kuvaus: koodi, luonne: Luonne.TUNTEMATON, uniikki: false, otsikkotaso: 0 };
}

/**
 * Enumerate the selectable leaf-account type catalogue (for a chart-editor type picker).
 * Returns one TiliTyyppi per entry in the verbatim TYYPIT table; synthetic heading
 * types ('H<n>') are not part of the catalogue and are excluded. otsikkotaso is 0
 * (every catalogue entry is a leaf account type). Order follows the TYYPIT declaration.
 */
export function tilityypit(): TiliTyyppi[] {
  return Object.entries(TYYPIT).map(([koodi, t]) => ({
    koodi,
    kuvaus: t.kuvaus,
    luonne: t.luonne,
    uniikki: t.uniikki,
    otsikkotaso: 0,
  }));
}
