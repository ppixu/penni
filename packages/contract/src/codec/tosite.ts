import type { Alkupera, ListattuTosite, StoredTosite, TilioteTiedot, Tosite } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';
import { pudotaTyhjat } from '../wire/omit.js';
import { onAlkupera } from './rahavirta.js';
import { type WireRivi, decodeRivi, encodeRivi } from './rivi.js';
import { type WireVienti, decodeVienti, encodeVienti } from './vienti.js';

/** The wire shape of a voucher (Tier-0 keys). */
export interface WireTosite {
  id?: number;
  pvm: string;
  tyyppi?: number;
  tila: number;
  tunniste?: number;
  sarja?: string;
  otsikko?: string;
  kumppani?: { id: number };
  viite?: string;
  laskupvm?: string;
  erapvm?: string;
  numero?: string;
  maksutapa?: number;
  alkuperainenTosite?: number;
  marginaalialijaama?: Record<string, number>;
  /** Tiliotteen tiedot; saldot euroina kuten viennit (Kitsaksen kartan avaimet + saldot). */
  tiliote?: WireTiliote;
  /** Vain listavastauksessa (ks. encodeListattuTosite). */
  liitteita?: number;
  alkupera?: Alkupera;
  viennit: WireVienti[];
  rivit?: WireRivi[];
  [key: string]: unknown;
}

export interface WireTiliote {
  tili: number;
  alkupvm: string;
  loppupvm: string;
  iban?: string;
  alkusaldo?: string;
  loppusaldo?: string;
  [key: string]: unknown;
}

function encodeTiliote(t: TilioteTiedot): WireTiliote {
  const w: WireTiliote = { tili: t.tili, alkupvm: t.alkupvm, loppupvm: t.loppupvm };
  if (t.iban) w.iban = t.iban;
  if (t.alkusaldo !== undefined) w.alkusaldo = centsToWire(t.alkusaldo);
  if (t.loppusaldo !== undefined) w.loppusaldo = centsToWire(t.loppusaldo);
  return w;
}

function decodeTiliote(w: unknown): TilioteTiedot | undefined {
  if (typeof w !== 'object' || w === null) return undefined;
  const r = w as Record<string, unknown>;
  // Kitsaksen kartassa tili voi olla merkkijono ja päivät QDate-merkkijonoja.
  const tili = Number(r.tili);
  if (!Number.isFinite(tili) || typeof r.alkupvm !== 'string' || typeof r.loppupvm !== 'string')
    return undefined;
  const t: TilioteTiedot = { tili, alkupvm: r.alkupvm, loppupvm: r.loppupvm };
  if (typeof r.iban === 'string' && r.iban !== '') t.iban = r.iban;
  if (r.alkusaldo != null) t.alkusaldo = wireToCents(String(r.alkusaldo));
  if (r.loppusaldo != null) t.loppusaldo = wireToCents(String(r.loppusaldo));
  return t;
}

export function encodeTosite(t: Tosite & { id?: number }): WireTosite {
  const scalars = pudotaTyhjat({
    id: t.id,
    pvm: t.pvm,
    tyyppi: t.tyyppi,
    tunniste: t.tunniste,
    sarja: t.sarja,
    otsikko: t.otsikko,
    viite: t.viite,
    laskupvm: t.laskupvm,
    erapvm: t.erapvm,
  });
  const w: WireTosite = {
    ...(scalars as Partial<WireTosite>),
    pvm: t.pvm, // pvm is always present
    tila: t.tila, // tila is ALWAYS emitted, even when 0 (POISTETTU)
    viennit: t.viennit.map(encodeVienti),
  };
  if (t.kumppani) w.kumppani = { id: t.kumppani };
  if (t.rivit && t.rivit.length > 0) w.rivit = t.rivit.map(encodeRivi);
  if (t.numero) w.numero = t.numero;
  if (t.maksutapa !== undefined) w.maksutapa = t.maksutapa; // preserve 0 (LASKU)
  if (t.alkuperainenTosite) w.alkuperainenTosite = t.alkuperainenTosite;
  if (t.marginaalialijaama) w.marginaalialijaama = t.marginaalialijaama;
  if (t.tiliote) w.tiliote = encodeTiliote(t.tiliote);
  return w;
}

export function decodeTosite(w: WireTosite): Tosite & { id?: number } {
  const t: Tosite & { id?: number } = {
    pvm: String(w.pvm),
    tyyppi: w.tyyppi != null ? Number(w.tyyppi) : 0,
    tila: w.tila != null ? Number(w.tila) : 100,
    tunniste: w.tunniste != null ? Number(w.tunniste) : 0,
    sarja: w.sarja != null ? String(w.sarja) : '',
    viennit: Array.isArray(w.viennit) ? w.viennit.map(decodeVienti) : [],
  };
  if (w.id != null) t.id = Number(w.id);
  if (w.otsikko) t.otsikko = String(w.otsikko);
  if (w.kumppani && typeof w.kumppani === 'object' && (w.kumppani as { id?: unknown }).id) {
    t.kumppani = Number((w.kumppani as { id: unknown }).id);
  }
  if (w.viite) t.viite = String(w.viite);
  if (w.laskupvm) t.laskupvm = String(w.laskupvm);
  if (w.erapvm) t.erapvm = String(w.erapvm);
  if (Array.isArray(w.rivit) && w.rivit.length > 0) t.rivit = w.rivit.map(decodeRivi);
  if (w.numero != null) t.numero = String(w.numero);
  if (w.maksutapa != null) t.maksutapa = Number(w.maksutapa);
  if (w.alkuperainenTosite != null) t.alkuperainenTosite = Number(w.alkuperainenTosite);
  if (w.marginaalialijaama && typeof w.marginaalialijaama === 'object') {
    t.marginaalialijaama = w.marginaalialijaama as Record<string, number>;
  }
  const tiliote = decodeTiliote(w.tiliote);
  if (tiliote) t.tiliote = tiliote;
  return t;
}

/** GET /tositteet -listan rivi: tosite + liitemäärä (Kitsasin tositelistan `liitteita`,
 *  kitsas-source/kitsas/sqlite/routes/tositeroute.cpp:84-86). */
export function encodeListattuTosite(t: ListattuTosite): WireTosite {
  const w: WireTosite = { ...encodeTosite(t), liitteita: t.liitteita };
  if (t.alkupera !== undefined) w.alkupera = t.alkupera;
  return w;
}

export function decodeListattuTosite(w: WireTosite): ListattuTosite {
  const t: ListattuTosite = {
    ...(decodeTosite(w) as StoredTosite),
    liitteita: w.liitteita != null ? Number(w.liitteita) : 0,
  };
  if (onAlkupera(w.alkupera)) t.alkupera = w.alkupera;
  return t;
}
