import { type ConformanceSeed, runResourceConformance } from '@penni/engine/conformance';
import { createSqliteCoreStorage } from '@penni/storage-sqlite-core';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { luoOo1Ajuri } from './ajuri-oo1.js';

// Yksi jaettu moduuli-init; jokainen makeStorage saa tuoreen muisti-DB:n.
const sqlite3 = await sqlite3InitModule();

runResourceConformance('@penni/storage-opfs (OO1 muisti)', (seed: ConformanceSeed) => {
  const db = new sqlite3.oo1.DB(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return createSqliteCoreStorage(luoOo1Ajuri(db), seed);
});
