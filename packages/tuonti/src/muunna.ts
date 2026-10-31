import type {
  Asetukset,
  IsoDate,
  TiliData,
  TositeVienti,
  UusiKumppani,
  UusiLiite,
} from '@penni/engine';
import { Euro } from '@penni/euro';
import type { KitsasTosite } from './tyypit.js';

/** A raw row from the Kitsas `Vienti` table. */
export interface KitsasVientiRivi {
  tili: number;
  debetsnt: number | null;
  kreditsnt: number | null;
  alvkoodi: number | null;
  alvprosentti: number | null;
  kohdennus: number | null;
  eraid: number | null;
  selite: string | null;
  tyyppi: number | null;
  pvm: string | null;
  jaksoalkaa: string | null;
  jaksoloppuu: string | null;
  json: string | null;
}

/** A raw row from the Kitsas `Tosite` table. */
export interface KitsasTositeRivi {
  id: number;
  pvm: string;
  tyyppi: number;
  tila: number;
  tunniste: number | null;
  sarja: string | null;
  otsikko: string | null;
  kumppani: number | null;
  laskupvm: string | null;
  erapvm: string | null;
  viite: string | null;
  json: string | null;
}

function lueJson(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const arvo: unknown = JSON.parse(json);
    return arvo && typeof arvo === 'object' ? (arvo as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Map one Kitsas ledger row to a Penni `TositeVienti`. Cents are branded via `Euro.fromCents()`.
 * `tositePvm` is the fallback when the row carries no date of its own.
 */
export function muunnaVienti(rivi: KitsasVientiRivi, tositePvm: IsoDate): TositeVienti {
  const json = lueJson(rivi.json);
  const vienti: TositeVienti = {
    tili: rivi.tili,
    debet: Euro.fromCents(rivi.debetsnt ?? 0),
    kredit: Euro.fromCents(rivi.kreditsnt ?? 0),
    pvm: rivi.pvm ?? tositePvm,
    alvKoodi: rivi.alvkoodi ?? 0,
    alvProsentti: rivi.alvprosentti ?? 0,
  };
  // exactOptionalPropertyTypes: assign optionals only when present, never as undefined.
  if (rivi.selite) vienti.selite = rivi.selite;
  if (rivi.tyyppi) vienti.tyyppi = rivi.tyyppi;
  if (rivi.kohdennus) vienti.kohdennus = rivi.kohdennus;
  if (rivi.eraid) vienti.era = rivi.eraid;
  if (rivi.jaksoalkaa) vienti.jaksoalkaa = rivi.jaksoalkaa;
  if (rivi.jaksoloppuu) vienti.jaksoloppuu = rivi.jaksoloppuu;
  if (typeof json.jaksotustili === 'number') vienti.jaksotustili = json.jaksotustili;
  return vienti;
}

/**
 * Map one Kitsas voucher row plus its already-mapped ledger rows to a Penni voucher.
 * `tila` and `tunniste` are carried over verbatim — that is what keeps imported voucher
 * numbers identical to Kitsas (see the spec's "Why the Storage port" section).
 */
export function muunnaTosite(rivi: KitsasTositeRivi, viennit: TositeVienti[]): KitsasTosite {
  const json = lueJson(rivi.json);
  // Real Kitsas books nest the invoice number/payment method under json.lasku (see
  // tositeroute.cpp's `lasku` map); flat top-level keys are a fallback for older/synthetic
  // data. numero can arrive as either a string or a number depending on the book.
  const lasku =
    typeof json.lasku === 'object' && json.lasku !== null
      ? (json.lasku as Record<string, unknown>)
      : undefined;
  const tosite: KitsasTosite = {
    id: rivi.id,
    pvm: rivi.pvm,
    tyyppi: rivi.tyyppi,
    tila: rivi.tila,
    tunniste: rivi.tunniste ?? 0,
    sarja: rivi.sarja ?? '',
    viennit,
  };
  if (rivi.otsikko) tosite.otsikko = rivi.otsikko;
  if (rivi.kumppani) tosite.kumppani = rivi.kumppani;
  if (rivi.viite) tosite.viite = rivi.viite;
  if (rivi.laskupvm) tosite.laskupvm = rivi.laskupvm;
  if (rivi.erapvm) tosite.erapvm = rivi.erapvm;
  const numero = lasku?.numero ?? json.numero;
  if (typeof numero === 'string') tosite.numero = numero;
  else if (typeof numero === 'number') tosite.numero = String(numero);
  const maksutapa = lasku?.maksutapa ?? json.maksutapa;
  if (typeof maksutapa === 'number') tosite.maksutapa = maksutapa;
  return tosite;
}

/** Kitsas settings that describe its own Qt UI state and mean nothing in Penni. */
export const OHITETTAVAT_ASETUKSET = new Set([
  'KitsasVersio',
  'LaskuIkkunaKorkeus',
  'LaskuIkkunaLeveys',
  'LaskuIkkunaX',
  'LaskuIkkunaY',
]);

/** A raw row from the Kitsas `Tili` table. */
export interface KitsasTiliRivi {
  numero: number;
  tyyppi: string;
  iban: string | null;
  json: string | null;
}

/** A raw row from the Kitsas `Otsikko` table. */
export interface KitsasOtsikkoRivi {
  numero: number;
  taso: number;
  json: string | null;
}

/** A raw row from the Kitsas `Kumppani` table. */
export interface KitsasKumppaniRivi {
  id: number;
  nimi: string | null;
  alvtunnus: string | null;
  json: string | null;
}

/** A raw row from the Kitsas `Liite` table. */
export interface KitsasLiiteRivi {
  nimi: string | null;
  roolinimi: string | null;
  tyyppi: string | null;
  /** Kitsas tallentaa tämän BLOBina (64 ASCII-heksamerkkiä), joten ajuri palauttaa Bufferin. */
  sha: string | Buffer | null;
  luotu: string | null;
  data: Buffer | null;
}

/**
 * Normalisoi Kitsaksen sha-sarakkeen sopimuksen mukaiseksi merkkijonoksi (wire.ts: `sha: z.string()`).
 * Buffer päätyisi muuten sellaisenaan liitteen json-metatietoon muodossa
 * {"type":"Buffer","data":[...]}, jolloin API palauttaisi olion merkkijonon sijaan.
 */
function lueSha(sha: string | Buffer | null): string | undefined {
  if (sha === null || sha === '' || (Buffer.isBuffer(sha) && sha.length === 0)) return undefined;
  if (typeof sha === 'string') return sha;
  const teksti = sha.toString('utf8');
  return /^[0-9a-f]+$/i.test(teksti) ? teksti : sha.toString('hex');
}

/** Map a chart account. The `json` blob holds nimi/erittely/luonne; columns win on conflict. */
export function muunnaTili(rivi: KitsasTiliRivi): TiliData {
  const data: TiliData = { ...lueJson(rivi.json), numero: rivi.numero, tyyppi: rivi.tyyppi };
  if (rivi.iban) data.iban = rivi.iban;
  return data;
}

/** Map a chart heading. Headings are accounts whose tyyppi is 'H<taso>' (see InitBundle). */
export function muunnaOtsikko(rivi: KitsasOtsikkoRivi): TiliData {
  return { ...lueJson(rivi.json), numero: rivi.numero, tyyppi: `H${rivi.taso}` };
}

/** Map a partner. Kitsas keeps IBANs in a child table, so they arrive as a separate list. */
export function muunnaKumppani(rivi: KitsasKumppaniRivi, ibanit: string[]): UusiKumppani {
  const kumppani: UusiKumppani = {
    ...lueJson(rivi.json),
    id: rivi.id,
    nimi: rivi.nimi ?? '',
  };
  if (rivi.alvtunnus) kumppani.alvtunnus = rivi.alvtunnus;
  if (ibanit.length > 0) kumppani.iban = ibanit;
  return kumppani;
}

/** Map an attachment blob against the Penni voucher id it belongs to. */
export function muunnaLiite(rivi: KitsasLiiteRivi, tosite: number): UusiLiite {
  const liite: UusiLiite = {
    tosite,
    nimi: rivi.nimi ?? '',
    tyyppi: rivi.tyyppi ?? 'application/octet-stream',
    luotu: rivi.luotu ?? '1970-01-01T00:00:00.000Z',
    data: rivi.data ? new Uint8Array(rivi.data) : new Uint8Array(),
  };
  if (rivi.roolinimi) liite.roolinimi = rivi.roolinimi;
  const sha = lueSha(rivi.sha);
  if (sha) liite.sha = sha;
  return liite;
}

/** Drop Kitsas-only UI settings; everything else carries over verbatim. */
export function suodataAsetukset(kaikki: Asetukset): Asetukset {
  const tulos: Asetukset = {};
  for (const [avain, arvo] of Object.entries(kaikki)) {
    if (!OHITETTAVAT_ASETUKSET.has(avain)) tulos[avain] = arvo;
  }
  return tulos;
}
