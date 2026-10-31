import { DurableObject } from 'cloudflare:workers';
import {
  type Liitevarasto,
  type SqliteCoreSeed,
  type SqliteCoreStorage,
  createSqliteCoreStorage,
} from '@penni/storage-sqlite-core';
import { type SqlHavainto, luoDoSqliteAjuri } from './ajuri-do.js';
import { luoR2Liitevarasto } from './liitevarasto-r2.js';

/** Sidonnat, joita kirjan DO käyttää, jos ne on annettu. */
export interface KirjaDOEnv {
  /**
   * R2-bucket liitteiden tavuille. Annettuna liitteet menevät R2:een avaimella
   * `kirja/<kirjaId>/liite/<sha256>` ja SQLiteen jää vain metatieto; puuttuessa tavut ovat
   * SQLite-rivillä kuten paikallisissa adaptereissa.
   */
  LIITTEET?: R2Bucket;
}

/** DO:n omaan KV:hen tallennettu kirjaId (R2-avaimen etuliite), jotta se säilyy evictionin yli. */
const KIRJA_ID_AVAIN = 'kirjaId';

/**
 * Yksi kirjanpito = yksi Durable Object. Pitää yhden `createSqliteCoreStorage`-instanssin
 * DO:n omaa SQLitea vasten; migraatiot ajetaan ensimmäisellä käytöllä. Siemen otetaan huomioon
 * vain tyhjässä kannassa (ydin ei koskaan ylikirjoita olemassa olevaa kirjaa).
 * Worker (apps/pilvi) vie tämän luokan ja lisää omat RPC-metodinsa aliluokassa tai rinnalle.
 */
export class KirjaDO extends DurableObject<KirjaDOEnv> {
  #kirja: SqliteCoreStorage | undefined;

  /**
   * Valinnainen SQL-havainnoija (rowsRead/rowsWritten per lause); aliluokka asettaa sen
   * konstruktorissa ennen ensimmäistä `kirja()`-kutsua. Mittausta varten, ei tuotantopolulla.
   */
  protected sqlHavainto: SqlHavainto | undefined;

  /**
   * Kirjan Storage; luodaan (migraatiot + mahdollinen siemen) ensimmäisellä kutsulla.
   * `kirjaId` tarvitaan vain, kun LIITTEET-sidonta on annettu (R2-avaimen etuliite): Worker antaa
   * sen, DO tallettaa sen KV:hen, ja myöhemmät kutsut (myös evictionin jälkeen) lukevat sieltä.
   */
  kirja(seed: SqliteCoreSeed = {}, kirjaId?: string): SqliteCoreStorage {
    this.#kirja ??= createSqliteCoreStorage(
      luoDoSqliteAjuri(this.ctx.storage, this.sqlHavainto),
      seed,
      {
        liitevarasto: this.#liitevarasto(kirjaId),
      },
    );
    return this.#kirja;
  }

  #liitevarasto(kirjaId: string | undefined): Liitevarasto | undefined {
    const bucket = this.env.LIITTEET;
    if (!bucket) return undefined;
    const kv = this.ctx.storage.kv;
    const id = kirjaId ?? kv.get<string>(KIRJA_ID_AVAIN);
    if (id === undefined) {
      throw new Error('KirjaDO: kirjaId puuttuu (LIITTEET on sidottu, mutta kirjaa ei alustettu)');
    }
    if (kirjaId !== undefined) kv.put(KIRJA_ID_AVAIN, kirjaId);
    return luoR2Liitevarasto(bucket, id);
  }
}
