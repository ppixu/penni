import type { Tilikausi, TositeBucket } from '@penni/engine';

/** Numerojärjestykseen tarvittavat kentät (tosite tai lasku­listan rivi, `id` = tositteen id). */
export interface NumeroAvain {
  id: number;
  pvm: string;
  sarja: string;
  tunniste: number;
}

type Kausi = Pick<Tilikausi, 'alkaa' | 'loppuu'>;

export interface Naapurit {
  edellinen: number | null;
  seuraava: number | null;
}

/** Tilikauden alkupäivä, johon päivä osuu; kauden ulkopuolella päivä itse (kronologinen varasija). */
function kaudenAlku(pvm: string, kaudet: readonly Kausi[]): string {
  return kaudet.find((k) => k.alkaa <= pvm && pvm <= k.loppuu)?.alkaa ?? pvm;
}

/**
 * Tositenumeron järjestys: numeroidut (tunniste > 0) tilikausittain, sitten sarja ja juokseva
 * numero — sama avain kuin aukoton numerointi (tilikausi, sarja). Numeroimattomat (luonnokset)
 * tulevat perään päivämäärän ja id:n mukaan. Palauttaa uuden taulukon.
 */
export function jarjestaNumeroittain<T extends NumeroAvain>(
  lista: readonly T[],
  kaudet: readonly Kausi[],
): T[] {
  const kausi = new Map(lista.map((t) => [t, kaudenAlku(t.pvm, kaudet)]));
  return [...lista].sort((a, b) => {
    const an = a.tunniste > 0;
    const bn = b.tunniste > 0;
    if (an !== bn) return an ? -1 : 1;
    if (!an) return a.pvm.localeCompare(b.pvm) || a.id - b.id;
    return (
      (kausi.get(a) as string).localeCompare(kausi.get(b) as string) ||
      a.sarja.localeCompare(b.sarja, 'fi') ||
      a.tunniste - b.tunniste ||
      a.id - b.id
    );
  });
}

/** Edellinen ja seuraava tosite numerojärjestyksessä; tuntematon id ei saa naapureita. */
export function naapurit(
  lista: readonly NumeroAvain[],
  id: number,
  kaudet: readonly Kausi[],
): Naapurit {
  const jarjestetty = jarjestaNumeroittain(lista, kaudet);
  const i = jarjestetty.findIndex((t) => t.id === id);
  if (i < 0) return { edellinen: null, seuraava: null };
  return {
    edellinen: jarjestetty[i - 1]?.id ?? null,
    seuraava: jarjestetty[i + 1]?.id ?? null,
  };
}

/** Tositteen tila-ryhmä (sama jako kuin tallennuskerroksen listaussuodattimessa). */
export function tositteenBucket(tila: number): TositeBucket {
  if (tila >= 100) return 'kirjanpidossa';
  if (tila >= 50) return 'luonnos';
  if (tila > 5) return 'saapuneet';
  if (tila === 5) return 'malli';
  return 'poistetut';
}
