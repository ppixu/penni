import type { AlvLaskelmaTulos, AlvTilitysSyote } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { centsToWire, wireToCents } from '../wire/euro.js';

/** /alv-vastauksen lankamuoto. */
export interface WireAlvLaskelma {
  alkupvm: string;
  loppupvm: string;
  koodit: Record<string, string>;
  maksettava: string;
}

export interface WireAlvTilitysSyote {
  alkupvm: string;
  loppupvm: string;
}

/** Rahat aina "N.NN"-merkkijonoina; koodit numerojärjestyksessä (kuten encodeSaldot). */
export function encodeAlvLaskelma(t: AlvLaskelmaTulos): WireAlvLaskelma {
  const koodit: Record<string, string> = {};
  for (const koodi of [...t.koodit.keys()].sort((a, b) => a - b)) {
    koodit[String(koodi)] = centsToWire(t.koodit.get(koodi) as Cents);
  }
  return {
    alkupvm: t.alkupvm,
    loppupvm: t.loppupvm,
    koodit,
    maksettava: centsToWire(t.maksettava),
  };
}

export function decodeAlvLaskelma(w: {
  alkupvm: string;
  loppupvm: string;
  koodit: Record<string, string | number>;
  maksettava: string | number;
}): AlvLaskelmaTulos {
  const koodit = new Map<number, Cents>();
  for (const [k, v] of Object.entries(w.koodit)) koodit.set(Number(k), wireToCents(v));
  return {
    alkupvm: w.alkupvm,
    loppupvm: w.loppupvm,
    koodit,
    maksettava: wireToCents(w.maksettava),
  };
}

export function encodeAlvTilitysSyote(s: AlvTilitysSyote): WireAlvTilitysSyote {
  return { alkupvm: s.alkupvm, loppupvm: s.loppupvm };
}

export function decodeAlvTilitysSyote(w: WireAlvTilitysSyote): AlvTilitysSyote {
  return { alkupvm: w.alkupvm, loppupvm: w.loppupvm };
}
