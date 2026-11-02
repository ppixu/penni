import type { AvoinEnnakko } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';

/** GET /ennakot -rivin wire-muoto: rahat "N.NN". */
export interface WireAvoinEnnakko {
  tosite: number;
  numero?: string;
  alvProsentti: number;
  netto: string;
  avoin: string;
}

export function encodeAvoinEnnakko(e: AvoinEnnakko): WireAvoinEnnakko {
  return {
    tosite: e.tosite,
    ...(e.numero !== undefined ? { numero: e.numero } : {}),
    alvProsentti: e.alvProsentti,
    netto: centsToWire(e.netto),
    avoin: centsToWire(e.avoin),
  };
}

export function decodeAvoinEnnakko(w: {
  tosite: number;
  numero?: string | null;
  alvProsentti: number;
  netto: string | number;
  avoin: string | number;
}): AvoinEnnakko {
  return {
    tosite: Number(w.tosite),
    ...(w.numero != null ? { numero: String(w.numero) } : {}),
    alvProsentti: Number(w.alvProsentti),
    netto: wireToCents(w.netto),
    avoin: wireToCents(w.avoin),
  };
}
