import type { SqliteAjuri } from './ajuri.js';
import { SCHEMA_VERSIONS } from './schema.js';

/**
 * Aja vielä ajamattomat skeemaversiot järjestyksessä, kukin omassa transaktiossaan, ja kirjaa
 * versio `migraatio`-tauluun. Idempotentti: uusinta ei aja mitään uutta. (`ajettu` leimataan
 * SQLiten CURRENT_TIMESTAMPilla, joten ajaja pysyy kelloriippumattomana.)
 */
export function ajaMigraatiot(ajuri: SqliteAjuri): void {
  ajuri.exec(
    'CREATE TABLE IF NOT EXISTS migraatio (versio INTEGER PRIMARY KEY NOT NULL, ajettu TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  const tehdyt = new Set<number>(
    ajuri.all('SELECT versio FROM migraatio').map((r) => Number(r.versio)),
  );
  for (let i = 0; i < SCHEMA_VERSIONS.length; i++) {
    if (tehdyt.has(i)) continue;
    const sql = SCHEMA_VERSIONS[i] as string;
    ajuri.transaction((tx) => {
      tx.exec(sql);
      tx.run('INSERT INTO migraatio (versio) VALUES (?)', [i]);
    });
  }
}
