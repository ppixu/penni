import type { Cents } from '@penni/euro';
import { centsToWire, wireToCents } from '../wire/euro.js';

/** Wire shape of /saldot: account number (string key) -> canonical "N.NN". */
export type WireSaldot = Record<string, string>;

export function encodeSaldot(saldot: ReadonlyMap<number, Cents>): WireSaldot {
  const out: WireSaldot = {};
  for (const numero of [...saldot.keys()].sort((a, b) => a - b)) {
    out[String(numero)] = centsToWire(saldot.get(numero) as Cents);
  }
  return out;
}

export function decodeSaldot(w: Record<string, string | number>): Map<number, Cents> {
  const out = new Map<number, Cents>();
  for (const [k, v] of Object.entries(w)) out.set(Number(k), wireToCents(v));
  return out;
}
