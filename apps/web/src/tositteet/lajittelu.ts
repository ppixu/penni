import { tositeTyyppiLabel, tositteenSumma } from '@/lib/tosite';
import type { StoredTosite } from '@penni/engine';

/** Tositelistan lajiteltavat sarakkeet (sama tunnus kuin taulukon sarake-id). */
export const LAJITTELUKENTAT = ['pvm', 'tyyppi', 'nro', 'selite', 'summa'] as const;
export type Lajittelukentta = (typeof LAJITTELUKENTAT)[number];
export type Lajittelusuunta = 'nouseva' | 'laskeva';

export interface Lajittelu {
  kentta: Lajittelukentta;
  suunta: Lajittelusuunta;
}

/** Oletus: uusin ensin. Ei tallenneta osoitteeseen, jottei URL täyty turhasta. */
export const OLETUSLAJITTELU: Lajittelu = { kentta: 'pvm', suunta: 'laskeva' };

/** Sarakkeen nimi omistusmuodossa saavutettavaa nimeä varten: "Lajittele päivämäärän mukaan". */
export const KENTAN_NIMI_OMISTUSMUODOSSA: Record<Lajittelukentta, string> = {
  pvm: 'päivämäärän',
  tyyppi: 'tyypin',
  nro: 'numeron',
  selite: 'selitteen',
  summa: 'summan',
};

export function onLajittelukentta(arvo: unknown): arvo is Lajittelukentta {
  return typeof arvo === 'string' && (LAJITTELUKENTAT as readonly string[]).includes(arvo);
}

export function onLajittelusuunta(arvo: unknown): arvo is Lajittelusuunta {
  return arvo === 'nouseva' || arvo === 'laskeva';
}

export function onOletuslajittelu(l: Lajittelu): boolean {
  return l.kentta === OLETUSLAJITTELU.kentta && l.suunta === OLETUSLAJITTELU.suunta;
}

/**
 * Otsikkopainikkeen kierto. Uusi sarake: nouseva. Sama sarake: nouseva -> laskeva ->
 * takaisin oletukseen (uusin ensin). Päivämäärä on itse oletus (laskeva), joten sen kierto
 * on pelkkä nouseva <-> laskeva.
 */
export function seuraavaLajittelu(nykyinen: Lajittelu, kentta: Lajittelukentta): Lajittelu {
  if (nykyinen.kentta !== kentta) return { kentta, suunta: 'nouseva' };
  if (nykyinen.suunta === 'nouseva') return { kentta, suunta: 'laskeva' };
  return kentta === 'pvm' ? { kentta, suunta: 'nouseva' } : OLETUSLAJITTELU;
}

const FI = 'fi';
const teksti = (a: string, b: string): number => a.localeCompare(b, FI);

/** Nouseva päiväjärjestys; tasatilanteessa tunniste ja id. */
function vertaaPvm(a: StoredTosite, b: StoredTosite): number {
  return a.pvm.localeCompare(b.pvm) || a.tunniste - b.tunniste || a.id - b.id;
}

const onLuonnos = (t: StoredTosite): boolean => t.tunniste <= 0;

/**
 * Peruslajittelu nousevasti. Palauttaa undefined, kun arvo puuttuu ("tyhjä"): tyhjät menevät
 * suunnasta riippumatta aina viimeiseksi (esim. luonnokset ilman numeroa, tositteet ilman otsikkoa).
 */
const TYHJA = Symbol('tyhja');
type Avain = string | number | typeof TYHJA;

function avain(t: StoredTosite, kentta: Lajittelukentta): Avain {
  switch (kentta) {
    case 'pvm':
      return t.pvm;
    case 'tyyppi':
      return tositeTyyppiLabel(t.tyyppi);
    case 'nro':
      return onLuonnos(t) ? TYHJA : t.tunniste;
    case 'selite':
      return (t.otsikko ?? '').trim() === '' ? TYHJA : (t.otsikko as string);
    case 'summa':
      return tositteenSumma(t);
  }
}

function vertaaAvaimia(kentta: Lajittelukentta, a: StoredTosite, b: StoredTosite): number {
  const x = avain(a, kentta);
  const y = avain(b, kentta);
  if (typeof x === 'number' && typeof y === 'number') {
    // Numero: sarja ensin (kirjainjärjestys), sitten juokseva numero numeerisesti.
    return (kentta === 'nro' ? teksti(a.sarja, b.sarja) : 0) || x - y;
  }
  return teksti(String(x), String(y));
}

/**
 * Tositteiden vertailija valitulle lajittelulle. Tasatilanteissa uusin ensin (pvm, tunniste, id
 * laskevasti) valitusta suunnasta riippumatta, paitsi päiväjärjestyksessä jossa tasaus seuraa
 * suuntaa. Luonnokset (ei numeroa) ja tyhjät selitteet menevät suunnasta riippumatta viimeiseksi.
 */
export function tositteenVertailija(
  lajittelu: Lajittelu,
): (a: StoredTosite, b: StoredTosite) => number {
  const { kentta, suunta } = lajittelu;
  const kerroin = suunta === 'nouseva' ? 1 : -1;
  return (a, b) => {
    if (kentta === 'pvm') return kerroin * vertaaPvm(a, b);
    const x = avain(a, kentta);
    const y = avain(b, kentta);
    if (x === TYHJA && y !== TYHJA) return 1;
    if (y === TYHJA && x !== TYHJA) return -1;
    const tulos = x === TYHJA ? 0 : kerroin * vertaaAvaimia(kentta, a, b);
    return tulos || -vertaaPvm(a, b);
  };
}

/** Palauttaa uuden, lajitellun taulukon (syöte säilyy ennallaan). Vakaa lajittelu. */
export function lajittele<T extends StoredTosite>(
  tositteet: readonly T[],
  lajittelu: Lajittelu,
): T[] {
  return [...tositteet].sort(tositteenVertailija(lajittelu));
}
