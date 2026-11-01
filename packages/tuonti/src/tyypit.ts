import type {
  Asetukset,
  AuditEntry,
  BudjettiRivi,
  IsoDate,
  TiliData,
  Tilikausi,
  Tosite,
  UusiKohdennus,
  UusiKumppani,
  UusiLiite,
} from '@penni/engine';

/** A voucher read from a Kitsas book: a Penni Tosite plus its original Kitsas id. */
export type KitsasTosite = Tosite & { id: number };

/** An attachment read from Kitsas, still carrying the Kitsas voucher id it belongs to. */
export type KitsasLiite = UusiLiite;

/** A whole Kitsas book, read into memory. No SQLite handles survive past lueKitsas(). */
export interface KitsasKirja {
  /** Chart accounts AND headings (headings carry tyyppi 'H<taso>'). */
  tilit: TiliData[];
  tilikaudet: Tilikausi[];
  asetukset: Asetukset;
  kumppanit: UusiKumppani[];
  /** Kustannuspaikat, projektit ja merkkaukset (Kitsas-id:t säilytetty; Yleinen on implisiittinen). */
  kohdennukset: UusiKohdennus[];
  /** Vuosibudjetit tilikausittain (tilikauden `alkaa`). */
  budjetit: { tilikausi: IsoDate; rivit: BudjettiRivi[] }[];
  tositteet: KitsasTosite[];
  liitteet: KitsasLiite[];
  /** Kitsas KpVersio setting, for the compatibility warning. */
  kpVersio: string;
  /** Tables present in the source but not modelled by Penni: table name -> row count. */
  ohitetut: Record<string, number>;
  /**
   * The source book's own change history (Kitsas `Tositeloki`), oldest first, each row marked
   * `lahde: 'kitsas'`. `data` is Kitsas's snapshot in Kitsas's own format, kept verbatim.
   */
  loki: AuditEntry[];
  /**
   * Coverage audit: source fields with content that the import does not carry over, as
   * `Taulu.json.avain` (or a descriptive label) -> occurrences. Empty = nothing was dropped.
   */
  kattamattomat: Record<string, number>;
  /** VAT returns filed in Kitsas, for recomputing each period in Penni after the import. */
  alvIlmoitukset: KitsasAlvIlmoitus[];
}

/**
 * One VAT return filed in Kitsas: the ALVLASKELMA voucher's json `alv`
 * (alv/alvlaskelma.cpp:950-967 — `koodit` in cents, `maksettava` in euros).
 */
export interface KitsasAlvIlmoitus {
  tosite: number;
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  /** Code 308: tax payable (negative = refund), cents. */
  maksettava: number;
  /** Return code -> amount in cents, as filed. May be empty for an all-zero return. */
  koodit: Record<number, number>;
}

/** Progress event emitted while writing. `tehty`/`kaikkiaan` are row counts within `vaihe`. */
export interface TuontiEdistyminen {
  vaihe: 'tilit' | 'tilikaudet' | 'asetukset' | 'kumppanit' | 'tositteet' | 'liitteet';
  tehty: number;
  kaikkiaan: number;
}

/** What was written, plus anything the user should know about. */
export interface TuontiRaportti {
  tilit: number;
  tilikaudet: number;
  asetukset: number;
  kumppanit: number;
  tositteet: number;
  viennit: number;
  liitteet: number;
  /** Tables not imported: table name -> row count. */
  ohitetut: Record<string, number>;
  /** Kitsas change-history rows carried over. */
  loki: number;
  /** Human-readable Finnish warnings (unknown tyyppi, unexpected KpVersio, ...). */
  varoitukset: string[];
}

/** One VAT-return figure that Penni recomputes differently from what was filed in Kitsas. */
export interface AlvEro {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  koodi: number;
  kitsas: number;
  penni: number;
}

/** One account whose balance disagrees between source and destination. */
export interface TaysmaytysEro {
  tilikausi: IsoDate;
  tili: number;
  kitsas: number;
  penni: number;
}

/** Reconciliation outcome. `tasmaa` false => at least one balance or count disagrees. */
export interface TaysmaytysRaportti {
  tasmaa: boolean;
  erot: TaysmaytysEro[];
  /** Count comparisons: label -> [kitsas, penni]. */
  maarat: Record<string, [number, number]>;
  /**
   * Count of source ledger rows, on finalized vouchers only, whose date falls within no
   * fiscal year. Such rows are queried by neither side of the balance comparison, so they
   * would otherwise be invisible to reconciliation. Must be 0 for `tasmaa` to be true.
   */
  ulkopuoliset: number;
  /**
   * Every VAT return filed in Kitsas, recomputed by Penni's own VAT engine over the imported
   * data. Unlike the balance check (both sides sum the same rows), this tests that Penni
   * INTERPRETS the rows as Kitsas did. Must be empty for `tasmaa` to be true.
   */
  alvErot: AlvEro[];
  /** Filed VAT returns that were checked. */
  alvIlmoituksia: number;
  /** Coverage audit carried over from the read (see KitsasKirja.kattamattomat); informational. */
  kattamattomat: Record<string, number>;
}

/**
 * The surface the import UI calls. Implemented by Electron IPC in apps/desktop and by a
 * stub in web tests. Kept here so both plans agree on one contract.
 */
export interface TuontiSilta {
  /** Native open dialog + read; null if the user cancelled. */
  valitseJaLue(): Promise<{ polku: string; yhteenveto: KitsasYhteenveto } | null>;
  /** Native save dialog, import, reconcile. Rejects on read/write failure. */
  tuo(
    polku: string,
    edistyminen: (e: TuontiEdistyminen) => void,
  ): Promise<{ kohde: string; raportti: TuontiRaportti; taysmaytys: TaysmaytysRaportti } | null>;
  /** Switch the running app over to the freshly imported book. */
  avaaKirja(polku: string): Promise<void>;
}

/** The open book and the recently opened ones, as the desktop main process knows them. */
export interface KirjaTiedot {
  /** Absolute path of the open `.penni` file; null for the built-in default book. */
  nykyinen: string | null;
  /** Most recent first; includes `nykyinen`. */
  viimeisimmat: string[];
}

/**
 * Book switching from inside the app. Implemented by Electron IPC in apps/desktop. Switching
 * reloads the window onto the other book's local server, so the returned promises may never
 * settle from the page's point of view — callers must not rely on them resolving.
 */
export interface KirjatSilta {
  kirjat(): Promise<KirjaTiedot>;
  /** Open a book from the recent list. Paths not on that list are rejected by the main process. */
  vaihdaKirja(polku: string): Promise<void>;
  /** Native open dialog; does nothing if the user cancels. */
  valitseKirja(): Promise<void>;
  /** Drop a book from the recent list; the file is untouched. The open book cannot be dropped. */
  poistaViimeisin(polku: string): Promise<void>;
}

/** Kuitinlukumallin lataussuostumus työpöydällä (tallessa asetukset.json:ssa, ei kirjassa). */
export interface MalliSilta {
  malliLupa(): Promise<boolean>;
  annaMalliLupa(): Promise<void>;
}

/**
 * Näkymien suodatinmuisti työpöydällä (asetukset.json, ei kirjassa): kirjan sivu tarjoillaan joka
 * avauksella uudesta portista, joten sivun localStorage ei säily. Avaimet ovat näkymäavaimia
 * (esim. `tositteet`), arvot JSON-arvoja, jotka sivu tulkitsee kuten localStoragesta luetut.
 */
export interface SuodatinSilta {
  suodattimet(): Promise<Record<string, unknown>>;
  tallennaSuodatin(nakyma: string, arvo: unknown): Promise<void>;
}

/** What the preview screen shows before the user commits to importing. */
export interface KitsasYhteenveto {
  nimi: string;
  kpVersio: string;
  tilikaudet: { alkaa: IsoDate; loppuu: IsoDate }[];
  tilit: number;
  tositteet: number;
  viennit: number;
  liitteet: number;
  kumppanit: number;
  ohitetut: Record<string, number>;
}
