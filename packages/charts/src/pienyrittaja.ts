/**
 * Pienyrittäjän (toiminimi) perustilit: vakiotilikartan tilit, jotka uudessa kirjassa näkyvät
 * oletuksena. Kartta itse pysyy täytenä — muut tilit vain piilotetaan (`piilotilit`-asetus,
 * kuten Kitsaksessa), joten raporttikaavat toimivat ja piilotetun tilin saa näkyviin
 * tilikartasta. Lähtökohta on oikean toiminimikirjan käytössä olevat tilit, laajennettuna
 * tavallisimmilla toiminimen tileillä.
 */
export const PIENYRITTAJAN_TILIT: readonly number[] = [
  // Vastaavaa
  1161, // Koneet ja laitteet
  1201, // Kalusto ja muu irtain
  1701, // Myyntisaamiset
  1763, // Arvonlisäverosaamiset
  1900, // Käteisvarat
  1910, // Pankkitili 1
  1920, // Pankkitili 2
  // Vastattavaa
  2201, // Peruspääoma
  2251, // Edellisten tilikausien voitto/tappio
  2361, // Yksityissijoitukset rahana
  2365, // Yksityisnostot rahana
  2871, // Ostovelat
  2920, // Verovelka (oma-aloitteiset verot)
  2939, // Arvonlisäverovelka
  2979, // Muut siirtovelat
  // Tulot
  3000, // Myynti
  3010, // Myynti 2
  3300, // Komissiomyynti
  3380, // Myynti yhteisön ulkopuolelle
  3390, // Palveluiden myynti EU-maihin
  3800, // Saadut avustukset
  9250, // Muut korkotuotot
  // Ostot ja henkilösivukulut
  4000, // Ostot
  4010, // Ostot 2
  4020, // Ostot 3
  4450, // Alihankinta
  4470, // Palveluiden osto EU-maista
  6100, // YEL-maksut
  6410, // Työttömyysvakuutusmaksut
  6870, // Poisto koneista ja kalustosta
  // Toimitila ja ajoneuvo
  7230, // Toimitilavuokrat
  7390, // Sähkö ja kaasu
  7530, // Ajoneuvojen polttoaine
  // ATK
  7660, // Atk-ohjelmistot, päivitykset ja ylläpito
  7680, // Atk-laitehankinnat (< 3v. kalusto)
  7690, // Atk-laitteiden pienhankinnat
  7700, // Muut atk-laite- ja -ohjelmistokulut
  // Matkat ja edustus
  7800, // Matkaliput
  7860, // Muut matkakulut
  7870, // Kilometrikorvaukset
  7880, // Päivärahat
  7950, // Edustustilaisuudet
  // Markkinointi ja hallinto
  8090, // Internetmainonta
  8380, // Taloushallintopalvelut
  8430, // Muut hallintopalvelut
  8440, // Viranomaismaksut
  8450, // Kirjat
  8480, // Jäsenmaksut
  8500, // Puhelinkulut
  8510, // Matkapuhelinkulut
  8540, // Posti- ja lähettikulut
  8560, // Rahaliikenteen kulut
  8600, // Muut vakuutukset
  8620, // Toimistotarvikkeet
  8800, // Muut vähennyskelvottomat liikekulut
  // Rahoitus ja verot
  9540, // Verojen viivästysseuraamukset
  9550, // Muut korkokulut
  9900, // Ennakkoverot
];

/**
 * `piilotilit`-asetuksen arvo uudelle pienyrittäjän kirjalle: kaikki kartan lehtitilit paitsi
 * perustilit, pilkuin eroteltuna nousevasti (sama muoto kuin Kitsaksessa). Otsikoita ei piiloteta.
 */
export function pienyrittajanPiilotilit(tilit: readonly Record<string, unknown>[]): string {
  const nakyvat = new Set(PIENYRITTAJAN_TILIT);
  return tilit
    .filter((t) => !String(t.tyyppi ?? '').startsWith('H'))
    .map((t) => Number(t.numero))
    .filter((n) => Number.isInteger(n) && n > 0 && !nakyvat.has(n))
    .sort((a, b) => a - b)
    .join(',');
}
