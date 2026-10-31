import type { PgAjuri } from './ajuri.js';
import { SCHEMA_VERSIONS } from './schema.js';

/**
 * Apply not-yet-applied schema versions in order, each in its own transaction, recording the
 * version in `migraatio`. Idempotent. `ajettu` is stamped by Postgres `now()` (clock-free runner).
 */
export async function ajaMigraatiot(ajuri: PgAjuri): Promise<void> {
  await ajuri.query(
    'CREATE TABLE IF NOT EXISTS migraatio (versio INTEGER PRIMARY KEY, ajettu TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  const { rows } = await ajuri.query('SELECT versio FROM migraatio');
  const tehdyt = new Set<number>(rows.map((r) => Number(r.versio)));
  for (let i = 0; i < SCHEMA_VERSIONS.length; i++) {
    if (tehdyt.has(i)) continue;
    const sql = SCHEMA_VERSIONS[i] as string;
    await ajuri.transaction(async (tx) => {
      await tx.exec(sql); // monilauseinen DDL → simple-protocol (PGlite hylkää valmistellut monilauseet)
      await tx.query('INSERT INTO migraatio (versio) VALUES ($1)', [i]);
    });
  }
}
