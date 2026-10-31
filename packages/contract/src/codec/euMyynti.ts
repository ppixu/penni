import type { EuMyyntiRivi, EuMyyntiYhteenveto } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { centsToWire, wireToCents } from '../wire/euro.js';

export interface WireEuMyyntiRivi {
  kumppani: number;
  nimi: string;
  alvtunnus?: string;
  maa?: string;
  tavara: string;
  palvelu: string;
}

export interface WireEuMyynti {
  alkupvm: string;
  loppupvm: string;
  rivit: WireEuMyyntiRivi[];
  puuttuviaTunnuksia: boolean;
}

export function encodeEuMyynti(y: EuMyyntiYhteenveto): WireEuMyynti {
  return {
    alkupvm: y.alkupvm,
    loppupvm: y.loppupvm,
    rivit: y.rivit.map((r) => {
      const w: WireEuMyyntiRivi = {
        kumppani: r.kumppani,
        nimi: r.nimi,
        tavara: centsToWire(r.tavara),
        palvelu: centsToWire(r.palvelu),
      };
      if (r.alvtunnus !== undefined) w.alvtunnus = r.alvtunnus;
      if (r.maa !== undefined) w.maa = r.maa;
      return w;
    }),
    puuttuviaTunnuksia: y.puuttuviaTunnuksia,
  };
}

export function decodeEuMyynti(w: {
  alkupvm: string;
  loppupvm: string;
  rivit: {
    kumppani: number;
    nimi: string;
    alvtunnus?: string;
    maa?: string;
    tavara: string | number;
    palvelu: string | number;
  }[];
  puuttuviaTunnuksia: boolean;
}): EuMyyntiYhteenveto {
  return {
    alkupvm: w.alkupvm,
    loppupvm: w.loppupvm,
    rivit: w.rivit.map((r) => {
      const rivi: EuMyyntiRivi = {
        kumppani: r.kumppani,
        nimi: r.nimi,
        tavara: wireToCents(r.tavara),
        palvelu: wireToCents(r.palvelu),
      };
      if (r.alvtunnus !== undefined) rivi.alvtunnus = r.alvtunnus;
      if (r.maa !== undefined) rivi.maa = r.maa;
      return rivi;
    }),
    puuttuviaTunnuksia: w.puuttuviaTunnuksia,
  };
}
