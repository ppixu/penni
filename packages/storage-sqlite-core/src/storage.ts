import { ResourceError, lataaKartta, tasoTyypista } from '@penni/engine';
import type {
  Asetukset,
  AuditEntry,
  Kumppani,
  LiiteMeta,
  SaldoQuery,
  Storage,
  StoredTosite,
  TiliData,
  Tilikausi,
  TositeFilter,
  TositeVienti,
  UusiKumppani,
  UusiLiite,
} from '@penni/engine';
import type { Cents } from '@penni/euro';
import type { SqliteAjuri, SqliteValue } from './ajuri.js';
import { type Liitevarasto, sha256Heksa } from './liitevarasto.js';
import { ajaMigraatiot } from './migrations.js';

const KIRJANPIDOSSA = 100;

/** Seed-data tuoreelle tietokannalle (sama muoto kuin conformance/memory-siemen). */
export interface SqliteCoreSeed {
  tilit?: TiliData[];
  tilikaudet?: Tilikausi[];
  asetukset?: Asetukset;
}

/** Valinnaiset riippuvuudet. */
export interface SqliteCoreOptions {
  /**
   * Liitteiden tavujen paikka. Annettuna tavut menevät sinne ja SQLite-riville jää vain
   * metatieto + avain; puuttuessa tavut tallennetaan riville (kaikki paikalliset adapterit).
   */
  liitevarasto?: Liitevarasto | undefined;
}

/** Storage-toteutus + close()-kahva yhteydelle. */
export interface SqliteCoreStorage extends Storage {
  close(): void;
}

/** tila-SQL-ehto listabucketille (peilaa memory.ts:n bucketPredicatea). */
function bucketEhto(bucket: TositeFilter['bucket']): string {
  switch (bucket ?? 'kirjanpidossa') {
    case 'kirjanpidossa':
      return 'tila >= 100';
    case 'luonnos':
      return 'tila >= 50 AND tila < 100';
    case 'saapuneet':
      return 'tila > 5 AND tila < 50';
    case 'malli':
      return 'tila = 5';
    case 'poistetut':
      return 'tila = 0';
  }
}

/**
 * Ydinadapteri: koko Storage-toteutus SqliteAjuria vasten. better-sqlite3 (Node) ja OO1
 * OpfsSAHPoolDb (selain-Worker) kääräisevät kumpikin oman ajurinsa; SQL on byte-identtinen.
 * Ajaa migraatiot ja siementää tyhjän tietokannan.
 */
export function createSqliteCoreStorage(
  ajuri: SqliteAjuri,
  seed: SqliteCoreSeed = {},
  valinnat: SqliteCoreOptions = {},
): SqliteCoreStorage {
  const { liitevarasto } = valinnat;
  ajaMigraatiot(ajuri);

  // Siemennä vain tuore (tyhjä) kanta — älä koskaan ylikirjoita uudelleenavattua, pysyvää.
  const tyhja =
    Number(ajuri.get('SELECT COUNT(*) AS n FROM tili')?.n ?? 0) === 0 &&
    Number(ajuri.get('SELECT COUNT(*) AS n FROM asetus')?.n ?? 0) === 0 &&
    Number(ajuri.get('SELECT COUNT(*) AS n FROM tilikausi')?.n ?? 0) === 0;
  if (tyhja) {
    ajuri.transaction((tx) => {
      for (const t of seed.tilit ?? []) {
        const taso = tasoTyypista(typeof t.tyyppi === 'string' ? t.tyyppi : '');
        tx.run(
          'INSERT OR REPLACE INTO tili (numero, taso, tyyppi, json, muokattu) VALUES (?, ?, ?, ?, 0)',
          [Number(t.numero), taso, String(t.tyyppi ?? ''), JSON.stringify(t)],
        );
      }
      for (const k of seed.tilikaudet ?? [])
        tx.run('INSERT OR REPLACE INTO tilikausi (alkaa, loppuu, json) VALUES (?, ?, ?)', [
          k.alkaa,
          k.loppuu,
          JSON.stringify(k),
        ]);
      for (const [avain, arvo] of Object.entries(seed.asetukset ?? {}))
        tx.run('INSERT OR REPLACE INTO asetus (avain, arvo, muokattu) VALUES (?, ?, 0)', [
          avain,
          arvo,
        ]);
    });
  }

  /** Liitteen tavut riville (ei varastoa) tai varastoon (rivillä tyhjä data + avain). */
  async function sijoitaTavut(
    tavut: Uint8Array,
  ): Promise<{ data: Uint8Array; varastoAvain: string | null; koko: number }> {
    if (!liitevarasto) return { data: tavut, varastoAvain: null, koko: tavut.byteLength };
    const avain = await liitevarasto.tallenna(await sha256Heksa(tavut), tavut);
    return { data: new Uint8Array(0), varastoAvain: avain, koko: tavut.byteLength };
  }

  const storage: SqliteCoreStorage = {
    close() {
      ajuri.close();
    },

    async getTosite(id) {
      const row = ajuri.get('SELECT json FROM tosite WHERE id = ?', [id]);
      return row ? (JSON.parse(row.json as string) as StoredTosite) : null;
    },

    async listTositteet(filter) {
      const ehdot: string[] = [bucketEhto(filter.bucket)];
      const params: SqliteValue[] = [];
      if (filter.alkupvm !== undefined) {
        ehdot.push('pvm >= ?');
        params.push(filter.alkupvm);
      }
      if (filter.loppupvm !== undefined) {
        ehdot.push('pvm <= ?');
        params.push(filter.loppupvm);
      }
      if (filter.pvm !== undefined) {
        ehdot.push('pvm = ?');
        params.push(filter.pvm);
      }
      if (filter.tyyppi !== undefined) {
        ehdot.push('tyyppi = ?');
        params.push(filter.tyyppi);
      }
      if (filter.kumppani !== undefined) {
        ehdot.push('kumppani = ?');
        params.push(filter.kumppani);
      }
      if (filter.viite !== undefined) {
        ehdot.push('viite = ?');
        params.push(filter.viite);
      }
      const rows = ajuri.all(
        `SELECT json FROM tosite WHERE ${ehdot.join(' AND ')} ORDER BY pvm, id`,
        params,
      );
      return rows.map((r) => JSON.parse(r.json as string) as StoredTosite);
    },

    async listViennit(filter) {
      const rows = ajuri.all(`SELECT json FROM tosite WHERE tila >= ${KIRJANPIDOSSA} ORDER BY id`);
      const out: TositeVienti[] = [];
      for (const r of rows) {
        const t = JSON.parse(r.json as string) as StoredTosite;
        for (const vienti of t.viennit) {
          if (filter.alkupvm !== undefined && vienti.pvm < filter.alkupvm) continue;
          if (filter.loppupvm !== undefined && vienti.pvm > filter.loppupvm) continue;
          if (filter.tili !== undefined && vienti.tili !== filter.tili) continue;
          out.push(vienti);
        }
      }
      return out;
    },

    async saveTosite(t, audit) {
      return ajuri.transaction((tx): StoredTosite => {
        let id = t.id;
        if (id === undefined) {
          // Minimirivi AUTOINCREMENT-id:n saamiseksi; alla oleva upsert täydentää sen.
          const info = tx.run(
            'INSERT INTO tosite (pvm, tyyppi, tila, tunniste, sarja, kumppani, viite, laskupvm, erapvm, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              t.pvm,
              t.tyyppi,
              t.tila,
              t.tunniste,
              t.sarja,
              t.kumppani ?? null,
              t.viite ?? null,
              t.laskupvm ?? null,
              t.erapvm ?? null,
              '{}',
            ],
          );
          id = Number(info.lastInsertRowid);
        }
        const { id: _drop, ...rest } = t;
        const stored: StoredTosite = { ...(rest as Omit<StoredTosite, 'id'>), id };
        // Upsert eikä INSERT OR REPLACE: REPLACE poistaa vanhan rivin, jolloin ON DELETE CASCADE
        // hävittäisi tositteen liitteet jokaisessa päivityksessä (vrt. Postgres-adapteri).
        tx.run(
          'INSERT INTO tosite (id, pvm, tyyppi, tila, tunniste, sarja, kumppani, viite, laskupvm, erapvm, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)' +
            ' ON CONFLICT (id) DO UPDATE SET pvm = excluded.pvm, tyyppi = excluded.tyyppi,' +
            ' tila = excluded.tila, tunniste = excluded.tunniste, sarja = excluded.sarja,' +
            ' kumppani = excluded.kumppani, viite = excluded.viite, laskupvm = excluded.laskupvm,' +
            ' erapvm = excluded.erapvm, json = excluded.json',
          [
            id,
            stored.pvm,
            stored.tyyppi,
            stored.tila,
            stored.tunniste,
            stored.sarja,
            stored.kumppani ?? null,
            stored.viite ?? null,
            stored.laskupvm ?? null,
            stored.erapvm ?? null,
            JSON.stringify(stored),
          ],
        );
        // vienti-taulu on saldojen summausta varten (querySaldot).
        tx.run('DELETE FROM vienti WHERE tosite = ?', [id]);
        stored.viennit.forEach((vienti, i) => {
          tx.run(
            'INSERT INTO vienti (tosite, rivi, tili, pvm, debetsnt, kreditsnt, kohdennus, eraid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
              id as number,
              i + 1,
              vienti.tili,
              vienti.pvm,
              vienti.debet,
              vienti.kredit,
              vienti.kohdennus ?? 0,
              vienti.era ?? null,
            ],
          );
        });
        tx.run(
          'INSERT INTO loki (tosite, aika, userid, lahde, tila, data) VALUES (?, ?, ?, ?, ?, ?)',
          [
            id,
            audit.aika,
            audit.userId ?? null,
            audit.lahde ?? null,
            stored.tila,
            JSON.stringify(stored),
          ],
        );
        return stored;
      });
    },

    async patchTositeTila(id, tila, tunniste, audit, data) {
      return ajuri.transaction((tx): StoredTosite => {
        const row = tx.get('SELECT json FROM tosite WHERE id = ?', [id]);
        if (!row) throw new ResourceError('EITOSITETTA', `Tositetta ${id} ei ole`);
        const updated: StoredTosite = {
          ...(JSON.parse(row.json as string) as StoredTosite),
          tila,
          tunniste,
        };
        tx.run('UPDATE tosite SET tila = ?, tunniste = ?, json = ? WHERE id = ?', [
          tila,
          tunniste,
          JSON.stringify(updated),
          id,
        ]);
        tx.run(
          'INSERT INTO loki (tosite, aika, userid, lahde, tila, data) VALUES (?, ?, ?, ?, ?, ?)',
          [
            id,
            audit.aika,
            audit.userId ?? null,
            audit.lahde ?? null,
            tila,
            data === undefined ? null : JSON.stringify(data),
          ],
        );
        return updated;
      });
    },

    async softDeleteTosite(id, audit) {
      ajuri.transaction((tx) => {
        const row = tx.get('SELECT json FROM tosite WHERE id = ?', [id]);
        if (!row) throw new ResourceError('EITOSITETTA', `Tositetta ${id} ei ole`);
        const updated: StoredTosite = {
          ...(JSON.parse(row.json as string) as StoredTosite),
          tila: 0,
        };
        tx.run('UPDATE tosite SET tila = 0, json = ? WHERE id = ?', [JSON.stringify(updated), id]);
        tx.run(
          'INSERT INTO loki (tosite, aika, userid, lahde, tila, data) VALUES (?, ?, ?, ?, 0, NULL)',
          [id, audit.aika, audit.userId ?? null, audit.lahde ?? null],
        );
      });
    },

    async maxTunniste(alkaa, loppuu, sarja) {
      const sarjaEhto = sarja === null ? "(sarja = '' OR sarja IS NULL)" : 'sarja = ?';
      const params: SqliteValue[] = sarja === null ? [alkaa, loppuu] : [alkaa, loppuu, sarja];
      const row = ajuri.get(
        `SELECT MAX(tunniste) AS m FROM tosite WHERE tila >= ${KIRJANPIDOSSA} AND pvm >= ? AND pvm <= ? AND ${sarjaEhto}`,
        params,
      );
      return Number(row?.m ?? 0);
    },

    async querySaldot(q: SaldoQuery) {
      const ehdot: string[] = ['t.tila >= 100'];
      const params: SqliteValue[] = [];
      if (q.alkupvm !== undefined) {
        ehdot.push('v.pvm >= ?');
        params.push(q.alkupvm);
      }
      ehdot.push(q.loppupvmExclusive ? 'v.pvm < ?' : 'v.pvm <= ?');
      params.push(q.loppupvm);
      if (q.tili !== undefined) {
        ehdot.push('v.tili = ?');
        params.push(q.tili);
      }
      if (q.tiliAlkaen !== undefined) {
        ehdot.push('CAST(v.tili AS TEXT) >= ?');
        params.push(q.tiliAlkaen);
      }
      if (q.tiliAsti !== undefined) {
        ehdot.push('CAST(v.tili AS TEXT) < ?');
        params.push(q.tiliAsti);
      }
      if (q.kohdennus !== undefined && q.kohdennus !== 0) {
        ehdot.push('v.kohdennus = ?');
        params.push(q.kohdennus);
      }
      const rows = ajuri.all(
        `SELECT v.tili AS tili, SUM(v.debetsnt - v.kreditsnt) AS saldo FROM vienti v JOIN tosite t ON v.tosite = t.id WHERE ${ehdot.join(
          ' AND ',
        )} GROUP BY v.tili`,
        params,
      );
      const out = new Map<number, Cents>();
      for (const r of rows) out.set(Number(r.tili), Number(r.saldo) as Cents);
      return out;
    },

    async queryErat(q) {
      const ehdot: string[] = ['t.tila >= 100', 'v.eraid IS NOT NULL'];
      const params: SqliteValue[] = [];
      if (q.saldopvm !== undefined) {
        ehdot.push('v.pvm <= ?');
        params.push(q.saldopvm);
      }
      const rows = ajuri.all(
        `SELECT v.eraid AS era, SUM(v.debetsnt - v.kreditsnt) AS avoin FROM vienti v JOIN tosite t ON v.tosite = t.id WHERE ${ehdot.join(
          ' AND ',
        )} GROUP BY v.eraid`,
        params,
      );
      const out = new Map<number, Cents>();
      for (const r of rows) out.set(Number(r.era), Number(r.avoin) as Cents);
      return out;
    },

    async getLoki(tositeId) {
      const rows = ajuri.all(
        'SELECT aika, userid, lahde, tila, data FROM loki WHERE tosite = ? ORDER BY id',
        [tositeId],
      );
      return rows.map((r) => {
        const e: AuditEntry = {
          tosite: tositeId,
          tila: Number(r.tila),
          aika: r.aika as string,
          data: r.data === null ? null : JSON.parse(r.data as string),
        };
        if (r.userid !== null) e.userId = Number(r.userid);
        if (r.lahde !== null && r.lahde !== undefined) e.lahde = r.lahde as string;
        return e;
      });
    },

    // --- master data ---
    async getChart() {
      const rows = ajuri.all('SELECT json FROM tili ORDER BY numero, taso');
      return lataaKartta(rows.map((r) => JSON.parse(r.json as string) as TiliData));
    },
    async getTilikaudet() {
      const rows = ajuri.all('SELECT json FROM tilikausi ORDER BY alkaa');
      return rows.map((r) => JSON.parse(r.json as string) as Tilikausi);
    },
    async getAsetukset() {
      const rows = ajuri.all('SELECT avain, arvo FROM asetus');
      const out: Asetukset = {};
      for (const r of rows) out[r.avain as string] = r.arvo as string;
      return out;
    },
    async getInit() {
      const sarjat = ajuri
        .all(
          "SELECT DISTINCT sarja FROM tosite WHERE tila > 0 AND sarja IS NOT NULL AND sarja != '' ORDER BY sarja",
        )
        .map((r) => r.sarja as string);
      return {
        asetukset: await storage.getAsetukset(),
        // Raaka TiliData — /init palauttaa kartan sellaisenaan.
        tilit: ajuri
          .all('SELECT json FROM tili ORDER BY numero, taso')
          .map((r) => JSON.parse(r.json as string) as TiliData),
        tilikaudet: await storage.getTilikaudet(),
        tositesarjat: sarjat,
        kohdennukset: [],
      };
    },
    async putTili(numero, data) {
      const tyyppi = (data as { tyyppi?: unknown }).tyyppi;
      const taso = tasoTyypista(typeof tyyppi === 'string' ? tyyppi : '');
      ajuri.run(
        'INSERT INTO tili (numero, taso, tyyppi, json, muokattu) VALUES (?, ?, ?, ?, 1)' +
          ' ON CONFLICT (numero, taso) DO UPDATE SET tyyppi = excluded.tyyppi,' +
          ' json = excluded.json, muokattu = 1',
        [numero, taso, String(tyyppi ?? ''), JSON.stringify(data)],
      );
    },
    async deleteTili(numero, taso = 0) {
      ajuri.run('DELETE FROM tili WHERE numero = ? AND taso = ?', [numero, taso]);
    },
    async putTilikausi(alkaa, kausi) {
      ajuri.transaction((tx) => {
        tx.run('DELETE FROM tilikausi WHERE alkaa = ?', [alkaa]);
        tx.run('INSERT OR REPLACE INTO tilikausi (alkaa, loppuu, json) VALUES (?, ?, ?)', [
          kausi.alkaa,
          kausi.loppuu,
          JSON.stringify(kausi),
        ]);
      });
    },
    async deleteTilikausi(alkaa) {
      ajuri.run('DELETE FROM tilikausi WHERE alkaa = ?', [alkaa]);
    },
    async patchAsetukset(patch) {
      ajuri.transaction((tx) => {
        for (const [avain, arvo] of Object.entries(patch)) {
          if (arvo === null || arvo === undefined)
            tx.run('DELETE FROM asetus WHERE avain = ?', [avain]);
          else
            tx.run('INSERT OR REPLACE INTO asetus (avain, arvo, muokattu) VALUES (?, ?, 1)', [
              avain,
              arvo,
            ]);
        }
      });
    },
    async patchInit(patch) {
      ajuri.transaction((tx) => {
        for (const [avain, arvo] of Object.entries(patch.asetukset ?? {})) {
          const cur = tx.get('SELECT muokattu FROM asetus WHERE avain = ?', [avain]);
          if (cur?.muokattu) continue; // user edit wins
          tx.run('INSERT OR REPLACE INTO asetus (avain, arvo, muokattu) VALUES (?, ?, 0)', [
            avain,
            arvo,
          ]);
        }
        for (const t of patch.tilit ?? []) {
          const numero = Number(t.numero);
          const tyyppi = (t as { tyyppi?: unknown }).tyyppi;
          const taso = tasoTyypista(typeof tyyppi === 'string' ? tyyppi : '');
          const cur = tx.get('SELECT muokattu FROM tili WHERE numero = ? AND taso = ?', [
            numero,
            taso,
          ]);
          if (cur?.muokattu) continue; // user edit wins
          tx.run(
            'INSERT OR REPLACE INTO tili (numero, taso, tyyppi, json, muokattu) VALUES (?, ?, ?, ?, 0)',
            [numero, taso, String(tyyppi ?? ''), JSON.stringify(t)],
          );
        }
      });
    },

    // --- kumppanit ---
    async getKumppanit() {
      const rows = ajuri.all('SELECT json FROM kumppani ORDER BY nimi');
      return rows.map((r) => JSON.parse(r.json as string) as Kumppani);
    },
    async saveKumppani(k: UusiKumppani) {
      return ajuri.transaction((tx): Kumppani => {
        let id = k.id;
        if (id === undefined) {
          const info = tx.run('INSERT INTO kumppani (nimi, alvtunnus, json) VALUES (?, ?, ?)', [
            k.nimi,
            k.alvtunnus ?? null,
            '{}',
          ]);
          id = Number(info.lastInsertRowid);
        }
        const { id: _drop, ...rest } = k;
        const stored: Kumppani = { ...rest, id };
        tx.run('INSERT OR REPLACE INTO kumppani (id, nimi, alvtunnus, json) VALUES (?, ?, ?, ?)', [
          id,
          stored.nimi,
          stored.alvtunnus ?? null,
          JSON.stringify(stored),
        ]);
        return stored;
      });
    },
    async deleteKumppani(id: number) {
      ajuri.run('DELETE FROM kumppani WHERE id = ?', [id]);
    },

    // --- liitteet ---
    async laskeLiitteet() {
      const rows = ajuri.all('SELECT tosite, COUNT(*) AS n FROM liite GROUP BY tosite');
      return new Map(rows.map((r) => [Number(r.tosite), Number(r.n)]));
    },
    async getLiitteet(tosite: number) {
      const rows = ajuri.all('SELECT json FROM liite WHERE tosite = ? ORDER BY id', [tosite]);
      return rows.map((r) => JSON.parse(r.json as string) as LiiteMeta);
    },
    async getLiite(id: number) {
      const row = ajuri.get('SELECT json, data, varasto_avain FROM liite WHERE id = ?', [id]);
      if (!row) return null;
      const meta = JSON.parse(row.json as string) as LiiteMeta;
      if (row.varasto_avain == null) {
        return { ...meta, data: new Uint8Array(row.data as Uint8Array) };
      }
      const avain = row.varasto_avain as string;
      if (!liitevarasto) {
        throw new Error(`Liite ${id} on liitevarastossa (${avain}), mutta varastoa ei ole annettu`);
      }
      const data = await liitevarasto.hae(avain);
      if (!data) throw new Error(`Liitteen ${id} tavut puuttuvat liitevarastosta (${avain})`);
      return { ...meta, data };
    },
    async saveLiite(l: UusiLiite) {
      // Tavut ensin varastoon (async), vasta sitten synkroninen SQL-transaktio. Varaston avain on
      // sisältöosoitteinen, joten kesken jäänyt kirjoitus jättää korkeintaan käyttämättömän objektin.
      // HUOM: varaston await on oikeaa I/O:ta, joten kutsuja (esim. DO:n input gate) ei voi
      // olettaa "tarkista → kirjoita" -jaksoa atomiseksi: kutsujan on sarjallistettava
      // kirjoittavat kutsut (apps/pilvi KirjaDO.kasittele tekee niin).
      const { data, varastoAvain, koko } = await sijoitaTavut(l.data);
      return ajuri.transaction((tx): LiiteMeta => {
        if (l.id !== undefined) {
          // Selkeä id: PÄIVITETÄÄN olemassa oleva rivi paikallaan — ei koskaan poisteta tai
          // korvata toista riviä (ks. LIITE_ROOLI_VARATTU-tarkistus alla).
          const nykyinen = tx.get('SELECT id FROM liite WHERE id = ?', [l.id]);
          if (!nykyinen) throw new ResourceError('LIITE_EI_LOYDY', `Liitettä ${l.id} ei ole`);
          if (l.roolinimi != null && l.roolinimi !== '') {
            const toinen = tx.get(
              'SELECT id FROM liite WHERE tosite = ? AND roolinimi = ? AND id != ?',
              [l.tosite, l.roolinimi, l.id],
            );
            if (toinen)
              throw new ResourceError(
                'LIITE_ROOLI_VARATTU',
                `Rooli "${l.roolinimi}" on jo varattu toiselle liitteelle tositteella ${l.tosite}`,
              );
          }
          const { id: _drop, data: _data, ...rest } = l;
          const meta: LiiteMeta = { ...(rest as Omit<LiiteMeta, 'id'>), id: l.id };
          tx.run(
            'UPDATE liite SET tosite = ?, nimi = ?, roolinimi = ?, tyyppi = ?, sha = ?, luotu = ?, data = ?, varasto_avain = ?, koko = ?, json = ? WHERE id = ?',
            [
              meta.tosite,
              meta.nimi,
              meta.roolinimi ?? null,
              meta.tyyppi,
              meta.sha ?? null,
              meta.luotu,
              data,
              varastoAvain,
              koko,
              JSON.stringify(meta),
              meta.id,
            ],
          );
          return meta;
        }

        let id: number | undefined;
        if (l.roolinimi != null && l.roolinimi !== '') {
          const rivi = tx.get('SELECT id FROM liite WHERE tosite = ? AND roolinimi = ?', [
            l.tosite,
            l.roolinimi,
          ]);
          if (rivi) id = Number(rivi.id);
        }
        const { id: _drop, data: _data, ...rest } = l;
        if (id === undefined) {
          const info = tx.run(
            'INSERT INTO liite (tosite, nimi, roolinimi, tyyppi, sha, luotu, data, varasto_avain, koko, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              l.tosite,
              l.nimi,
              l.roolinimi ?? null,
              l.tyyppi,
              l.sha ?? null,
              l.luotu,
              data,
              varastoAvain,
              koko,
              '{}',
            ],
          );
          id = Number(info.lastInsertRowid);
          const meta: LiiteMeta = { ...(rest as Omit<LiiteMeta, 'id'>), id };
          tx.run('UPDATE liite SET json = ? WHERE id = ?', [JSON.stringify(meta), id]);
          return meta;
        }
        const meta: LiiteMeta = { ...(rest as Omit<LiiteMeta, 'id'>), id };
        tx.run(
          'INSERT OR REPLACE INTO liite (id, tosite, nimi, roolinimi, tyyppi, sha, luotu, data, varasto_avain, koko, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            id,
            meta.tosite,
            meta.nimi,
            meta.roolinimi ?? null,
            meta.tyyppi,
            meta.sha ?? null,
            meta.luotu,
            data,
            varastoAvain,
            koko,
            JSON.stringify(meta),
          ],
        );
        return meta;
      });
    },
    async deleteLiite(id: number) {
      ajuri.run('DELETE FROM liite WHERE id = ?', [id]);
    },
  };

  return storage;
}
