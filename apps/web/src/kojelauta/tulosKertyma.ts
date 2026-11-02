import type { IsoDate } from '@penni/engine';

const LYHENTEET = [
  'Tam',
  'Hel',
  'Maa',
  'Huh',
  'Tou',
  'Kes',
  'Hei',
  'Elo',
  'Syy',
  'Lok',
  'Mar',
  'Jou',
];
const NIMET = [
  'Tammikuu',
  'Helmikuu',
  'Maaliskuu',
  'Huhtikuu',
  'Toukokuu',
  'Kesäkuu',
  'Heinäkuu',
  'Elokuu',
  'Syyskuu',
  'Lokakuu',
  'Marraskuu',
  'Joulukuu',
];

/** Kuukauden lyhenne akselille ("Tam") päivästä. */
export function kuukaudenLyhenne(pvm: IsoDate): string {
  return LYHENTEET[Number(pvm.slice(5, 7)) - 1] ?? '';
}

/** Kuukauden nimi vuosineen vihjeeseen ("Heinäkuu 2026"). */
export function kuukaudenNimi(pvm: IsoDate): string {
  return `${NIMET[Number(pvm.slice(5, 7)) - 1] ?? ''} ${pvm.slice(0, 4)}`;
}

/**
 * Kertymän loppupäivä: tänään, jos se osuu tilikaudelle, muuten kauden loppu (päättynyt kausi
 * näytetään kokonaan, tuleva kausi on vielä tyhjä).
 */
export function kertymanLoppu(alkaa: IsoDate, loppuu: IsoDate, tanaan: IsoDate): IsoDate {
  return tanaan >= alkaa && tanaan <= loppuu ? tanaan : loppuu;
}

export interface PalkinPaikka {
  /** Palkin yläreuna ja korkeus osuutena (0–1) piirtoalueen korkeudesta. */
  ylhaalla: number;
  korkeus: number;
}

/**
 * Pylväiden paikat yhteisellä nollaviivalla: positiivinen kertymä kasvaa ylös, negatiivinen
 * roikkuu alas. Asteikko kattaa aina nollan, joten palkit ovat vertailukelpoisia keskenään.
 */
export function palkkienPaikat(arvot: readonly number[]): {
  nolla: number;
  palkit: PalkinPaikka[];
} {
  const ylin = Math.max(0, ...arvot);
  const alin = Math.min(0, ...arvot);
  const vali = ylin - alin || 1;
  return {
    nolla: ylin / vali,
    palkit: arvot.map((a) => ({
      ylhaalla: (ylin - Math.max(a, 0)) / vali,
      korkeus: Math.abs(a) / vali,
    })),
  };
}
