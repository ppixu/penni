import type { Asetukset, TiliData, Tilikausi } from '@penni/engine';

/** Multilingual name as stored in the chart. */
export type Monikielinen = Record<string, string>;

/** A bare string becomes {fi: ...}; an object passes through; anything else -> {}. */
export function normalisoiNimi(v: unknown): Monikielinen {
  if (typeof v === 'string') return { fi: v };
  if (v && typeof v === 'object') return v as Monikielinen;
  return {};
}

/** Rich account-data: the loose TiliData with numero coerced to number and nimi normalized. */
export type TiliRich = TiliData & { numero: number; tyyppi: string; nimi: Monikielinen };

export function decodeTili(w: Record<string, unknown>): TiliRich {
  return {
    ...w,
    numero: typeof w.numero === 'number' ? w.numero : Number(w.numero) || 0,
    tyyppi: typeof w.tyyppi === 'string' ? w.tyyppi : String(w.tyyppi ?? ''),
    nimi: normalisoiNimi(w.nimi),
  };
}

export function encodeTili(t: TiliRich): Record<string, unknown> {
  // Identity over the rich object: numero/tyyppi/nimi are already wire-shaped; extras preserved.
  return { ...t, numero: t.numero, tyyppi: t.tyyppi, nimi: t.nimi };
}

export function decodeTilikausi(w: Record<string, unknown>): Tilikausi {
  return { ...w, alkaa: String(w.alkaa), loppuu: String(w.loppuu) };
}

export function encodeTilikausi(k: Tilikausi): Record<string, unknown> {
  return { ...k };
}

/** Asetukset GET is a flat string map (identity on the wire). */
export function decodeAsetukset(w: Record<string, unknown>): Asetukset {
  const out: Asetukset = {};
  for (const [k, v] of Object.entries(w)) out[k] = v == null ? '' : String(v);
  return out;
}

export function encodeAsetukset(a: Asetukset): Record<string, string> {
  return { ...a };
}

/** PATCH /asetukset: a null value deletes the key (asetuksetroute.cpp:46-52). */
export type AsetuksetPatch = Record<string, string | null>;
