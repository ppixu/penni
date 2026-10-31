import { lueMuisti, tallennaMuisti } from '@/lib/muisti';
import type { TositeBucket } from '@penni/engine';
import {
  KUUKAUSIVALINNAT,
  OLETUSVALINTA,
  PIKAVALINNAT,
  type Paivavali,
  type PikavalinnanTunnus,
} from './pikavalinnat';

/** Tositelistan rahavirtarajaus: kaikki tositteet, vain tulot tai vain menot. */
export const LAJIT = ['kaikki', 'tulot', 'menot'] as const;
export type TositeLaji = (typeof LAJIT)[number];

/** Laskujen maksutila (näkyy vain Tulot/Menot-rajauksella). */
export const MAKSUTILAT = ['kaikki', 'avoimet', 'eraantyneet'] as const;
export type Maksutila = (typeof MAKSUTILAT)[number];

export const BUCKETIT = [
  'kirjanpidossa',
  'luonnos',
  'poistetut',
] as const satisfies readonly TositeBucket[];
export type ListaBucket = (typeof BUCKETIT)[number];

/** Tositelistan suodattimet sellaisina kuin ne muistetaan näkymäkohtaisesti. */
export interface TositeSuodattimet {
  bucket: ListaBucket;
  laji: TositeLaji;
  maksutila: Maksutila;
  /** Pikavalinta (null = käsin syötetty väli `oma`). Tallennetaan valintana, ei päivinä. */
  valinta: PikavalinnanTunnus | null;
  oma: Paivavali;
  /** Viimeisin lajittelu; tulkitaan näkymässä (sarakkeet riippuvat lajista). */
  jarj?: string;
  suunta?: 'nouseva' | 'laskeva';
}

export const OLETUSSUODATTIMET: TositeSuodattimet = {
  bucket: 'kirjanpidossa',
  laji: 'kaikki',
  maksutila: 'kaikki',
  valinta: OLETUSVALINTA,
  oma: { alkupvm: '', loppupvm: '' },
};

const NAKYMA = 'tositteet';

const kuuluu = <T extends string>(sallitut: readonly T[], x: unknown): x is T =>
  typeof x === 'string' && (sallitut as readonly string[]).includes(x);

const ISO_PVM = /^\d{4}-\d{2}-\d{2}$/;
const paiva = (x: unknown): string => (typeof x === 'string' && ISO_PVM.test(x) ? x : '');

/**
 * Tulkitse tallennettu (mahdollisesti vanha tai vioittunut) arvo kenttä kerrallaan: tuntematon
 * arvo putoaa oletukseensa, eikä yksi rikkinäinen kenttä hävitä muita valintoja.
 */
export function tulkitseSuodattimet(raaka: unknown): TositeSuodattimet {
  if (typeof raaka !== 'object' || raaka === null) return OLETUSSUODATTIMET;
  const r = raaka as Record<string, unknown>;
  const tunnukset = [...PIKAVALINNAT, ...KUUKAUSIVALINNAT].map((p) => p.tunnus);
  const tulos: TositeSuodattimet = {
    bucket: kuuluu(BUCKETIT, r.bucket) ? r.bucket : OLETUSSUODATTIMET.bucket,
    laji: kuuluu(LAJIT, r.laji) ? r.laji : OLETUSSUODATTIMET.laji,
    maksutila: kuuluu(MAKSUTILAT, r.maksutila) ? r.maksutila : OLETUSSUODATTIMET.maksutila,
    valinta: r.valinta === null ? null : kuuluu(tunnukset, r.valinta) ? r.valinta : OLETUSVALINTA,
    oma: {
      alkupvm: paiva((r.oma as Record<string, unknown> | undefined)?.alkupvm),
      loppupvm: paiva((r.oma as Record<string, unknown> | undefined)?.loppupvm),
    },
  };
  if (typeof r.jarj === 'string' && (r.suunta === 'nouseva' || r.suunta === 'laskeva')) {
    tulos.jarj = r.jarj;
    tulos.suunta = r.suunta;
  }
  return tulos;
}

export function lueTositeSuodattimet(): TositeSuodattimet {
  return tulkitseSuodattimet(lueMuisti(NAKYMA));
}

export function tallennaTositeSuodattimet(s: TositeSuodattimet): void {
  tallennaMuisti(NAKYMA, s);
}
