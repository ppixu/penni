import type { AlvErittely, AlvErittelyRivi } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';

export interface WireAlvErittelyRivi {
  alvKoodi: number;
  kanta: number;
  tili: number;
  pvm: string;
  tosite?: number;
  tositeNumero: string;
  tositePvm: string;
  kumppani: string;
  selite: string;
  summa: string;
}

/** /alv/erittely-vastauksen lankamuoto; rahat "N.NN"-merkkijonoina. */
export interface WireAlvErittely {
  alkupvm: string;
  loppupvm: string;
  rivit: WireAlvErittelyRivi[];
}

export function encodeAlvErittely(e: AlvErittely): WireAlvErittely {
  return {
    alkupvm: e.alkupvm,
    loppupvm: e.loppupvm,
    rivit: e.rivit.map((r) => {
      const w: WireAlvErittelyRivi = {
        alvKoodi: r.alvKoodi,
        kanta: r.kanta,
        tili: r.tili,
        pvm: r.pvm,
        tositeNumero: r.tositeNumero,
        tositePvm: r.tositePvm,
        kumppani: r.kumppani,
        selite: r.selite,
        summa: centsToWire(r.summa),
      };
      if (r.tosite !== undefined) w.tosite = r.tosite;
      return w;
    }),
  };
}

export function decodeAlvErittely(w: {
  alkupvm: string;
  loppupvm: string;
  rivit: {
    alvKoodi: number;
    kanta: number;
    tili: number;
    pvm: string;
    tosite?: number;
    tositeNumero: string;
    tositePvm: string;
    kumppani: string;
    selite: string;
    summa: string | number;
  }[];
}): AlvErittely {
  return {
    alkupvm: w.alkupvm,
    loppupvm: w.loppupvm,
    rivit: w.rivit.map((r) => {
      const rivi: AlvErittelyRivi = {
        alvKoodi: r.alvKoodi,
        kanta: r.kanta,
        tili: r.tili,
        pvm: r.pvm,
        tositeNumero: r.tositeNumero,
        tositePvm: r.tositePvm,
        kumppani: r.kumppani,
        selite: r.selite,
        summa: wireToCents(r.summa),
      };
      if (r.tosite !== undefined) rivi.tosite = r.tosite;
      return rivi;
    }),
  };
}
