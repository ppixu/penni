import type { JaksotuksetSyote, Jaksotuslaskelma } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';

export interface WireJaksotusRivi {
  tili: number;
  maara: string;
  selite: string;
  kohdennus?: number;
  jaksoalkaa?: string;
  jaksoloppuu?: string;
}

export interface WireJaksotuslaskelma {
  loppupvm: string;
  rivit: WireJaksotusRivi[];
  joKirjattu: boolean;
}

/** Rahat "N.NN" etumerkillisenä; maara emittoidaan ehdoitta (nolla-arvon round-trip -ansa). */
export function encodeJaksotuslaskelma(l: Jaksotuslaskelma): WireJaksotuslaskelma {
  return {
    loppupvm: l.loppupvm,
    rivit: l.rivit.map((r) => {
      const w: WireJaksotusRivi = { tili: r.tili, maara: centsToWire(r.maara), selite: r.selite };
      if (r.kohdennus) w.kohdennus = r.kohdennus;
      if (r.jaksoalkaa) w.jaksoalkaa = r.jaksoalkaa;
      if (r.jaksoloppuu) w.jaksoloppuu = r.jaksoloppuu;
      return w;
    }),
    joKirjattu: l.joKirjattu,
  };
}

export function decodeJaksotuslaskelma(w: {
  loppupvm: string;
  rivit: {
    tili: number | string;
    maara: string | number;
    selite: string;
    kohdennus?: number | string;
    jaksoalkaa?: string;
    jaksoloppuu?: string;
  }[];
  joKirjattu: boolean;
}): Jaksotuslaskelma {
  return {
    loppupvm: w.loppupvm,
    rivit: w.rivit.map((r) => {
      const out: Jaksotuslaskelma['rivit'][number] = {
        tili: Number(r.tili),
        maara: wireToCents(r.maara),
        selite: r.selite,
      };
      if (r.kohdennus != null && Number(r.kohdennus) !== 0) out.kohdennus = Number(r.kohdennus);
      if (r.jaksoalkaa) out.jaksoalkaa = String(r.jaksoalkaa);
      if (r.jaksoloppuu) out.jaksoloppuu = String(r.jaksoloppuu);
      return out;
    }),
    joKirjattu: w.joKirjattu,
  };
}

export function encodeJaksotuksetSyote(s: JaksotuksetSyote): { loppupvm: string } {
  return { loppupvm: s.loppupvm };
}

export function decodeJaksotuksetSyote(w: { loppupvm: string }): JaksotuksetSyote {
  return { loppupvm: w.loppupvm };
}
