import type { Cents } from '@penni/euro';
import type { Tili, TiliData } from '../accounts/tili.js';
import type { Alkupera } from '../alv/alkupera.js';
import type { Liite, LiiteMeta, UusiLiite } from '../liitteet/liite.js';
import type { Kumppani, UusiKumppani } from '../partners/kumppani.js';
import type { IsoDate, Tosite, TositeVienti } from '../vouchers/types.js';

export type { TiliData };

/** Opaque ISO timestamp, supplied by the transport (keeps handlers clock-free/pure). */
export type IsoDateTime = string;

/** A persisted voucher: a Tosite plus its storage-assigned id. */
export interface StoredTosite extends Tosite {
  id: number;
}

/** A voucher as the list endpoint returns it: the stored voucher plus its attachment count
 *  (Kitsasin tositelistan `liitteita`, tositeroute.cpp:84-86). Never written back to storage. */
export interface ListattuTosite extends StoredTosite {
  liitteita: number;
  /** Kotimaa / EU / EU:n ulkopuoli (tositteenAlkupera); puuttuu kun sitä ei voi päätellä. */
  alkupera?: Alkupera;
}

/** Which state-bucket a voucher list returns (mirrors the legacy exclusive filter). */
export type TositeBucket = 'kirjanpidossa' | 'luonnos' | 'saapuneet' | 'malli' | 'poistetut';

export interface TositeFilter {
  bucket?: TositeBucket; // default 'kirjanpidossa' (tila >= 100)
  alkupvm?: IsoDate;
  loppupvm?: IsoDate;
  pvm?: IsoDate;
  kumppani?: number;
  tyyppi?: number;
  viite?: string;
}

/** A balance query. Returns raw Σdebet − Σkredit per account (debit-positive), posted only. */
export interface SaldoQuery {
  /** Inclusive lower date bound (period sums); omit = from inception. */
  alkupvm?: IsoDate;
  /** Upper date bound. */
  loppupvm: IsoDate;
  /** true => vienti.pvm < loppupvm (opening balances); default false => <= loppupvm. */
  loppupvmExclusive?: boolean;
  /** Exact single account number. */
  tili?: number;
  /** Lexicographic account-number lower bound, inclusive (String(numero) >= tiliAlkaen). */
  tiliAlkaen?: string;
  /** Lexicographic account-number upper bound, EXCLUSIVE (String(numero) < tiliAsti). */
  tiliAsti?: string;
  /** Cost-centre id filter; 0/undefined = all. */
  kohdennus?: number;
}

/** Audit/clock context for any mutation (the transport injects `aika`/`userId`). */
export interface AuditCtx {
  aika: IsoDateTime;
  userId?: number;
  /** Agent/tool provenance for audit rows (e.g. "cli", "agentti:kysy"). */
  lahde?: string;
}

/** One append-only audit-log row (Tositeloki). `data` is a full snapshot, or null on delete. */
export interface AuditEntry {
  tosite: number;
  tila: number;
  aika: IsoDateTime;
  userId?: number;
  /** Agent/tool provenance for audit rows (e.g. "cli", "agentti:kysy"). */
  lahde?: string;
  data: unknown | null;
}

export interface Tilikausi {
  alkaa: IsoDate;
  loppuu: IsoDate;
  [key: string]: unknown;
}

export type Asetukset = Record<string, string>;

/** patchAsetukset-kutsun syöte: null poistaa avaimen (kaikki backendit tukevat tätä jo). */
export type AsetuksetPatch = Record<string, string | null>;

/** The /init bootstrap bundle. `tilit` carries accounts AND headings (heading tyyppi = 'H<n>'). */
export interface InitBundle {
  asetukset: Asetukset;
  tilit: TiliData[];
  tilikaudet: Tilikausi[];
  tositesarjat: string[];
  kohdennukset: unknown[]; // empty in Tier-0
}

/** What /init PATCH merges (template re-application; user-modified rows are skipped). */
export interface InitPatch {
  asetukset?: Asetukset;
  tilit?: TiliData[];
}

/**
 * The storage port. Local (in-memory/SQLite-WASM) and cloud (Postgres) all implement this.
 * Single-writer-per-book is assumed (the transport serializes writers), so maxTunniste +
 * saveTosite need not share one transaction in the in-memory adapter; SQL adapters make the
 * save path atomic internally.
 */
export interface Storage {
  // --- vouchers ---
  getTosite(id: number): Promise<StoredTosite | null>;
  listTositteet(filter: TositeFilter): Promise<StoredTosite[]>;
  listViennit(filter: { alkupvm?: IsoDate; loppupvm?: IsoDate; tili?: number }): Promise<
    TositeVienti[]
  >;
  /** Upsert (insert if no id) + append a full-snapshot audit entry. Returns the stored voucher. */
  saveTosite(t: Tosite & { id?: number }, audit: AuditCtx): Promise<StoredTosite>;
  /** Update only tila+tunniste + append an audit entry with the given snapshot `data`. */
  patchTositeTila(
    id: number,
    tila: number,
    tunniste: number,
    audit: AuditCtx,
    data: unknown,
  ): Promise<StoredTosite>;
  /** Soft delete: set tila=0 + append an audit entry (data null). */
  softDeleteTosite(id: number, audit: AuditCtx): Promise<void>;
  /** MAX(tunniste) over finalized (tila>=100) vouchers in [alkaa,loppuu] and the series bucket (null = own bucket). 0 if none. */
  maxTunniste(alkaa: IsoDate, loppuu: IsoDate, sarja: string | null): Promise<number>;
  /** Raw balances (Σdebet − Σkredit cents, debit-positive) per account for the query, posted only. */
  querySaldot(q: SaldoQuery): Promise<Map<number, Cents>>;
  /** Σ(debet − kredit) per era over POSTED vouchers (tila ≥ 100); viennit without an era are
   *  skipped. Positive = still open (AR is an asset). `saldopvm` bounds by vienti.pvm ≤ saldopvm. */
  queryErat(q: { saldopvm?: IsoDate }): Promise<Map<number, Cents>>;
  getLoki(tositeId: number): Promise<AuditEntry[]>;

  // --- master data (read) ---
  getChart(): Promise<Tili[]>;
  getTilikaudet(): Promise<Tilikausi[]>;
  getAsetukset(): Promise<Asetukset>;
  getInit(): Promise<InitBundle>;

  // --- master data (write) ---
  /**
   * Upsert one chart row, keyed by (numero, taso). The level is derived from `data.tyyppi`
   * via tasoTyypista — leaf accounts are level 0, a heading 'H<n>' is level n. Stamps muokattu.
   */
  putTili(numero: number, data: TiliData): Promise<void>;
  /** Delete one chart row. `taso` omitted = the leaf account (level 0). */
  deleteTili(numero: number, taso?: number): Promise<void>;
  putTilikausi(alkaa: IsoDate, kausi: Tilikausi): Promise<void>;
  deleteTilikausi(alkaa: IsoDate): Promise<void>;
  patchAsetukset(patch: AsetuksetPatch): Promise<void>; // stamps muokattu; null value deletes
  patchInit(patch: InitPatch): Promise<void>; // template merge, skips muokattu rows, does NOT stamp muokattu

  // --- kumppanit (partners) ---
  getKumppanit(): Promise<Kumppani[]>;
  /** Upsert: assigns an id on insert (like saveTosite); returns the stored partner. */
  saveKumppani(kumppani: UusiKumppani): Promise<Kumppani>;
  deleteKumppani(id: number): Promise<void>;

  // --- liitteet (attachments) ---
  getLiitteet(tosite: number): Promise<LiiteMeta[]>; // metadata only, no blob
  /** Liitteiden lukumäärä tositteittain (COUNT … GROUP BY tosite, ei blobeja). Vain tositteet,
   *  joilla on ≥ 1 liite, ovat kartassa — puuttuva avain = 0. Listojen kuittimerkintää varten
   *  (vrt. Kitsasin tositelista, kitsas-source/kitsas/sqlite/routes/tositeroute.cpp:84-86). */
  laskeLiitteet(): Promise<Map<number, number>>;
  getLiite(id: number): Promise<Liite | null>; // full record incl. data
  saveLiite(liite: UusiLiite): Promise<LiiteMeta>; // insert / upsert-by-role
  deleteLiite(id: number): Promise<void>;
}

/** Per-request environment the resource handlers need beyond storage. */
export interface ResourceEnv {
  aika: IsoDateTime;
  userId?: number;
  /** Agent/tool provenance for audit rows (e.g. "cli", "agentti:kysy"). */
  lahde?: string;
  /** Tier-0: omit -> () => false. Tier-1 wires real reported-VAT-period data. */
  onkoAlvIlmoitettu?: (pvm: IsoDate) => boolean;
}

/** A rejected operation (period lock, finalize blocked, not found, no fiscal year, ...). */
export class ResourceError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ResourceError';
  }
}
