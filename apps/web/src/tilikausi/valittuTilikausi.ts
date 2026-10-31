import { jarjesta, nykyisenTilikaudenIndeksi, paikallinenTanaan } from '@/tositteet/pikavalinnat';
import type { Tilikausi } from '@penni/engine';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Koko sovelluksen valittu tilikausi (Kitsas: aloitussivun tilikausivalinta). Kojelauta,
 * tositelista, raportit, alv, tilinpäätös ja tilikartan "käytetyt" näyttävät vain tämän kauden;
 * aiemman kauden tositteet näkyvät vasta kun se valitaan sivupalkista.
 *
 * Valinta elää muistissa istunnon ajan eikä tallennu: jokainen avaus alkaa kaudelta, jolla
 * tänään on (Kitsas aloitussivu.cpp:236-246), jottei unohtunut vanha valinta johda kirjaamaan
 * väärälle kaudelle tai lukemaan väärän vuoden lukuja.
 */
export interface ValittuTilikausi {
  /** Valittu kausi; undefined kun tilikausia ei ole (tai init ei ole vielä saapunut). */
  kausi: Tilikausi | undefined;
  /** Kaikki kaudet nousevassa järjestyksessä. */
  kaudet: readonly Tilikausi[];
  /** Valitse kausi sen alkupäivällä. */
  valitse: (alkaa: string) => void;
  /** Onko kausi lukittu: TilitPaatetty yltää kauden loppuun (kuten tilinpaatos/tilinpaatosTila.ts). */
  lukittu: (kausi: Pick<Tilikausi, 'loppuu'>) => boolean;
}

const TYHJA: ValittuTilikausi = {
  kausi: undefined,
  kaudet: [],
  valitse: () => {},
  lukittu: () => false,
};

export const ValittuTilikausiKonteksti = createContext<ValittuTilikausi | null>(null);

/**
 * Juurireitin tila. Tuntematon tai poistunut valinta (esim. kirjanvaihto tai tilikauden
 * poisto) putoaa oletukseen: tänään-päivän kausi tai lähin reuna.
 */
export function useTilikausiValinta(
  tilikaudet: readonly Tilikausi[] | undefined,
  tilitPaatetty: string | undefined,
  tanaan: string = paikallinenTanaan(),
): ValittuTilikausi {
  const [valittu, setValittu] = useState<string | null>(null);
  const kaudet = useMemo(() => jarjesta(tilikaudet ?? []), [tilikaudet]);
  const kausi =
    kaudet.find((k) => k.alkaa === valittu) ?? kaudet[nykyisenTilikaudenIndeksi(kaudet, tanaan)];
  const valitse = useCallback((alkaa: string) => setValittu(alkaa), []);
  const lukittu = useCallback(
    (k: Pick<Tilikausi, 'loppuu'>) => Boolean(tilitPaatetty) && (tilitPaatetty ?? '') >= k.loppuu,
    [tilitPaatetty],
  );
  return useMemo(() => ({ kausi, kaudet, valitse, lukittu }), [kausi, kaudet, valitse, lukittu]);
}

/** Lue valittu kausi. Ilman tarjoajaa (juurireittiä) kautta ei ole. */
export function useValittuTilikausi(): ValittuTilikausi {
  return useContext(ValittuTilikausiKonteksti) ?? TYHJA;
}
