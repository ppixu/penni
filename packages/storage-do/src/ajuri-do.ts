import type {
  SqliteAjuri,
  SqliteKysely,
  SqliteRow,
  SqliteRunResult,
  SqliteValue,
} from '@penni/storage-sqlite-core';

/**
 * DO SQLite sitoo BLOBin ArrayBufferina eikä hyväksy bigintiä. Muunna Uint8Array omaksi
 * ArrayBufferikseen (näkymän offset/pituus huomioiden) ja turvallisen alueen bigint numeroksi.
 * Turvallisen alueen ulkopuolinen bigint hylätään — hiljaista tarkkuuden menetystä ei sallita.
 */
function sidottava(v: SqliteValue): SqlStorageValue {
  if (v instanceof Uint8Array) {
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
  }
  if (typeof v === 'bigint') {
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError(`DO SQLite ei voi sitoa bigintiä ${v} tarkasti`);
    }
    return Number(v);
  }
  return v;
}

/** Palautettu rivi: BLOB tulee ArrayBufferina, ydin odottaa Uint8Arrayta (kuten better-sqlite3). */
function rivi(r: Record<string, SqlStorageValue>): SqliteRow {
  const ulos: SqliteRow = {};
  for (const [avain, arvo] of Object.entries(r)) {
    ulos[avain] = arvo instanceof ArrayBuffer ? new Uint8Array(arvo) : arvo;
  }
  return ulos;
}

/**
 * Valinnainen havainnoija: kutsutaan jokaisen SQL-lauseen jälkeen kursorin `rowsRead`- ja
 * `rowsWritten`-luvuilla (DO SQLiten laskutusyksiköt). Mittausta varten (apps/pilvi, Q6); ilman
 * havainnoijaa ajuri ei laske mitään.
 */
export type SqlHavainto = (lause: { luettu: number; kirjoitettu: number }) => void;

/**
 * Kääri Durable Objectin `ctx.storage` SqliteAjuriksi. DO:n SQLite on synkroninen kuten
 * better-sqlite3 ja OO1, joten ydin ajaa saman SQL:n muuttamattomana:
 * - `run` ajaa lauseen loppuun ja lukee rowid:n `last_insert_rowid()`:llä (kursori ei kerro sitä);
 * - `exec` antaa monilauseisen DDL-lohkon suoraan `sql.exec`ille (parametriton, puolipiste-erotus);
 * - `transaction` = `transactionSync` (BEGIN/SAVEPOINT eivät ole sallittuja `sql.exec`issä).
 * Vierasavaimet ovat DO:ssa aina päällä (vrt. better-sqlite3-ajurin `foreign_keys = ON`).
 */
export function luoDoSqliteAjuri(
  storage: DurableObjectStorage,
  havainto?: SqlHavainto,
): SqliteAjuri {
  const sql = storage.sql;
  let suljettu = false;

  const aja = (lause: string, p: readonly SqliteValue[]): SqliteRow[] => {
    if (suljettu) throw new TypeError('The database connection is not open');
    const kursori = sql.exec(lause, ...p.map(sidottava));
    const rivit = kursori.toArray().map(rivi);
    // rowsRead/rowsWritten ovat valmiit vasta kun kursori on käyty läpi.
    havainto?.({ luettu: kursori.rowsRead, kirjoitettu: kursori.rowsWritten });
    return rivit;
  };

  const kysely: SqliteKysely = {
    run: (lause, p = []) => {
      aja(lause, p);
      const kursori = sql.exec<{ id: number }>('SELECT last_insert_rowid() AS id');
      const id = kursori.one().id;
      havainto?.({ luettu: kursori.rowsRead, kirjoitettu: kursori.rowsWritten });
      return { lastInsertRowid: Number(id) } satisfies SqliteRunResult;
    },
    get: (lause, p = []) => aja(lause, p)[0],
    all: (lause, p = []) => aja(lause, p),
    exec: (lause) => {
      aja(lause, []);
    },
  };

  return {
    ...kysely,
    transaction: <T>(fn: (tx: SqliteKysely) => T): T => {
      if (suljettu) throw new TypeError('The database connection is not open');
      return storage.transactionSync(() => fn(kysely));
    },
    // DO:lla ei ole suljettavaa yhteyttä; suljetaan vain tämä kääre (kuten better-sqlite3:n close).
    close: () => {
      suljettu = true;
    },
  };
}
