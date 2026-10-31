import type { RahavirtaRivi } from '@penni/engine';

/** Tulot/Menot-listan lajiteltavat sarakkeet (sama tunnus kuin taulukon sarake-id). */
export const RAHAVIRTA_LAJITTELUKENTAT = [
  'pvm',
  'otsikko',
  'kumppani',
  'laji',
  'netto',
  'alv',
  'summa',
  'erapvm',
  'avoin',
] as const;
export type RahavirtaLajittelukentta = (typeof RAHAVIRTA_LAJITTELUKENTAT)[number];
export type Lajittelusuunta = 'nouseva' | 'laskeva';

export interface RahavirtaLajittelu {
  kentta: RahavirtaLajittelukentta;
  suunta: Lajittelusuunta;
}

/** Oletus: uusin ensin, kuten tositeluettelossa. Ei tallenneta osoitteeseen. */
export const OLETUSLAJITTELU: RahavirtaLajittelu = { kentta: 'pvm', suunta: 'laskeva' };

/** Sarakkeen nimi omistusmuodossa saavutettavaa nimeä varten: "Lajittele summan mukaan". */
export const RAHAVIRTA_KENTAN_NIMI: Record<RahavirtaLajittelukentta, string> = {
  pvm: 'päivämäärän',
  otsikko: 'selitteen',
  kumppani: 'kumppanin',
  laji: 'lajin',
  netto: 'nettosumman',
  alv: 'arvonlisäveron',
  summa: 'summan',
  erapvm: 'eräpäivän',
  avoin: 'avoimen summan',
};

export function onRahavirtaLajittelukentta(arvo: unknown): arvo is RahavirtaLajittelukentta {
  return (
    typeof arvo === 'string' && (RAHAVIRTA_LAJITTELUKENTAT as readonly string[]).includes(arvo)
  );
}

export function onLajittelusuunta(arvo: unknown): arvo is Lajittelusuunta {
  return arvo === 'nouseva' || arvo === 'laskeva';
}

export function onOletuslajittelu(l: RahavirtaLajittelu): boolean {
  return l.kentta === OLETUSLAJITTELU.kentta && l.suunta === OLETUSLAJITTELU.suunta;
}

/**
 * Otsikkopainikkeen kierto, sama kuin tositeluettelossa: uusi sarake nousevaksi, sama sarake
 * nouseva -> laskeva -> oletus. Päivämäärä on itse oletus, joten se vain kääntyy.
 */
export function seuraavaRahavirtaLajittelu(
  nykyinen: RahavirtaLajittelu,
  kentta: RahavirtaLajittelukentta,
): RahavirtaLajittelu {
  if (nykyinen.kentta !== kentta) return { kentta, suunta: 'nouseva' };
  if (nykyinen.suunta === 'nouseva') return { kentta, suunta: 'laskeva' };
  return kentta === 'pvm' ? { kentta, suunta: 'nouseva' } : OLETUSLAJITTELU;
}

const TYHJA = Symbol('tyhja');
type Avain = string | number | typeof TYHJA;

function teksti(arvo: string | undefined): Avain {
  return arvo === undefined || arvo.trim() === '' ? TYHJA : arvo;
}

/** Sama Selite-teksti kuin taulukon solussa: numero/viite ja otsikko. */
function selite(r: RahavirtaRivi): string | undefined {
  const tunniste = r.numero ?? r.viite;
  if (tunniste && r.otsikko) return `${tunniste} · ${r.otsikko}`;
  return tunniste ?? r.otsikko;
}

function avain(
  r: RahavirtaRivi,
  kentta: RahavirtaLajittelukentta,
  onkoLasku: (r: RahavirtaRivi) => boolean,
): Avain {
  switch (kentta) {
    case 'pvm':
      return r.pvm;
    case 'otsikko':
      return teksti(selite(r));
    case 'kumppani':
      return teksti(r.kumppaniNimi);
    case 'laji':
      return onkoLasku(r) ? 'Lasku' : 'Suora';
    case 'netto':
      return r.netto;
    case 'alv':
      return r.alv;
    case 'summa':
      return r.summa;
    case 'erapvm':
      return teksti(r.erapvm);
    case 'avoin':
      return r.avoin;
  }
}

/** Nouseva päiväjärjestys; tasatilanteessa tositteen numero ja id. */
function vertaaPvm(a: RahavirtaRivi, b: RahavirtaRivi): number {
  return a.pvm.localeCompare(b.pvm) || a.tunniste - b.tunniste || a.tosite - b.tosite;
}

/**
 * Palauttaa uuden, lajitellun taulukon. Tyhjät arvot (ei kumppania, ei eräpäivää…) menevät
 * suunnasta riippumatta viimeiseksi; tasatilanteessa uusin ensin.
 */
export function lajitteleRivit(
  rivit: readonly RahavirtaRivi[],
  lajittelu: RahavirtaLajittelu,
  onkoLasku: (r: RahavirtaRivi) => boolean,
): RahavirtaRivi[] {
  const { kentta, suunta } = lajittelu;
  const kerroin = suunta === 'nouseva' ? 1 : -1;
  return [...rivit].sort((a, b) => {
    if (kentta === 'pvm') return kerroin * vertaaPvm(a, b);
    const x = avain(a, kentta, onkoLasku);
    const y = avain(b, kentta, onkoLasku);
    if (x === TYHJA || y === TYHJA) {
      if (x !== y) return x === TYHJA ? 1 : -1;
      return -vertaaPvm(a, b);
    }
    const tulos =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), 'fi');
    return kerroin * tulos || -vertaaPvm(a, b);
  });
}
