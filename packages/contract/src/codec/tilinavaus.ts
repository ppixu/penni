import type { TilinavausSyote } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { centsToWire, wireToCents } from '../wire/euro.js';

export interface WireTilinavausSyote {
  pvm: string;
  saldot: { tili: number; saldo: string }[];
}

export function encodeTilinavausSyote(s: TilinavausSyote): WireTilinavausSyote {
  return {
    pvm: s.pvm,
    saldot: s.saldot.map((r) => ({ tili: r.tili, saldo: centsToWire(r.saldo) })),
  };
}

export function decodeTilinavausSyote(w: {
  pvm: string;
  saldot: { tili: number; saldo: string | number }[];
}): TilinavausSyote {
  return {
    pvm: w.pvm,
    saldot: w.saldot.map((r) => ({ tili: r.tili, saldo: wireToCents(r.saldo) })),
  };
}
