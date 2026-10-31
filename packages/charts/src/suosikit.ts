/**
 * Uuden kirjan oletussuosikit (`suosikkitilit`-asetus): tilikartan ja tilivalitsimen
 * Suosikit-välilehdelle tavallisimmat tilit, jotta pienyrittäjä löytää ne heti. Kaikki ovat
 * vakiotilikartan tilejä ja kuuluvat pienyrittäjän perustileihin (eivät ole piilotettuja).
 */
const YHTEISET: readonly number[] = [
  1910, // Pankkitili 1
  1701, // Myyntisaamiset
  2871, // Ostovelat
  3000, // Myynti
  4000, // Ostot
  7660, // Atk-ohjelmistot, päivitykset ja ylläpito
  7800, // Matkaliput
  8380, // Taloushallintopalvelut
  8500, // Puhelinkulut
  8560, // Rahaliikenteen kulut
  8620, // Toimistotarvikkeet
];

/** Arvonlisäverovelvolliselle. */
const ALV: readonly number[] = [
  1763, // Arvonlisäverosaamiset
  2939, // Arvonlisäverovelka
];

/** Toiminimelle: yrittäjän omat rahat ja maksut. */
const TOIMINIMI: readonly number[] = [
  2361, // Yksityissijoitukset rahana
  2365, // Yksityisnostot rahana
  6100, // YEL-maksut
  7870, // Kilometrikorvaukset
  9900, // Ennakkoverot
];

/** Muille yritysmuodoille: oma-aloitteisten verojen velka (ennakonpidätykset, sotu). */
const YHTIO: readonly number[] = [
  2920, // Verovelka (oma-aloitteiset verot)
];

/** Uuden kirjan suosikkitilit yritysmuodon ja ALV-velvollisuuden mukaan, nousevassa järjestyksessä. */
export function oletusSuosikit(muoto: string, alvVelvollinen: boolean): number[] {
  return [
    ...YHTEISET,
    ...(alvVelvollinen ? ALV : []),
    ...(muoto === 'tmi' ? TOIMINIMI : YHTIO),
  ].sort((a, b) => a - b);
}
