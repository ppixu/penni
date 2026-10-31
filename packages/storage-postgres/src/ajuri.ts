import { PGlite } from '@electric-sql/pglite';

/** Se osa PGliten (ja transaktio-olion) pinnasta, jota kysely-kääre lukee. */
type KyselyPinta = { query: PGlite['query']; exec: PGlite['exec'] };

/** A minimal SQL execution surface (satisfied by PGlite and, later, a pg.Pool wrapper). */
export interface PgKysely {
  /** Parameterized single-statement query (extended/prepared protocol). */
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /**
   * Run one or more parameter-free SQL statements (simple-query protocol). Needed for the
   * multi-statement DDL schema blocks — PGlite's prepared-statement `query()` rejects
   * "multiple commands into a prepared statement", so DDL must go through `exec()`. The future
   * pg.Pool wrapper maps this to `pool.query(text)` (no params), which is also simple-protocol.
   */
  exec(text: string): Promise<void>;
}

/** A connection: queries, transactions, and close. The adapter is written against this. */
export interface PgAjuri extends PgKysely {
  transaction<T>(fn: (tx: PgKysely) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * A PGlite-backed PgAjuri (embedded Postgres, WASM). `dataDir` persists to the filesystem
 * (Node) — omit for an in-memory database. The cloud deployment provides a pg.Pool-backed
 * PgAjuri over the same SQL (apps/server tier).
 */
export async function luoPglite(dataDir?: string): Promise<PgAjuri> {
  const db = await PGlite.create(dataDir);
  const kysely = (q: KyselyPinta): PgKysely => ({
    async query(text, params) {
      const r = await q.query(text, params as unknown[] | undefined);
      return { rows: r.rows as Record<string, unknown>[] };
    },
    async exec(text) {
      await q.exec(text);
    },
  });
  return {
    query: (text, params) => kysely(db).query(text, params),
    exec: (text) => kysely(db).exec(text),
    transaction: (fn) => db.transaction(async (tx) => fn(kysely(tx))),
    close: () => db.close(),
  };
}
