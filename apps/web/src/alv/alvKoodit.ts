import type { AlvLaskelmaTulos } from '@penni/engine';
import type { Cents } from '@penni/euro';

/** OmaVero-koodien kiinteä esitysjärjestys (legacy-yhteenvedon järjestys, alvlaskelma.cpp:
 *  148-198). 304/310 (maahantuonti) ja 315–317 (alarajahuojennus, kumottu 1.1.2025)
 *  puuttuvat tarkoituksella: moottori ei laske niitä — kartta on harva, ei täysi 300–337. */
export const KOODIJARJESTYS: readonly number[] = [
  301, 302, 303, 305, 306, 318, 307, 308, 309, 311, 312, 313, 314, 319, 320,
];

/** Legacy-nimet (alvlaskelma.cpp:148-198, "Alv-uudistuksen 1.9.2024 mukainen"). 301 on
 *  omistajan Kitsas-kuvakaappauksen muoto "24% / 25,5%" (lähdekoodissa :150 pelkkä "25,5").
 *  Huom. 302:n sekamuotoiset desimaalierottimet ovat legacyssä kirjaimellisesti näin. */
export const KOODINIMET: ReadonlyMap<number, string> = new Map([
  [301, 'Suoritettava 24% / 25,5%:n vero kotimaan myynnistä'],
  [302, 'Suoritettava 13,5 / 14.0%:n vero kotimaan myynnistä'],
  [303, 'Suoritettava 10%:n vero kotimaan myynnistä'],
  [305, 'Vero tavaraostoista muista EU-maista'],
  [306, 'Vero palveluostoista muista EU-maista'],
  [318, 'Vero rakentamispalveluiden ja metalliromun ostoista'],
  [307, 'Verokauden vähennettävä vero'],
  [308, 'Maksettava vero / Palautukseen oikeuttava vero'],
  [309, '0-verokannan alainen liikevaihto'],
  [311, 'Tavaroiden myynnit muihin EU-maihin'],
  [312, 'Palveluiden myynnit muihin EU-maihin'],
  [313, 'Tavaraostot muista EU-maista'],
  [314, 'Palveluostot muista EU-maista'],
  [319, 'Rakentamispalveluiden ja metalliromun myynnit'],
  [320, 'Rakentamispalveluiden ja metalliromun ostot'],
]);

export interface AlvKoodiRivi {
  koodi: number;
  nimi: string;
  arvo: Cents;
  /** 308 (maksettava/palautus) lihavoidaan aina. */
  lihava: boolean;
}

/**
 * Laskelman esitysrivit kiinteässä järjestyksessä: vain koodit-mapissa olevat (≠ 0) rivit,
 * paitsi 308 AINA maksettava-kentästä — haeAlvLaskelma suodattaa nolla-arvoisen 308:n pois
 * mapista (alvLaskelma.ts:61-65), mutta maksettava-rivi kuuluu ilmoitukselle aina
 * (negatiivinen = palautukseen oikeuttava vero).
 */
export function koodiRivit(
  laskelma: Pick<AlvLaskelmaTulos, 'koodit' | 'maksettava'>,
): AlvKoodiRivi[] {
  const rivit: AlvKoodiRivi[] = [];
  for (const koodi of KOODIJARJESTYS) {
    if (koodi === 308) {
      rivit.push({
        koodi,
        nimi: KOODINIMET.get(koodi) ?? '',
        arvo: laskelma.maksettava,
        lihava: true,
      });
      continue;
    }
    const arvo = laskelma.koodit.get(koodi);
    if (arvo === undefined) continue;
    rivit.push({ koodi, nimi: KOODINIMET.get(koodi) ?? '', arvo, lihava: false });
  }
  return rivit;
}
