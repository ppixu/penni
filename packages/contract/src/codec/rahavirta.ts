import type { Alkupera, RahavirtaRivi } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';

/** The wire shape of one Tulot/Menot row. netto/alv/summa/avoin are canonical "N.NN". */
export interface WireRahavirtaRivi {
  tosite: number;
  pvm: string;
  tunniste: number;
  sarja: string;
  tyyppi: number;
  tila: number;
  netto: string | number;
  alv: string | number;
  summa: string | number;
  avoin: string | number;
  /** Liitteiden lukumäärä; puuttuva (vanhempi palvelin) tulkitaan nollaksi. */
  liitteita?: number;
  alkupera?: Alkupera;
  otsikko?: string;
  kumppani?: number;
  kumppaniNimi?: string;
  era?: number;
  erapvm?: string;
  numero?: string;
  viite?: string;
  eraKredit?: boolean;
  [key: string]: unknown;
}

export function encodeRahavirtaRivi(r: RahavirtaRivi): WireRahavirtaRivi {
  const w: WireRahavirtaRivi = {
    tosite: r.tosite,
    pvm: r.pvm,
    tunniste: r.tunniste,
    sarja: r.sarja,
    tyyppi: r.tyyppi,
    tila: r.tila,
    netto: centsToWire(r.netto),
    alv: centsToWire(r.alv),
    summa: centsToWire(r.summa),
    avoin: centsToWire(r.avoin),
    liitteita: r.liitteita,
  };
  if (r.otsikko !== undefined) w.otsikko = r.otsikko;
  if (r.kumppani !== undefined) w.kumppani = r.kumppani;
  if (r.kumppaniNimi !== undefined) w.kumppaniNimi = r.kumppaniNimi;
  if (r.era !== undefined) w.era = r.era;
  if (r.erapvm !== undefined) w.erapvm = r.erapvm;
  if (r.numero !== undefined) w.numero = r.numero;
  if (r.viite !== undefined) w.viite = r.viite;
  if (r.eraKredit !== undefined) w.eraKredit = r.eraKredit;
  if (r.alkupera !== undefined) w.alkupera = r.alkupera;
  return w;
}

export function decodeRahavirtaRivi(w: WireRahavirtaRivi): RahavirtaRivi {
  const r: RahavirtaRivi = {
    tosite: w.tosite,
    pvm: w.pvm,
    tunniste: w.tunniste,
    sarja: w.sarja,
    tyyppi: w.tyyppi,
    tila: w.tila,
    netto: wireToCents(w.netto),
    alv: wireToCents(w.alv),
    summa: wireToCents(w.summa),
    avoin: wireToCents(w.avoin),
    liitteita: w.liitteita != null ? Number(w.liitteita) : 0,
  };
  if (w.otsikko !== undefined) r.otsikko = w.otsikko;
  if (w.kumppani !== undefined) r.kumppani = w.kumppani;
  if (w.kumppaniNimi !== undefined) r.kumppaniNimi = w.kumppaniNimi;
  if (w.era !== undefined) r.era = w.era;
  if (w.erapvm !== undefined) r.erapvm = w.erapvm;
  if (w.numero !== undefined) r.numero = w.numero;
  if (w.viite !== undefined) r.viite = w.viite;
  if (w.eraKredit !== undefined) r.eraKredit = w.eraKredit;
  if (onAlkupera(w.alkupera)) r.alkupera = w.alkupera;
  return r;
}

/** Tunnistaa langalta tulleen alkuperän; tuntematon arvo pudotetaan (ei lippua). */
export function onAlkupera(x: unknown): x is Alkupera {
  return x === 'kotimaa' || x === 'eu' || x === 'muu';
}
