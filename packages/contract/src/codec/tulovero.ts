import type { TuloveroSyote, Verolaskelma } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';

export interface WireVerolaskelma {
  alkupvm: string;
  loppupvm: string;
  tulo: string;
  taysivahennys: string;
  puolivahennys: string;
  vahennys: string;
  ennakko: string;
  tulos: string;
  aiempiTappio: string;
  loppuTulos: string;
  vero: string;
  jaaveroa: string;
  joKirjattu: boolean;
}

/** Rahat "N.NN"; kaikki kentät emittoidaan ehdoitta (nolla-arvon round-trip -ansa). */
export function encodeVerolaskelma(l: Verolaskelma): WireVerolaskelma {
  return {
    alkupvm: l.alkupvm,
    loppupvm: l.loppupvm,
    tulo: centsToWire(l.tulo),
    taysivahennys: centsToWire(l.taysivahennys),
    puolivahennys: centsToWire(l.puolivahennys),
    vahennys: centsToWire(l.vahennys),
    ennakko: centsToWire(l.ennakko),
    tulos: centsToWire(l.tulos),
    aiempiTappio: centsToWire(l.aiempiTappio),
    loppuTulos: centsToWire(l.loppuTulos),
    vero: centsToWire(l.vero),
    jaaveroa: centsToWire(l.jaaveroa),
    joKirjattu: l.joKirjattu,
  };
}

export function decodeVerolaskelma(w: {
  alkupvm: string;
  loppupvm: string;
  tulo: string | number;
  taysivahennys: string | number;
  puolivahennys: string | number;
  vahennys: string | number;
  ennakko: string | number;
  tulos: string | number;
  aiempiTappio: string | number;
  loppuTulos: string | number;
  vero: string | number;
  jaaveroa: string | number;
  joKirjattu: boolean;
}): Verolaskelma {
  return {
    alkupvm: w.alkupvm,
    loppupvm: w.loppupvm,
    tulo: wireToCents(w.tulo),
    taysivahennys: wireToCents(w.taysivahennys),
    puolivahennys: wireToCents(w.puolivahennys),
    vahennys: wireToCents(w.vahennys),
    ennakko: wireToCents(w.ennakko),
    tulos: wireToCents(w.tulos),
    aiempiTappio: wireToCents(w.aiempiTappio),
    loppuTulos: wireToCents(w.loppuTulos),
    vero: wireToCents(w.vero),
    jaaveroa: wireToCents(w.jaaveroa),
    joKirjattu: w.joKirjattu,
  };
}

export interface WireTuloveroSyote {
  alkupvm: string;
  loppupvm: string;
  aiempiTappio?: string;
  tulo?: string;
  taysivahennys?: string;
  puolivahennys?: string;
  ennakko?: string;
}

/** Emittoi vain annetut valinnaiset kentät (rahat "N.NN"). */
export function encodeTuloveroSyote(s: TuloveroSyote): WireTuloveroSyote {
  const w: WireTuloveroSyote = { alkupvm: s.alkupvm, loppupvm: s.loppupvm };
  if (s.aiempiTappio !== undefined) w.aiempiTappio = centsToWire(s.aiempiTappio);
  if (s.tulo !== undefined) w.tulo = centsToWire(s.tulo);
  if (s.taysivahennys !== undefined) w.taysivahennys = centsToWire(s.taysivahennys);
  if (s.puolivahennys !== undefined) w.puolivahennys = centsToWire(s.puolivahennys);
  if (s.ennakko !== undefined) w.ennakko = centsToWire(s.ennakko);
  return w;
}

export function decodeTuloveroSyote(w: {
  alkupvm: string;
  loppupvm: string;
  aiempiTappio?: string | number;
  tulo?: string | number;
  taysivahennys?: string | number;
  puolivahennys?: string | number;
  ennakko?: string | number;
}): TuloveroSyote {
  const s: TuloveroSyote = { alkupvm: w.alkupvm, loppupvm: w.loppupvm };
  if (w.aiempiTappio !== undefined) s.aiempiTappio = wireToCents(w.aiempiTappio);
  if (w.tulo !== undefined) s.tulo = wireToCents(w.tulo);
  if (w.taysivahennys !== undefined) s.taysivahennys = wireToCents(w.taysivahennys);
  if (w.puolivahennys !== undefined) s.puolivahennys = wireToCents(w.puolivahennys);
  if (w.ennakko !== undefined) s.ennakko = wireToCents(w.ennakko);
  return s;
}
