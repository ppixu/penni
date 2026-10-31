import type { Poistolaskelma, PoistotSyote } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';

export interface WirePoistoRivi {
  tili: number;
  ennen: string;
  poisto: string;
  poistotili: number;
}

export interface WirePoistolaskelma {
  loppupvm: string;
  rivit: WirePoistoRivi[];
  yhteensa: string;
  joKirjattu: boolean;
}

/** Rahat "N.NN"; kaikki kentät emittoidaan ehdoitta (nolla-arvon round-trip -ansa). */
export function encodePoistolaskelma(l: Poistolaskelma): WirePoistolaskelma {
  return {
    loppupvm: l.loppupvm,
    rivit: l.rivit.map((r) => ({
      tili: r.tili,
      ennen: centsToWire(r.ennen),
      poisto: centsToWire(r.poisto),
      poistotili: r.poistotili,
    })),
    yhteensa: centsToWire(l.yhteensa),
    joKirjattu: l.joKirjattu,
  };
}

export function decodePoistolaskelma(w: {
  loppupvm: string;
  rivit: {
    tili: number | string;
    ennen: string | number;
    poisto: string | number;
    poistotili: number | string;
  }[];
  yhteensa: string | number;
  joKirjattu: boolean;
}): Poistolaskelma {
  return {
    loppupvm: w.loppupvm,
    rivit: w.rivit.map((r) => ({
      tili: Number(r.tili),
      ennen: wireToCents(r.ennen),
      poisto: wireToCents(r.poisto),
      poistotili: Number(r.poistotili),
    })),
    yhteensa: wireToCents(w.yhteensa),
    joKirjattu: w.joKirjattu,
  };
}

export function encodePoistotSyote(s: PoistotSyote): { loppupvm: string } {
  return { loppupvm: s.loppupvm };
}

export function decodePoistotSyote(w: { loppupvm: string }): PoistotSyote {
  return { loppupvm: w.loppupvm };
}
