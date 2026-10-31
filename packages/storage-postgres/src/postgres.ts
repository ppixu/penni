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
import type { PgAjuri } from './ajuri.js';
import { ajaMigraatiot } from './migrations.js';

const KIRJANPIDOSSA = 100;

export interface PostgresSeed {
  tilit?: TiliData[];
  tilikaudet?: Tilikausi[];
  asetukset?: Asetukset;
}

/** The Storage impl plus an async close() for the connection. */
export interface PostgresStorage extends Storage {
  close(): Promise<void>;
}

/** The tila SQL predicate for a list bucket (mirrors memory.ts bucketPredicate). */
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

export async function createPostgresStorage(
  ajuri: PgAjuri,
  seed: PostgresSeed = {},
): Promise<PostgresStorage> {
  await ajaMigraatiot(ajuri);

  // Seed only a fresh (empty) database — never clobber a reopened, persisted one.
  const laske = async (taulu: string): Promise<number> => {
    const { rows } = await ajuri.query(`SELECT COUNT(*) AS n FROM ${taulu}`);
    return Number(rows[0]?.n ?? 0);
  };
  if (
    (await laske('tili')) === 0 &&
    (await laske('asetus')) === 0 &&
    (await laske('tilikausi')) === 0
  ) {
    await ajuri.transaction(async (tx) => {
      for (const t of seed.tilit ?? []) {
        const tyyppi = (t as { tyyppi?: unknown }).tyyppi;
        const taso = tasoTyypista(typeof tyyppi === 'string' ? tyyppi : '');
        await tx.query(
          'INSERT INTO tili (numero, taso, tyyppi, json, muokattu) VALUES ($1, $2, $3, $4, 0)',
          [Number(t.numero), taso, String(tyyppi ?? ''), JSON.stringify(t)],
        );
      }
      for (const k of seed.tilikaudet ?? [])
        await tx.query('INSERT INTO tilikausi (alkaa, loppuu, json) VALUES ($1, $2, $3)', [
          k.alkaa,
          k.loppuu,
          JSON.stringify(k),
        ]);
      for (const [avain, arvo] of Object.entries(seed.asetukset ?? {}))
        await tx.query('INSERT INTO asetus (avain, arvo, muokattu) VALUES ($1, $2, 0)', [
          avain,
          arvo,
        ]);
    });
  }

  const storage: PostgresStorage = {
    close() {
      return ajuri.close();
    },

    async getTosite(id) {
      const { rows } = await ajuri.query('SELECT json FROM tosite WHERE id = $1', [id]);
      const row = rows[0];
      return row ? (JSON.parse(row.json as string) as StoredTosite) : null;
    },

    async listTositteet(filter) {
      const ehdot: string[] = [bucketEhto(filter.bucket)];
      const params: unknown[] = [];
      const lisaa = (sql: string, arvo: unknown) => {
        params.push(arvo);
        ehdot.push(sql.replace('$?', `$${params.length}`));
      };
      if (filter.alkupvm !== undefined) lisaa('pvm >= $?', filter.alkupvm);
      if (filter.loppupvm !== undefined) lisaa('pvm <= $?', filter.loppupvm);
      if (filter.pvm !== undefined) lisaa('pvm = $?', filter.pvm);
      if (filter.tyyppi !== undefined) lisaa('tyyppi = $?', filter.tyyppi);
      if (filter.kumppani !== undefined) lisaa('kumppani = $?', filter.kumppani);
      if (filter.viite !== undefined) lisaa('viite = $?', filter.viite);
      const { rows } = await ajuri.query(
        `SELECT json FROM tosite WHERE ${ehdot.join(' AND ')} ORDER BY pvm COLLATE "C", id`,
        params,
      );
      return rows.map((r) => JSON.parse(r.json as string) as StoredTosite);
    },

    async listViennit(filter) {
      const { rows } = await ajuri.query(
        `SELECT json FROM tosite WHERE tila >= ${KIRJANPIDOSSA} ORDER BY id`,
      );
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
      return ajuri.transaction(async (tx): Promise<StoredTosite> => {
        let id = t.id;
        if (id === undefined) {
          // Claim an IDENTITY id with a placeholder row; the ON CONFLICT below fills the real data.
          const { rows } = await tx.query(
            'INSERT INTO tosite (pvm, tyyppi, tila, tunniste, sarja, kumppani, viite, laskupvm, erapvm, json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
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
          id = Number(rows[0]?.id);
        }
        const { id: _drop, ...rest } = t;
        const stored: StoredTosite = { ...(rest as Omit<StoredTosite, 'id'>), id };
        await tx.query(
          `INSERT INTO tosite (id, pvm, tyyppi, tila, tunniste, sarja, kumppani, viite, laskupvm, erapvm, json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (id) DO UPDATE SET
             pvm = EXCLUDED.pvm, tyyppi = EXCLUDED.tyyppi, tila = EXCLUDED.tila,
             tunniste = EXCLUDED.tunniste, sarja = EXCLUDED.sarja, kumppani = EXCLUDED.kumppani,
             viite = EXCLUDED.viite, laskupvm = EXCLUDED.laskupvm, erapvm = EXCLUDED.erapvm,
             json = EXCLUDED.json`,
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
        await tx.query('DELETE FROM vienti WHERE tosite = $1', [id]);
        let rivi = 0;
        for (const vienti of stored.viennit) {
          rivi += 1;
          await tx.query(
            'INSERT INTO vienti (tosite, rivi, tili, pvm, debetsnt, kreditsnt, kohdennus, eraid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              id,
              rivi,
              vienti.tili,
              vienti.pvm,
              vienti.debet,
              vienti.kredit,
              vienti.kohdennus ?? 0,
              vienti.era ?? null,
            ],
          );
        }
        await tx.query(
          'INSERT INTO loki (tosite, aika, userid, lahde, tila, data) VALUES ($1,$2,$3,$4,$5,$6)',
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
      return ajuri.transaction(async (tx): Promise<StoredTosite> => {
        const { rows } = await tx.query('SELECT json FROM tosite WHERE id = $1', [id]);
        const row = rows[0];
        if (!row) throw new ResourceError('EITOSITETTA', `Tositetta ${id} ei ole`);
        const updated: StoredTosite = {
          ...(JSON.parse(row.json as string) as StoredTosite),
          tila,
          tunniste,
        };
        await tx.query('UPDATE tosite SET tila = $1, tunniste = $2, json = $3 WHERE id = $4', [
          tila,
          tunniste,
          JSON.stringify(updated),
          id,
        ]);
        await tx.query(
          'INSERT INTO loki (tosite, aika, userid, lahde, tila, data) VALUES ($1,$2,$3,$4,$5,$6)',
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
      await ajuri.transaction(async (tx) => {
        const { rows } = await tx.query('SELECT json FROM tosite WHERE id = $1', [id]);
        const row = rows[0];
        if (!row) throw new ResourceError('EITOSITETTA', `Tositetta ${id} ei ole`);
        const updated: StoredTosite = {
          ...(JSON.parse(row.json as string) as StoredTosite),
          tila: 0,
        };
        await tx.query('UPDATE tosite SET tila = 0, json = $1 WHERE id = $2', [
          JSON.stringify(updated),
          id,
        ]);
        await tx.query(
          'INSERT INTO loki (tosite, aika, userid, lahde, tila, data) VALUES ($1,$2,$3,$4,0,NULL)',
          [id, audit.aika, audit.userId ?? null, audit.lahde ?? null],
        );
      });
    },

    async maxTunniste(alkaa, loppuu, sarja) {
      const sarjaEhto = sarja === null ? "(sarja = '' OR sarja IS NULL)" : 'sarja = $3';
      const params: unknown[] = sarja === null ? [alkaa, loppuu] : [alkaa, loppuu, sarja];
      const { rows } = await ajuri.query(
        `SELECT MAX(tunniste) AS m FROM tosite WHERE tila >= ${KIRJANPIDOSSA} AND pvm >= $1 AND pvm <= $2 AND ${sarjaEhto}`,
        params,
      );
      const m = rows[0]?.m;
      return m === null || m === undefined ? 0 : Number(m);
    },

    async querySaldot(q: SaldoQuery) {
      const ehdot: string[] = ['t.tila >= 100'];
      const params: unknown[] = [];
      const lisaa = (sql: string, arvo: unknown) => {
        params.push(arvo);
        ehdot.push(sql.replace('$?', `$${params.length}`));
      };
      if (q.alkupvm !== undefined) lisaa('v.pvm >= $?', q.alkupvm);
      lisaa(q.loppupvmExclusive ? 'v.pvm < $?' : 'v.pvm <= $?', q.loppupvm);
      if (q.tili !== undefined) lisaa('v.tili = $?', q.tili);
      if (q.tiliAlkaen !== undefined) lisaa('CAST(v.tili AS TEXT) COLLATE "C" >= $?', q.tiliAlkaen);
      if (q.tiliAsti !== undefined) lisaa('CAST(v.tili AS TEXT) COLLATE "C" < $?', q.tiliAsti);
      if (q.kohdennus !== undefined && q.kohdennus !== 0) lisaa('v.kohdennus = $?', q.kohdennus);
      const { rows } = await ajuri.query(
        `SELECT v.tili AS tili, SUM(v.debetsnt - v.kreditsnt) AS saldo
         FROM vienti v JOIN tosite t ON v.tosite = t.id
         WHERE ${ehdot.join(' AND ')} GROUP BY v.tili`,
        params,
      );
      const out = new Map<number, Cents>();
      for (const r of rows) out.set(Number(r.tili), Number(r.saldo) as Cents);
      return out;
    },

    async queryErat(q) {
      const ehdot: string[] = ['t.tila >= 100', 'v.eraid IS NOT NULL'];
      const params: unknown[] = [];
      const lisaa = (sql: string, arvo: unknown) => {
        params.push(arvo);
        ehdot.push(sql.replace('$?', `$${params.length}`));
      };
      if (q.saldopvm !== undefined) lisaa('v.pvm <= $?', q.saldopvm);
      const { rows } = await ajuri.query(
        `SELECT v.eraid AS era, SUM(v.debetsnt - v.kreditsnt) AS avoin
         FROM vienti v JOIN tosite t ON v.tosite = t.id
         WHERE ${ehdot.join(' AND ')} GROUP BY v.eraid`,
        params,
      );
      const out = new Map<number, Cents>();
      for (const r of rows) out.set(Number(r.era), Number(r.avoin) as Cents);
      return out;
    },

    async getLoki(tositeId) {
      const { rows } = await ajuri.query(
        'SELECT aika, userid, lahde, tila, data FROM loki WHERE tosite = $1 ORDER BY id',
        [tositeId],
      );
      return rows.map((r) => {
        const e: AuditEntry = {
          tosite: tositeId,
          tila: Number(r.tila),
          aika: r.aika as string,
          data: r.data === null || r.data === undefined ? null : JSON.parse(r.data as string),
        };
        if (r.userid !== null && r.userid !== undefined) e.userId = Number(r.userid);
        if (r.lahde !== null && r.lahde !== undefined) e.lahde = r.lahde as string;
        return e;
      });
    },

    // --- master data ---
    async getChart() {
      const { rows } = await ajuri.query('SELECT json FROM tili ORDER BY numero, taso');
      return lataaKartta(rows.map((r) => JSON.parse(r.json as string) as TiliData));
    },
    async getTilikaudet() {
      const { rows } = await ajuri.query('SELECT json FROM tilikausi ORDER BY alkaa COLLATE "C"');
      return rows.map((r) => JSON.parse(r.json as string) as Tilikausi);
    },
    async getAsetukset() {
      const { rows } = await ajuri.query('SELECT avain, arvo FROM asetus');
      const out: Asetukset = {};
      for (const r of rows) out[r.avain as string] = (r.arvo ?? '') as string;
      return out;
    },
    async getInit() {
      // COLLATE "C" -tavujärjestys vastaa memory.ts:n .sort()-järjestystä riippumatta klusterin lokaalista.
      // SELECT DISTINCT vaatii, että ORDER BY-lauseke on valintalistalla, joten kollatoitu arvo aliasoidaan.
      const { rows: sarjaRows } = await ajuri.query(
        'SELECT DISTINCT sarja COLLATE "C" AS sarja FROM tosite WHERE tila > 0 AND sarja IS NOT NULL AND sarja <> \'\' ORDER BY sarja',
      );
      const { rows: tiliRows } = await ajuri.query('SELECT json FROM tili ORDER BY numero, taso');
      return {
        asetukset: await storage.getAsetukset(),
        // raw TiliData (not getChart()'s resolved Tili[]) — /init returns the chart as-is
        tilit: tiliRows.map((r) => JSON.parse(r.json as string) as TiliData),
        tilikaudet: await storage.getTilikaudet(),
        tositesarjat: sarjaRows.map((r) => r.sarja as string),
        kohdennukset: [],
      };
    },
    async putTili(numero, data) {
      const tyyppi = (data as { tyyppi?: unknown }).tyyppi;
      const taso = tasoTyypista(typeof tyyppi === 'string' ? tyyppi : '');
      await ajuri.query(
        `INSERT INTO tili (numero, taso, tyyppi, json, muokattu) VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (numero, taso) DO UPDATE SET tyyppi = EXCLUDED.tyyppi, json = EXCLUDED.json, muokattu = 1`,
        [numero, taso, String(tyyppi ?? ''), JSON.stringify(data)],
      );
    },
    async deleteTili(numero, taso = 0) {
      await ajuri.query('DELETE FROM tili WHERE numero = $1 AND taso = $2', [numero, taso]);
    },
    async putTilikausi(alkaa, kausi) {
      await ajuri.transaction(async (tx) => {
        await tx.query('DELETE FROM tilikausi WHERE alkaa = $1', [alkaa]);
        await tx.query(
          `INSERT INTO tilikausi (alkaa, loppuu, json) VALUES ($1, $2, $3)
           ON CONFLICT (alkaa) DO UPDATE SET loppuu = EXCLUDED.loppuu, json = EXCLUDED.json`,
          [kausi.alkaa, kausi.loppuu, JSON.stringify(kausi)],
        );
      });
    },
    async deleteTilikausi(alkaa) {
      await ajuri.query('DELETE FROM tilikausi WHERE alkaa = $1', [alkaa]);
    },
    async patchAsetukset(patch) {
      await ajuri.transaction(async (tx) => {
        for (const [avain, arvo] of Object.entries(patch)) {
          if (arvo === null || arvo === undefined)
            await tx.query('DELETE FROM asetus WHERE avain = $1', [avain]);
          else
            await tx.query(
              `INSERT INTO asetus (avain, arvo, muokattu) VALUES ($1, $2, 1)
               ON CONFLICT (avain) DO UPDATE SET arvo = EXCLUDED.arvo, muokattu = 1`,
              [avain, arvo],
            );
        }
      });
    },
    async patchInit(patch) {
      await ajuri.transaction(async (tx) => {
        for (const [avain, arvo] of Object.entries(patch.asetukset ?? {})) {
          const { rows } = await tx.query('SELECT muokattu FROM asetus WHERE avain = $1', [avain]);
          if (Number(rows[0]?.muokattu ?? 0) === 1) continue; // user edit wins
          await tx.query(
            `INSERT INTO asetus (avain, arvo, muokattu) VALUES ($1, $2, 0)
             ON CONFLICT (avain) DO UPDATE SET arvo = EXCLUDED.arvo, muokattu = 0`,
            [avain, arvo],
          );
        }
        for (const t of patch.tilit ?? []) {
          const numero = Number(t.numero);
          const tyyppi = (t as { tyyppi?: unknown }).tyyppi;
          const taso = tasoTyypista(typeof tyyppi === 'string' ? tyyppi : '');
          const { rows } = await tx.query(
            'SELECT muokattu FROM tili WHERE numero = $1 AND taso = $2',
            [numero, taso],
          );
          if (Number(rows[0]?.muokattu ?? 0) === 1) continue; // user edit wins
          await tx.query(
            `INSERT INTO tili (numero, taso, tyyppi, json, muokattu) VALUES ($1, $2, $3, $4, 0)
             ON CONFLICT (numero, taso) DO UPDATE SET tyyppi = EXCLUDED.tyyppi, json = EXCLUDED.json, muokattu = 0`,
            [numero, taso, String(tyyppi ?? ''), JSON.stringify(t)],
          );
        }
      });
    },

    // --- kumppanit ---
    async getKumppanit() {
      const { rows } = await ajuri.query('SELECT json FROM kumppani ORDER BY nimi COLLATE "C"');
      return rows.map((r) => JSON.parse(r.json as string) as Kumppani);
    },
    async saveKumppani(k: UusiKumppani) {
      return ajuri.transaction(async (tx): Promise<Kumppani> => {
        let id = k.id;
        if (id === undefined) {
          const { rows } = await tx.query(
            'INSERT INTO kumppani (nimi, alvtunnus, json) VALUES ($1,$2,$3) RETURNING id',
            [k.nimi, k.alvtunnus ?? null, '{}'],
          );
          id = Number(rows[0]?.id);
        }
        const { id: _drop, ...rest } = k;
        const stored: Kumppani = { ...rest, id };
        await tx.query(
          `INSERT INTO kumppani (id, nimi, alvtunnus, json) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET nimi = EXCLUDED.nimi, alvtunnus = EXCLUDED.alvtunnus, json = EXCLUDED.json`,
          [id, stored.nimi, stored.alvtunnus ?? null, JSON.stringify(stored)],
        );
        return stored;
      });
    },
    async deleteKumppani(id: number) {
      await ajuri.query('DELETE FROM kumppani WHERE id = $1', [id]);
    },

    // --- liitteet ---
    async laskeLiitteet() {
      const { rows } = await ajuri.query('SELECT tosite, COUNT(*) AS n FROM liite GROUP BY tosite');
      // COUNT(*) on Postgresissa bigint → ajuri palauttaa sen merkkijonona.
      return new Map(rows.map((r) => [Number(r.tosite), Number(r.n)]));
    },
    async getLiitteet(tosite: number) {
      const { rows } = await ajuri.query('SELECT json FROM liite WHERE tosite = $1 ORDER BY id', [
        tosite,
      ]);
      return rows.map((r) => JSON.parse(r.json as string) as LiiteMeta);
    },
    async getLiite(id: number) {
      const { rows } = await ajuri.query('SELECT json, data FROM liite WHERE id = $1', [id]);
      const row = rows[0];
      if (!row) return null;
      const meta = JSON.parse(row.json as string) as LiiteMeta;
      return { ...meta, data: new Uint8Array(row.data as Uint8Array) };
    },
    async saveLiite(l: UusiLiite) {
      return ajuri.transaction(async (tx): Promise<LiiteMeta> => {
        if (l.id !== undefined) {
          // Selkeä id: PÄIVITETÄÄN olemassa oleva rivi paikallaan — ei koskaan poisteta tai
          // korvata toista riviä, eikä anneta raa'an unique-rajoitteen rikkoutua (ks. alla).
          const { rows: nykyinen } = await tx.query('SELECT id FROM liite WHERE id = $1', [l.id]);
          if (!nykyinen[0]) throw new ResourceError('LIITE_EI_LOYDY', `Liitettä ${l.id} ei ole`);
          if (l.roolinimi != null && l.roolinimi !== '') {
            const { rows: toinen } = await tx.query(
              'SELECT id FROM liite WHERE tosite = $1 AND roolinimi = $2 AND id != $3',
              [l.tosite, l.roolinimi, l.id],
            );
            if (toinen[0])
              throw new ResourceError(
                'LIITE_ROOLI_VARATTU',
                `Rooli "${l.roolinimi}" on jo varattu toiselle liitteelle tositteella ${l.tosite}`,
              );
          }
          const { id: _drop, data, ...rest } = l;
          const meta: LiiteMeta = { ...(rest as Omit<LiiteMeta, 'id'>), id: l.id };
          await tx.query(
            'UPDATE liite SET tosite = $1, nimi = $2, roolinimi = $3, tyyppi = $4, sha = $5, luotu = $6, data = $7, json = $8 WHERE id = $9',
            [
              meta.tosite,
              meta.nimi,
              meta.roolinimi ?? null,
              meta.tyyppi,
              meta.sha ?? null,
              meta.luotu,
              data,
              JSON.stringify(meta),
              meta.id,
            ],
          );
          return meta;
        }

        let id: number | undefined;
        if (l.roolinimi != null && l.roolinimi !== '') {
          const { rows } = await tx.query(
            'SELECT id FROM liite WHERE tosite = $1 AND roolinimi = $2',
            [l.tosite, l.roolinimi],
          );
          if (rows[0]) id = Number(rows[0].id);
        }
        const { id: _drop, data, ...rest } = l;
        if (id === undefined) {
          const { rows } = await tx.query(
            'INSERT INTO liite (tosite, nimi, roolinimi, tyyppi, sha, luotu, data, json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
            [l.tosite, l.nimi, l.roolinimi ?? null, l.tyyppi, l.sha ?? null, l.luotu, data, '{}'],
          );
          id = Number(rows[0]?.id);
          const meta: LiiteMeta = { ...(rest as Omit<LiiteMeta, 'id'>), id };
          await tx.query('UPDATE liite SET json = $1 WHERE id = $2', [JSON.stringify(meta), id]);
          return meta;
        }
        const meta: LiiteMeta = { ...(rest as Omit<LiiteMeta, 'id'>), id };
        await tx.query(
          `INSERT INTO liite (id, tosite, nimi, roolinimi, tyyppi, sha, luotu, data, json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET tosite=EXCLUDED.tosite, nimi=EXCLUDED.nimi, roolinimi=EXCLUDED.roolinimi, tyyppi=EXCLUDED.tyyppi, sha=EXCLUDED.sha, luotu=EXCLUDED.luotu, data=EXCLUDED.data, json=EXCLUDED.json`,
          [
            id,
            meta.tosite,
            meta.nimi,
            meta.roolinimi ?? null,
            meta.tyyppi,
            meta.sha ?? null,
            meta.luotu,
            data,
            JSON.stringify(meta),
          ],
        );
        return meta;
      });
    },
    async deleteLiite(id: number) {
      await ajuri.query('DELETE FROM liite WHERE id = $1', [id]);
    },
  };

  return storage;
}
