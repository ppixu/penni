import type { OstolaskuRivi, OstolaskuSyote } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';
import { type WireRivi, decodeRivi, encodeRivi } from './rivi.js';

/** The wire shape of the POST /ostolaskut body. */
export interface WireOstolaskuSyote {
  pvm: string;
  laskupvm?: string;
  erapvm?: string;
  viite?: string;
  kumppani?: { id: number };
  otsikko?: string;
  sarja?: string;
  tyyppi?: number;
  rivit: WireRivi[];
  [key: string]: unknown;
}

export function encodeOstolaskuSyote(s: OstolaskuSyote): WireOstolaskuSyote {
  const w: WireOstolaskuSyote = { pvm: s.pvm, rivit: s.rivit.map(encodeRivi) };
  if (s.laskupvm) w.laskupvm = s.laskupvm;
  if (s.erapvm) w.erapvm = s.erapvm;
  if (s.viite) w.viite = s.viite;
  if (s.otsikko) w.otsikko = s.otsikko;
  if (s.sarja) w.sarja = s.sarja;
  if (s.tyyppi !== undefined) w.tyyppi = s.tyyppi;
  if (s.kumppani !== undefined) w.kumppani = { id: s.kumppani };
  return w;
}

export function decodeOstolaskuSyote(w: WireOstolaskuSyote): OstolaskuSyote {
  const s: OstolaskuSyote = {
    pvm: String(w.pvm),
    rivit: Array.isArray(w.rivit) ? w.rivit.map(decodeRivi) : [],
  };
  if (w.laskupvm) s.laskupvm = String(w.laskupvm);
  if (w.erapvm) s.erapvm = String(w.erapvm);
  if (w.viite) s.viite = String(w.viite);
  if (w.otsikko) s.otsikko = String(w.otsikko);
  if (w.sarja) s.sarja = String(w.sarja);
  if (w.tyyppi != null) s.tyyppi = Number(w.tyyppi);
  if (w.kumppani && typeof w.kumppani === 'object' && (w.kumppani as { id?: unknown }).id != null)
    s.kumppani = Number((w.kumppani as { id: unknown }).id);
  return s;
}

/** The wire shape of one purchase-invoice list row. summa/avoin are canonical "N.NN". */
export interface WireOstolaskuRivi {
  tosite: number;
  pvm?: string;
  erapvm?: string;
  viite?: string;
  summa: string | number;
  avoin: string | number;
  kumppani?: number;
  toimittaja?: string;
  era?: number;
  tili?: number;
  tyyppi: number;
  tunniste: number;
  sarja: string;
  tila: number;
  [key: string]: unknown;
}

export function encodeOstolaskuRivi(r: OstolaskuRivi): WireOstolaskuRivi {
  const w: WireOstolaskuRivi = {
    tosite: r.tosite,
    summa: centsToWire(r.summa),
    avoin: centsToWire(r.avoin),
    tyyppi: r.tyyppi,
    tunniste: r.tunniste,
    sarja: r.sarja,
    tila: r.tila,
  };
  if (r.pvm !== undefined) w.pvm = r.pvm;
  if (r.erapvm !== undefined) w.erapvm = r.erapvm;
  if (r.viite !== undefined) w.viite = r.viite;
  if (r.kumppani !== undefined) w.kumppani = r.kumppani;
  if (r.toimittaja !== undefined) w.toimittaja = r.toimittaja;
  if (r.era !== undefined) w.era = r.era;
  if (r.tili !== undefined) w.tili = r.tili;
  return w;
}

export function decodeOstolaskuRivi(w: WireOstolaskuRivi): OstolaskuRivi {
  const r: OstolaskuRivi = {
    tosite: Number(w.tosite),
    summa: wireToCents(w.summa),
    avoin: wireToCents(w.avoin),
    tyyppi: Number(w.tyyppi),
    tunniste: Number(w.tunniste),
    sarja: w.sarja != null ? String(w.sarja) : '',
    tila: Number(w.tila),
  };
  if (w.pvm != null) r.pvm = String(w.pvm);
  if (w.erapvm != null) r.erapvm = String(w.erapvm);
  if (w.viite != null) r.viite = String(w.viite);
  if (w.kumppani != null) r.kumppani = Number(w.kumppani);
  if (w.toimittaja != null) r.toimittaja = String(w.toimittaja);
  if (w.era != null) r.era = Number(w.era);
  if (w.tili != null) r.tili = Number(w.tili);
  return r;
}
