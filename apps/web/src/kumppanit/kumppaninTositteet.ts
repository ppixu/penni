import { tositteenSumma } from '@/lib/tosite';
import {
  type IsoDate,
  type Kumppani,
  type ListattuTosite,
  type Tilikausi,
  tositteenKumppani,
} from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';

export interface Kertyma {
  kpl: number;
  summa: Cents;
}

export interface KumppaninTilasto {
  /** Valitun tilikauden tositteet. */
  kausi: Kertyma;
  kaikki: Kertyma;
}

const NOLLA: Kertyma = { kpl: 0, summa: Euro.fromCents(0) };
export const EI_TOSITTEITA: KumppaninTilasto = { kausi: NOLLA, kaikki: NOLLA };

const lisaa = (k: Kertyma, summa: Cents): Kertyma => ({
  kpl: k.kpl + 1,
  summa: Euro.add(k.summa, summa),
});

/**
 * Tositteiden määrä ja summa kumppaneittain: valitulla kaudella ja kaikkiaan. Tositteen
 * kumppani kuten tositelistan kumppanirajauksessa (tositteenKumppani): tallennettu, tai
 * kumppanittomalla otsikosta tunnistettu. Summa kuten listoilla (tositteenSumma).
 */
export function kumppaneidenTilastot(
  tositteet: readonly ListattuTosite[],
  kumppanit: readonly Kumppani[],
  kausi: Pick<Tilikausi, 'alkaa' | 'loppuu'> | undefined,
): Map<number, KumppaninTilasto> {
  const tulos = new Map<number, KumppaninTilasto>();
  for (const t of tositteet) {
    const id = tositteenKumppani(t, kumppanit);
    if (id === undefined) continue;
    const summa = tositteenSumma(t);
    const vanha = tulos.get(id) ?? EI_TOSITTEITA;
    const kaudella = kausi !== undefined && t.pvm >= kausi.alkaa && t.pvm <= kausi.loppuu;
    tulos.set(id, {
      kausi: kaudella ? lisaa(vanha.kausi, summa) : vanha.kausi,
      kaikki: lisaa(vanha.kaikki, summa),
    });
  }
  return tulos;
}

export interface Liitos {
  tosite: ListattuTosite;
  kumppani: number;
}

/**
 * Kumppanittomat tositteet, joiden otsikko vastaa kumppanin nimeä — kertaluonteista
 * korjausta varten (Pennissä ennen kumppanin tunnistusta luodut). Lukittuun kauteen
 * (TilitPaatetty) osuvat jätetään pois: niitä ei saa enää muuttaa.
 */
export function liitettavatTositteet(
  tositteet: readonly ListattuTosite[],
  kumppanit: readonly Kumppani[],
  lukitusraja: IsoDate | undefined,
): Liitos[] {
  const tulos: Liitos[] = [];
  for (const t of tositteet) {
    if (t.kumppani !== undefined) continue;
    if (lukitusraja && (t.pvm <= lukitusraja || t.viennit.some((v) => v.pvm <= lukitusraja)))
      continue;
    const kumppani = tositteenKumppani(t, kumppanit);
    if (kumppani !== undefined) tulos.push({ tosite: t, kumppani });
  }
  return tulos;
}
