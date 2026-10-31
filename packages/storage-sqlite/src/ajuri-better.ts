import type {
  SqliteAjuri,
  SqliteKysely,
  SqliteRow,
  SqliteRunResult,
  SqliteValue,
} from '@penni/storage-sqlite-core';
import Database from 'better-sqlite3';

/** better-sqlite3 sitoo vain Bufferin BLOBiksi; muunna Uint8Array -> Buffer sidonnassa. */
function sidottavat(p: readonly SqliteValue[]): SqliteValue[] {
  return p.map((v) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v) : v));
}

/** Kääri jo avattu better-sqlite3-Database SqliteAjuriksi (ei avaa eikä aseta pragmoja). */
export function luoBetterSqliteAjuriDb(db: Database.Database): SqliteAjuri {
  const kysely: SqliteKysely = {
    run: (sql, p = []) => {
      const info = db.prepare(sql).run(...(sidottavat(p) as SqliteValue[]));
      return { lastInsertRowid: Number(info.lastInsertRowid) } satisfies SqliteRunResult;
    },
    get: (sql, p = []) =>
      db.prepare(sql).get(...(sidottavat(p) as SqliteValue[])) as SqliteRow | undefined,
    all: (sql, p = []) => db.prepare(sql).all(...(sidottavat(p) as SqliteValue[])) as SqliteRow[],
    exec: (sql) => {
      db.exec(sql);
    },
  };
  return {
    ...kysely,
    transaction: <T>(fn: (tx: SqliteKysely) => T): T => db.transaction(() => fn(kysely))(),
    close: () => db.close(),
  };
}

/** Kääri better-sqlite3-yhteys SqliteAjuriksi. Pragmat asetetaan tässä (ei ytimessä). */
export function luoBetterSqliteAjuri(tiedosto = ':memory:'): SqliteAjuri {
  const db = new Database(tiedosto);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return luoBetterSqliteAjuriDb(db);
}
