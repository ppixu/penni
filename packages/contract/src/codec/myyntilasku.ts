import type { MyyntilaskuRivi, MyyntilaskuSyote, SuoritusSyote } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';
import { type WireRivi, decodeRivi, encodeRivi } from './rivi.js';

/** The wire shape of the POST /myyntilaskut body. */
export interface WireMyyntilaskuSyote {
  pvm: string;
  laskupvm?: string;
  erapvm?: string;
  kumppani?: { id: number };
  otsikko?: string;
  maksutapa?: number;
  sarja?: string;
  rivit: WireRivi[];
  [key: string]: unknown;
}

export function encodeMyyntilaskuSyote(s: MyyntilaskuSyote): WireMyyntilaskuSyote {
  const w: WireMyyntilaskuSyote = { pvm: s.pvm, rivit: s.rivit.map(encodeRivi) };
  if (s.laskupvm) w.laskupvm = s.laskupvm;
  if (s.erapvm) w.erapvm = s.erapvm;
  if (s.otsikko) w.otsikko = s.otsikko;
  if (s.maksutapa !== undefined) w.maksutapa = s.maksutapa;
  if (s.sarja) w.sarja = s.sarja;
  if (s.kumppani !== undefined) w.kumppani = { id: s.kumppani };
  return w;
}

export function decodeMyyntilaskuSyote(w: WireMyyntilaskuSyote): MyyntilaskuSyote {
  const s: MyyntilaskuSyote = {
    pvm: String(w.pvm),
    rivit: Array.isArray(w.rivit) ? w.rivit.map(decodeRivi) : [],
  };
  if (w.laskupvm) s.laskupvm = String(w.laskupvm);
  if (w.erapvm) s.erapvm = String(w.erapvm);
  if (w.otsikko) s.otsikko = String(w.otsikko);
  if (w.maksutapa != null) s.maksutapa = Number(w.maksutapa);
  if (w.sarja) s.sarja = String(w.sarja);
  if (w.kumppani && typeof w.kumppani === 'object' && (w.kumppani as { id?: unknown }).id != null)
    s.kumppani = Number((w.kumppani as { id: unknown }).id);
  return s;
}

/** The wire shape of one sales-invoice list row. summa/avoin are canonical "N.NN". */
export interface WireMyyntilaskuRivi {
  tosite: number;
  pvm?: string;
  erapvm?: string;
  viite?: string;
  numero?: string;
  asiakas?: string;
  asiakasId?: number;
  summa: string | number;
  avoin: string | number;
  era?: number;
  tili?: number;
  tyyppi: number;
  tunniste: number;
  sarja: string;
  tila: number;
  maksutapa?: number;
  [key: string]: unknown;
}

export function encodeMyyntilaskuRivi(r: MyyntilaskuRivi): WireMyyntilaskuRivi {
  const w: WireMyyntilaskuRivi = {
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
  if (r.numero !== undefined) w.numero = r.numero;
  if (r.asiakas !== undefined) w.asiakas = r.asiakas;
  if (r.asiakasId !== undefined) w.asiakasId = r.asiakasId;
  if (r.era !== undefined) w.era = r.era;
  if (r.tili !== undefined) w.tili = r.tili;
  if (r.maksutapa !== undefined) w.maksutapa = r.maksutapa;
  return w;
}

export function decodeMyyntilaskuRivi(w: WireMyyntilaskuRivi): MyyntilaskuRivi {
  const r: MyyntilaskuRivi = {
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
  if (w.numero != null) r.numero = String(w.numero);
  if (w.asiakas != null) r.asiakas = String(w.asiakas);
  if (w.asiakasId != null) r.asiakasId = Number(w.asiakasId);
  if (w.era != null) r.era = Number(w.era);
  if (w.tili != null) r.tili = Number(w.tili);
  if (w.maksutapa != null) r.maksutapa = Number(w.maksutapa);
  return r;
}

/** The wire shape of the POST /suoritukset body. */
export interface WireSuoritusSyote {
  tosite: number;
  pvm: string;
  summa: string | number;
  rahatili?: number;
  otsikko?: string;
  [key: string]: unknown;
}

export function encodeSuoritusSyote(s: SuoritusSyote): WireSuoritusSyote {
  const w: WireSuoritusSyote = { tosite: s.tosite, pvm: s.pvm, summa: centsToWire(s.summa) };
  if (s.rahatili !== undefined) w.rahatili = s.rahatili;
  if (s.otsikko !== undefined) w.otsikko = s.otsikko;
  return w;
}

export function decodeSuoritusSyote(w: WireSuoritusSyote): SuoritusSyote {
  const s: SuoritusSyote = {
    tosite: Number(w.tosite),
    pvm: String(w.pvm),
    summa: wireToCents(w.summa),
  };
  if (w.rahatili != null) s.rahatili = Number(w.rahatili);
  if (w.otsikko != null) s.otsikko = String(w.otsikko);
  return s;
}
