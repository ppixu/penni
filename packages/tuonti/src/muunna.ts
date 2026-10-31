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

/** Provenance stamped on every history row carried over from a Kitsas book. */
export const KITSAS_LAHDE = 'kitsas';

/** A raw row from the Kitsas `Vienti` table. */
export interface KitsasVientiRivi {
  /** Kitsas's own row id: the key its erät are named by (eraid of an opening row = its id). */
  id?: number;
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
  kumppani?: number | null;
  arkistotunnus?: string | null;
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

/** Vienti json keys the importer carries over; everything else is reported by the coverage audit. */
export const KASITELLYT_VIENTI_JSON = new Set(['jaksotustili', 'viite', 'tasaerapoisto']);

/** What a ledger row inherits from its voucher, so redundant copies are not stored twice. */
export interface VientiKonteksti {
  kumppani?: number | null;
  viite?: string | null;
}

/**
 * Map one Kitsas ledger row to a Penni `TositeVienti`. Cents are branded via `Euro.fromCents()`.
 * `tositePvm` is the fallback when the row carries no date of its own.
 *
 * `era` is copied raw here; the caller renames it with `luoEraKartta` (Kitsas names an erä by
 * its opening ROW id, Penni by its opening VOUCHER id). Kitsas copies the voucher's partner
 * onto every row it creates (model/tositeviennit.cpp:470,741,783; stored at
 * tositeroute.cpp:324,368), so a row's partner and reference are kept only when they differ
 * from the voucher's — e.g. one bank-statement row per counterparty. Storing the redundant
 * copies would make every imported voucher look un-editable in the grid.
 */
export function muunnaVienti(
  rivi: KitsasVientiRivi,
  tositePvm: IsoDate,
  tosite: VientiKonteksti = {},
): TositeVienti {
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
  if (rivi.kumppani && rivi.kumppani !== tosite.kumppani) vienti.kumppani = rivi.kumppani;
  if (rivi.arkistotunnus) vienti.arkistotunnus = rivi.arkistotunnus;
  if (typeof json.viite === 'string' && json.viite !== '' && json.viite !== tosite.viite)
    vienti.viite = json.viite;
  const tasaera = Number(json.tasaerapoisto);
  if (Number.isFinite(tasaera) && tasaera > 0) vienti.tasaerapoisto = tasaera;
  return vienti;
}

/**
 * Rename Kitsas erät into Penni's key space. Kitsas names an erä by the id of the ledger row
 * that opened it (`Vienti.eraid = Vienti.id` on that row, ostolaskutroute.cpp:78 and
 * tositeroute.cpp:381-382); Penni names it by the opening voucher's `tosite.id`
 * (docs/specs/2026-07-10-era-namespace-fix-design.md). A voucher opening exactly one erä gets
 * its own id, so imported invoices behave like Penni-made ones. A voucher opening several
 * (an opening-balance voucher listing open items), or an erä whose opening row is missing,
 * gets `-rowId`: Penni only ever assigns positive voucher ids, so such keys never collide.
 * Kitsas's `-1` (UUSI_ERA, kitsas.h:58) is a save-time placeholder and never stored.
 */
export function luoEraKartta(
  rivit: readonly { id?: number; tosite: number; eraid: number | null }[],
): (eraid: number) => number {
  const avaajanTosite = new Map<number, number>();
  const avauksia = new Map<number, number>();
  for (const r of rivit) {
    if (r.id === undefined || r.eraid !== r.id) continue;
    avaajanTosite.set(r.id, r.tosite);
    avauksia.set(r.tosite, (avauksia.get(r.tosite) ?? 0) + 1);
  }
  return (eraid) => {
    const tosite = avaajanTosite.get(eraid);
    return tosite !== undefined && avauksia.get(tosite) === 1 ? tosite : -eraid;
  };
}

/**
 * Tosite json keys the importer carries over. `lasku` and `alv` are audited key by key. `id`
 * is Kitsas's redundant copy of the Tosite.id column (equal on all 85 rows that carry it in a
 * real book), so dropping it loses nothing.
 */
export const KASITELLYT_TOSITE_JSON = new Set(['tiliote', 'info', 'id']);
/** Nested Tosite json keys with a Penni counterpart; `alv` feeds the VAT-return check. */
export const KASITELLYT_TOSITE_SISAKKAISET: Record<string, ReadonlySet<string>> = {
  lasku: new Set(['numero', 'maksutapa', 'alkupNro']),
  alv: new Set(['koodit', 'kausialkaa', 'kausipaattyy', 'erapvm', 'maksettava']),
};

/**
 * Count non-empty json keys the importer does not carry over, as `<etuliite>.<avain>` →
 * occurrences. Feeds the coverage audit so nothing is dropped without the user being told.
 */
export function laskeKattamattomat(
  json: string | null,
  kasitellyt: ReadonlySet<string>,
  etuliite: string,
  kohde: Record<string, number>,
  sisakkaiset: Record<string, ReadonlySet<string>> = {},
): void {
  const arvot = lueJson(json);
  for (const [avain, arvo] of Object.entries(arvot)) {
    if (
      arvo === null ||
      arvo === '' ||
      (typeof arvo === 'object' && Object.keys(arvo).length === 0)
    )
      continue;
    const sisa = sisakkaiset[avain];
    if (sisa && typeof arvo === 'object' && !Array.isArray(arvo)) {
      laskeKattamattomat(JSON.stringify(arvo), sisa, `${etuliite}.${avain}`, kohde);
      continue;
    }
    if (kasitellyt.has(avain)) continue;
    const nimi = `${etuliite}.${avain}`;
    kohde[nimi] = (kohde[nimi] ?? 0) + 1;
  }
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
  // Same keys as Penni's TilioteTiedot (apuri/tiliote/tilioteapuri.cpp:166-168); tili may be a string.
  const tiliote = json.tiliote as Record<string, unknown> | undefined;
  if (
    tiliote &&
    typeof tiliote === 'object' &&
    Number.isFinite(Number(tiliote.tili)) &&
    typeof tiliote.alkupvm === 'string' &&
    typeof tiliote.loppupvm === 'string'
  ) {
    tosite.tiliote = {
      tili: Number(tiliote.tili),
      alkupvm: tiliote.alkupvm,
      loppupvm: tiliote.loppupvm,
    };
    if (typeof tiliote.iban === 'string' && tiliote.iban !== '') tosite.tiliote.iban = tiliote.iban;
  }
  if (typeof json.info === 'string' && json.info.trim() !== '') tosite.info = json.info;
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
