import { DurableObject } from 'cloudflare:workers';
import {
  type ControlStore,
  type Kayttaja,
  type KayttajaTiedot,
  type Sessio,
  TunnistusVirhe,
  julkinen,
} from '@penni/control/ydin';

/**
 * Sama skeema kuin 5a:n Postgres-adapterissa (packages/control/src/postgres.ts) SQLite-murteella,
 * plus spiken pieni jäsenyystaulu (käyttäjä ↔ kirjaId). 5b:n kirjarekisteri ei kuulu spikeen.
 */
const SKEEMA = `
CREATE TABLE IF NOT EXISTS kayttaja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  nimi TEXT,
  salasana_hash TEXT NOT NULL,
  luotu TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessio (
  token_hash TEXT PRIMARY KEY,
  kayttaja_id INTEGER NOT NULL REFERENCES kayttaja(id),
  luotu TEXT NOT NULL,
  vanhenee TEXT NOT NULL,
  viimeksi_kaytetty TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jasenyys (
  kayttaja_id INTEGER NOT NULL REFERENCES kayttaja(id),
  kirja_id TEXT NOT NULL,
  PRIMARY KEY (kayttaja_id, kirja_id)
);
`;

type Rivi = Record<string, SqlStorageValue>;

function riviKayttajaksi(r: Rivi): KayttajaTiedot {
  const nimi = r.nimi;
  return {
    id: Number(r.id),
    email: String(r.email),
    salasanaHash: String(r.salasana_hash),
    luotu: String(r.luotu),
    ...(typeof nimi === 'string' ? { nimi } : {}),
  };
}

function riviSessioksi(r: Rivi): Sessio {
  return {
    tokenHash: String(r.token_hash),
    kayttajaId: Number(r.kayttaja_id),
    luotu: String(r.luotu),
    vanhenee: String(r.vanhenee),
    viimeksiKaytetty: String(r.viimeksi_kaytetty),
  };
}

/**
 * Kontrollitaso yhtenä Durable Objectina (EU): 5a:n ControlStore-portti DO:n SQLiten päällä.
 * Vain I/O — salasanan tiivistys ja sessiologiikka (@penni/control) ajetaan tilattomassa
 * Workerissa, jottei scrypt tukkisi tätä yhtä aktoria. Metodit ovat synkronisia; RPC tekee
 * niistä Workerille lupauksia.
 */
export class ControlDO extends DurableObject {
  readonly #sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    this.#sql.exec(SKEEMA);
  }

  /** null = sähköposti on jo käytössä (RPC ei säilytä virheluokkaa; ks. kontrolliStubista). */
  luoKayttaja(t: {
    email: string;
    salasanaHash: string;
    nimi?: string;
    aika: string;
  }): Kayttaja | null {
    const email = t.email.toLowerCase();
    const rivi = this.#sql
      .exec(
        `INSERT INTO kayttaja (email, nimi, salasana_hash, luotu) VALUES (?, ?, ?, ?)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        email,
        t.nimi ?? null,
        t.salasanaHash,
        t.aika,
      )
      .toArray()[0];
    if (!rivi) return null;
    return julkinen({
      id: Number(rivi.id),
      email,
      salasanaHash: t.salasanaHash,
      luotu: t.aika,
      ...(t.nimi !== undefined ? { nimi: t.nimi } : {}),
    });
  }

  haeKayttajaTiedot(id: number): KayttajaTiedot | null {
    const r = this.#sql.exec('SELECT * FROM kayttaja WHERE id = ?', id).toArray()[0];
    return r ? riviKayttajaksi(r) : null;
  }

  haeKayttajaEmaililla(email: string): KayttajaTiedot | null {
    const r = this.#sql
      .exec('SELECT * FROM kayttaja WHERE email = ?', email.toLowerCase())
      .toArray()[0];
    return r ? riviKayttajaksi(r) : null;
  }

  paivitaSalasana(id: number, salasanaHash: string): void {
    this.#sql.exec('UPDATE kayttaja SET salasana_hash = ? WHERE id = ?', salasanaHash, id);
  }

  luoSessio(s: Sessio): void {
    this.#sql.exec(
      `INSERT INTO sessio (token_hash, kayttaja_id, luotu, vanhenee, viimeksi_kaytetty)
       VALUES (?, ?, ?, ?, ?)`,
      s.tokenHash,
      s.kayttajaId,
      s.luotu,
      s.vanhenee,
      s.viimeksiKaytetty,
    );
  }

  haeSessio(tokenHash: string): Sessio | null {
    const r = this.#sql.exec('SELECT * FROM sessio WHERE token_hash = ?', tokenHash).toArray()[0];
    return r ? riviSessioksi(r) : null;
  }

  poistaSessio(tokenHash: string): void {
    this.#sql.exec('DELETE FROM sessio WHERE token_hash = ?', tokenHash);
  }

  lisaaJasenyys(kayttajaId: number, kirjaId: string): void {
    this.#sql.exec(
      'INSERT OR IGNORE INTO jasenyys (kayttaja_id, kirja_id) VALUES (?, ?)',
      kayttajaId,
      kirjaId,
    );
  }

  onJasen(kayttajaId: number, kirjaId: string): boolean {
    return (
      this.#sql
        .exec(
          'SELECT 1 AS x FROM jasenyys WHERE kayttaja_id = ? AND kirja_id = ?',
          kayttajaId,
          kirjaId,
        )
        .toArray().length > 0
    );
  }
}

/** ControlStore + spiken jäsenyyshaku, Worker-puolen näkymä Control DO:hon. */
export interface Kontrolli extends ControlStore {
  lisaaJasenyys(kayttajaId: number, kirjaId: string): Promise<void>;
  onJasen(kayttajaId: number, kirjaId: string): Promise<boolean>;
}

/**
 * Sovita Control DO:n RPC-stub ControlStore-portiksi, jotta 5a:n tunnistuslogiikka
 * (rekisteroi/kirjaudu/haeMinut/…) ajetaan muuttamattomana. Varattu sähköposti palaa DO:sta
 * nullina ja muutetaan tässä TunnistusVirheeksi (luokka ei säily RPC-rajan yli).
 */
export function kontrolliStubista(stub: DurableObjectStub<ControlDO>): Kontrolli {
  return {
    async luoKayttaja(t) {
      const k = await stub.luoKayttaja(t);
      if (!k) throw new TunnistusVirhe('EMAIL_VARATTU');
      return k as Kayttaja;
    },
    haeKayttajaTiedot: async (id) => (await stub.haeKayttajaTiedot(id)) as KayttajaTiedot | null,
    haeKayttajaEmaililla: async (email) =>
      (await stub.haeKayttajaEmaililla(email)) as KayttajaTiedot | null,
    paivitaSalasana: async (id, hash) => {
      await stub.paivitaSalasana(id, hash);
    },
    luoSessio: async (s) => {
      await stub.luoSessio(s);
    },
    haeSessio: async (tokenHash) => (await stub.haeSessio(tokenHash)) as Sessio | null,
    poistaSessio: async (tokenHash) => {
      await stub.poistaSessio(tokenHash);
    },
    lisaaJasenyys: async (kayttajaId, kirjaId) => {
      await stub.lisaaJasenyys(kayttajaId, kirjaId);
    },
    onJasen: (kayttajaId, kirjaId) => stub.onJasen(kayttajaId, kirjaId),
  };
}
