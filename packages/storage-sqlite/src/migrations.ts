import { type SqliteAjuri, ajaMigraatiot as coreAjaMigraatiot } from '@penni/storage-sqlite-core';
import type Database from 'better-sqlite3';
import { luoBetterSqliteAjuriDb } from './ajuri-better.js';

/**
 * Yhteensopivuuskääre: hyväksyy joko valmiin SqliteAjurin tai better-sqlite3-Databasen
 * (jälkimmäisen vanhat testit/kutsujat antavat) ja delegoi ytimen ajajalle.
 */
export function ajaMigraatiot(db: Database.Database | SqliteAjuri): void {
  const ajuri =
    'transaction' in db && typeof db.transaction === 'function' && 'all' in db
      ? (db as SqliteAjuri)
      : luoBetterSqliteAjuriDb(db as Database.Database);
  coreAjaMigraatiot(ajuri);
}
