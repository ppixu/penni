import type { IsoDate } from '../vouchers/types.js';
import type { Tilikausi } from './storage.js';

/** The fiscal year whose [alkaa,loppuu] contains pvm (inclusive), or undefined. */
export function tilikausiPaivalle(
  kaudet: readonly Tilikausi[],
  pvm: IsoDate,
): Tilikausi | undefined {
  return kaudet.find((k) => pvm >= k.alkaa && pvm <= k.loppuu);
}

/** Earliest fiscal-year start, or null for an empty book. */
export function kirjanpidonAlkaa(kaudet: readonly Tilikausi[]): IsoDate | null {
  return kaudet.reduce<IsoDate | null>(
    (min, k) => (min === null || k.alkaa < min ? k.alkaa : min),
    null,
  );
}

/** Latest fiscal-year end, or null for an empty book. */
export function kirjanpidonLoppuu(kaudet: readonly Tilikausi[]): IsoDate | null {
  return kaudet.reduce<IsoDate | null>(
    (max, k) => (max === null || k.loppuu > max ? k.loppuu : max),
    null,
  );
}

export interface SarjaValinta {
  tyyppi: number;
  eriSarjaan: boolean;
  sarjat: Record<string, string>;
  kateinen?: boolean;
  kateisSarjaan?: boolean;
}

/** Choose the voucher series (mirrors TositeTyyppiModel::sarja, tositetyyppimodel.cpp:99-113). */
export function valitseSarja(v: SarjaValinta): string {
  if (v.kateinen && v.kateisSarjaan) return v.sarjat.K ?? 'K';
  if (!v.eriSarjaan) return '';
  if (v.tyyppi >= 1000) return v.sarjat['*'] ?? 'JT';
  return v.sarjat[String(v.tyyppi)] ?? 'X';
}

export interface RenumberInput {
  vanhaPvm: IsoDate;
  vanhaSarja: string;
  uusiPvm: IsoDate;
  uusiSarja: string;
  kaudet: readonly Tilikausi[];
}

/**
 * Whether an updated voucher must be renumbered: true if its fiscal year or series changed
 * (mirrors tositeroute.cpp:214-220). Compares the fiscal-year start of old vs new pvm.
 */
export function pitaakoNumeroUusiksi(i: RenumberInput): boolean {
  if (i.vanhaSarja !== i.uusiSarja) return true;
  const vanhaKausi = tilikausiPaivalle(i.kaudet, i.vanhaPvm)?.alkaa ?? null;
  const uusiKausi = tilikausiPaivalle(i.kaudet, i.uusiPvm)?.alkaa ?? null;
  return vanhaKausi !== uusiKausi;
}
