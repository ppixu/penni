import type { IsoDate } from '@penni/engine';
import { PalkatVirhe } from './taulukot.js';

/** Päivämääräapuja: puhdasta UTC-kalenteria, ei aikavyöhykevirheitä. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function jasennaPvm(pvm: string): { v: number; k: number; p: number } {
  const m = ISO.exec(pvm);
  if (m) {
    const v = Number(m[1]);
    const k = Number(m[2]);
    const p = Number(m[3]);
    const d = new Date(Date.UTC(v, k - 1, p));
    if (d.getUTCFullYear() === v && d.getUTCMonth() === k - 1 && d.getUTCDate() === p) {
      return { v, k, p };
    }
  }
  throw new PalkatVirhe('SYOTE', 'Virheellinen pvm (odotetaan muotoa VVVV-KK-PP).');
}

export function jasennaKuukausi(kuukausi: string): { v: number; k: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(kuukausi);
  const k = m ? Number(m[2]) : 0;
  if (!m || k < 1 || k > 12) {
    throw new PalkatVirhe('SYOTE', 'Virheellinen kuukausi (odotetaan muotoa VVVV-KK).');
  }
  return { v: Number(m[1]), k };
}

export function muotoile(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function utc(v: number, k: number, p: number): Date {
  return new Date(Date.UTC(v, k - 1, p));
}

export function lisaaPaivia(pvm: IsoDate, n: number): IsoDate {
  const { v, k, p } = jasennaPvm(pvm);
  return muotoile(utc(v, k, p + n));
}

/** 0 = sunnuntai ... 6 = lauantai. */
export function viikonpaiva(pvm: IsoDate): number {
  const { v, k, p } = jasennaPvm(pvm);
  return utc(v, k, p).getUTCDay();
}
