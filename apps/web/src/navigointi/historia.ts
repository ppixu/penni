import type { RouterHistory } from '@tanstack/react-router';

// @tanstack/react-router ei vie HistoryAction-tyyppiä uudelleen; johdetaan se notifysta.
type HistoryAction = Parameters<RouterHistory['notify']>[0]['type'];

/**
 * Sijainti sovelluksen historiapinossa. TanStackin historia tallentaa jokaisen merkinnän
 * järjestysnumeron tilaan (`__TSR_index`), joten "voiko palata" selviää suoraan. Eteenpäin-
 * merkintöjä ei näe mistään (history.length laskee selaimessa myös sovellusta edeltävät sivut),
 * joten pidetään kirjaa suurimmasta saavutetusta indeksistä: uusi siirtymä (PUSH) katkaisee
 * eteenpäin-pinon kuten selaimessakin.
 */
export interface HistoriaTila {
  indeksi: number;
  suurin: number;
}

export function seuraavaTila(
  tila: HistoriaTila,
  toiminto: HistoryAction,
  indeksi: number,
): HistoriaTila {
  if (toiminto === 'PUSH') return { indeksi, suurin: indeksi };
  return { indeksi, suurin: Math.max(tila.suurin, indeksi) };
}

export const voiPalata = (t: HistoriaTila): boolean => t.indeksi > 0;
export const voiEdeta = (t: HistoriaTila): boolean => t.indeksi < t.suurin;

export interface HistoriaSeuranta {
  tila: () => HistoriaTila;
  tilaa: (kuuntelija: () => void) => () => void;
}

const seurannat = new WeakMap<RouterHistory, HistoriaSeuranta>();

/**
 * Yksi seuranta historiaoliota kohden (napit ja eleet jakavat saman tilan). Tilaus jää voimaan
 * historian eliniäksi — se on luotava ennen ensimmäistä siirtymää, joten AppShell kutsuu tätä heti.
 */
export function annaSeuranta(historia: RouterHistory): HistoriaSeuranta {
  const olemassa = seurannat.get(historia);
  if (olemassa) return olemassa;

  const alku = historia.location.state.__TSR_index ?? 0;
  let tila: HistoriaTila = { indeksi: alku, suurin: alku };
  const kuuntelijat = new Set<() => void>();
  historia.subscribe(({ location, action }) => {
    const seuraava = seuraavaTila(tila, action.type, location.state.__TSR_index ?? 0);
    if (seuraava.indeksi === tila.indeksi && seuraava.suurin === tila.suurin) return;
    tila = seuraava;
    for (const k of kuuntelijat) k();
  });

  const seuranta: HistoriaSeuranta = {
    tila: () => tila,
    tilaa: (kuuntelija) => {
      kuuntelijat.add(kuuntelija);
      return () => kuuntelijat.delete(kuuntelija);
    },
  };
  seurannat.set(historia, seuranta);
  return seuranta;
}
