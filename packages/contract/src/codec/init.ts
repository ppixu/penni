import type { InitBundle } from '@penni/engine';
import { decodeTili, decodeTilikausi, encodeTili, encodeTilikausi } from './masterData.js';

/** Wire shape of GET /init (adds the always-empty kierrot the legacy emits). */
export interface WireInit {
  asetukset: Record<string, string>;
  tilit: Record<string, unknown>[];
  kohdennukset: unknown[];
  tilikaudet: Record<string, unknown>[];
  tositesarjat: string[];
  kierrot: unknown[];
}

export function encodeInit(b: InitBundle): WireInit {
  return {
    asetukset: { ...b.asetukset },
    // decode normalizes numero/nimi; encode is identity (normalize-on-output)
    tilit: b.tilit.map((t) => encodeTili(decodeTili(t as Record<string, unknown>))),
    kohdennukset: [...b.kohdennukset],
    tilikaudet: b.tilikaudet.map(encodeTilikausi),
    tositesarjat: [...b.tositesarjat],
    kierrot: [], // cloud-only; always empty in Tier-0
  };
}

export function decodeInit(w: WireInit): InitBundle {
  return {
    asetukset: { ...(w.asetukset as Record<string, string>) },
    tilit: (w.tilit ?? []).map((t) => decodeTili(t)),
    tilikaudet: (w.tilikaudet ?? []).map(decodeTilikausi),
    tositesarjat: [...(w.tositesarjat ?? [])],
    kohdennukset: [...(w.kohdennukset ?? [])],
  };
}
