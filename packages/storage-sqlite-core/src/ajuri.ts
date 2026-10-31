/** Arvot, jotka SQLite-ajuri hyväksyy sidotuksi parametriksi / palauttaa rivissä. */
export type SqliteValue = string | number | bigint | null | Uint8Array;

/** Tulosrivi: sarakenimi -> arvo. Mapperit lukevat tiettyjä avaimia (esim. row.json). */
export type SqliteRow = Record<string, SqliteValue>;

/** Kirjoituksen tulos (ydin lukee tästä vain uuden rowid:n). */
export interface SqliteRunResult {
  /** Viimeisen INSERTin rowid (number; ajuri castaa bigintistä). */
  lastInsertRowid: number;
}

/**
 * Minimaalinen SYNKRONINEN SQLite-suorituspinta. Toteutetaan better-sqlite3-kääreellä (Node)
 * ja OO1 OpfsSAHPoolDb-kääreellä (selain-Worker). Kaikki neljä metodia ottavat sidotut
 * parametrit TAULUKKONA, joten SAMA SQL-merkkijono + parametrit ajetaan kummallakin ajurilla.
 * Vrt. PgKysely/PgAjuri, mutta synkroninen (molemmat SQLite-ajurit ajavat SQL:n synkronisesti).
 */
export interface SqliteKysely {
  /** Suorita kirjoitus; palauta uusi rowid (AUTOINCREMENT-id:n nostoa varten). */
  run(sql: string, params?: readonly SqliteValue[]): SqliteRunResult;
  /** Ensimmäinen osuva rivi tai undefined. */
  get(sql: string, params?: readonly SqliteValue[]): SqliteRow | undefined;
  /** Kaikki osuvat rivit. */
  all(sql: string, params?: readonly SqliteValue[]): SqliteRow[];
  /** Aja yksi tai useampi parametriton lause (monilauseinen DDL-lohko). */
  exec(sql: string): void;
}

/** Yhteys: kyselyt + synkroninen transaktio + sulkeminen. Ydin on kirjoitettu tätä vasten. */
export interface SqliteAjuri extends SqliteKysely {
  /** Aja fn atomisesti; fn:n paluuarvo palautetaan. Synkroninen (yksi atominen vuoro). */
  transaction<T>(fn: (tx: SqliteKysely) => T): T;
  close(): void;
}
