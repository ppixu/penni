import type {
  SqliteAjuri,
  SqliteKysely,
  SqliteRow,
  SqliteRunResult,
  SqliteValue,
} from '@penni/storage-sqlite-core';
import type { Database } from '@sqlite.org/sqlite-wasm';

/**
 * Kääri sqlite-wasm OO1 -tietokantakahva SqliteAjuriksi. Sama SQL kuin better-sqlite3-polulla;
 * vain kutsumekaniikka eroaa. Synkroninen (OO1 SAHPool ajaa Workerissa synkronisesti).
 */
export function luoOo1Ajuri(db: Database): SqliteAjuri {
  // OO1 heittää "no bindable parameters", jos parametriton lause saa bind-arvon (myös tyhjän
  // taulukon). better-sqlite3 sietää tyhjän paramlistan, joten normalisoi tyhjä -> undefined,
  // jotta SAMA SQL + paramlista toimii kummallakin ajurilla.
  const sido = (p: readonly SqliteValue[]): SqliteValue[] | undefined =>
    p.length > 0 ? (p as SqliteValue[]) : undefined;
  const kysely: SqliteKysely = {
    run: (sql, p = []) => {
      // exactOptionalPropertyTypes: jätä bind kokonaan pois, kun parametreja ei ole.
      const bind = sido(p);
      db.exec(bind === undefined ? { sql } : { sql, bind });
      // OO1:llä ei ole RunResultia — hae rowid kuten SQLiten C-API sen tarjoaa.
      const id = db.selectValue('SELECT last_insert_rowid()');
      return { lastInsertRowid: Number(id) } satisfies SqliteRunResult;
    },
    get: (sql, p = []) => db.selectObject(sql, sido(p)) as SqliteRow | undefined,
    all: (sql, p = []) => db.selectObjects(sql, sido(p)) as SqliteRow[],
    exec: (sql) => {
      db.exec(sql); // pelkkä merkkijono ajaa monilauseisen DDL:n
    },
  };
  return {
    ...kysely,
    // OO1:n transaction on synkroninen ja kutsutaan kerran (ei toista ()-kutsua).
    transaction: <T>(fn: (tx: SqliteKysely) => T): T => db.transaction(() => fn(kysely)),
    close: () => db.close(),
  };
}
