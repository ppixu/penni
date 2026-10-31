import { PGlite } from '@electric-sql/pglite';

type KyselyPinta = { query: PGlite['query']; exec: PGlite['exec'] };

export interface PgKysely {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  exec(text: string): Promise<void>;
}
export interface PgAjuri extends PgKysely {
  transaction<T>(fn: (tx: PgKysely) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** PGlite-pohjainen PgAjuri (upotettu Postgres, WASM). Tuotanto tarjoaa pg.Pool-pohjaisen ajurin. */
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
