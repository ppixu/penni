import type { AlvIlmoitus, Kausityyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { centsToWire, wireToCents } from '../wire/euro.js';

export interface WireAlvIlmoitus {
  alkupvm: string;
  loppupvm: string;
  kausityyppi: string;
  koodit: Record<string, string>;
  maksettava: string;
  nolla: boolean;
  maksuperusteinen: boolean;
}

/** Rahat "N.NN"; koodit numerojärjestyksessä (kuten encodeAlvLaskelma). */
export function encodeAlvIlmoitus(i: AlvIlmoitus): WireAlvIlmoitus {
  const koodit: Record<string, string> = {};
  for (const koodi of [...i.koodit.keys()].sort((a, b) => a - b)) {
    koodit[String(koodi)] = centsToWire(i.koodit.get(koodi) as Cents);
  }
  return {
    alkupvm: i.alkupvm,
    loppupvm: i.loppupvm,
    kausityyppi: i.kausityyppi,
    koodit,
    maksettava: centsToWire(i.maksettava),
    nolla: i.nolla,
    maksuperusteinen: i.maksuperusteinen,
  };
}

export function decodeAlvIlmoitus(w: {
  alkupvm: string;
  loppupvm: string;
  kausityyppi: string;
  koodit: Record<string, string | number>;
  maksettava: string | number;
  nolla: boolean;
  maksuperusteinen: boolean;
}): AlvIlmoitus {
  const koodit = new Map<number, Cents>();
  for (const [k, v] of Object.entries(w.koodit)) koodit.set(Number(k), wireToCents(v));
  return {
    alkupvm: w.alkupvm,
    loppupvm: w.loppupvm,
    kausityyppi: w.kausityyppi as Kausityyppi,
    koodit,
    maksettava: wireToCents(w.maksettava),
    nolla: w.nolla,
    maksuperusteinen: w.maksuperusteinen,
  };
}
