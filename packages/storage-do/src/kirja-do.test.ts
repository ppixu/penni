import { env, runInDurableObject } from 'cloudflare:test';
import type { Cents } from '@penni/euro';
import { SCHEMA_VERSIONS, createSqliteCoreStorage } from '@penni/storage-sqlite-core';
import { describe, expect, it } from 'vitest';
import { luoDoSqliteAjuri } from './ajuri-do.js';

const c = (n: number): Cents => n as Cents;
const audit = { aika: '2026-06-01T10:00:00.000Z' };
const pankki = { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } };

describe('KirjaDO', () => {
  it('ajaa migraatiot ja siemenen ensimmäisellä käytöllä, ei uudelleen', async () => {
    const stub = env.KIRJA.get(env.KIRJA.newUniqueId());
    await runInDurableObject(stub, async (o, state) => {
      expect(
        state.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'tosite'").toArray(),
      ).toEqual([]);
      const kirja = o.kirja({ tilit: [pankki] });
      expect(o.kirja()).toBe(kirja);
      const versiot = state.storage.sql
        .exec('SELECT versio FROM migraatio ORDER BY versio')
        .toArray();
      expect(versiot.map((r) => r.versio)).toEqual(SCHEMA_VERSIONS.map((_, i) => i));
      expect((await kirja.getChart()).map((t) => t.numero)).toEqual([1900]);
    });
  });

  it('säilyttää kirjan DO-kutsujen yli ja ohittaa siemenen uudelleenavatessa', async () => {
    const stub = env.KIRJA.get(env.KIRJA.newUniqueId());
    const id = await runInDurableObject(stub, async (o) => {
      const saved = await o.kirja({ tilit: [pankki] }).saveTosite(
        {
          pvm: '2026-03-01',
          tyyppi: 0,
          tila: 100,
          tunniste: 1,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(5000),
              kredit: c(0),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(5000),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        audit,
      );
      return saved.id;
    });

    await runInDurableObject(stub, async (_o, state) => {
      // Uusi ajuri samaan DO-kantaan: migraatiot idempotentit, siemen ohitetaan (kanta ei tyhjä).
      const s2 = createSqliteCoreStorage(luoDoSqliteAjuri(state.storage), {
        tilit: [{ numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } }],
      });
      expect((await s2.getTosite(id))?.tunniste).toBe(1);
      expect((await s2.getChart()).map((t) => t.numero)).toEqual([1900]);
      expect((await s2.querySaldot({ loppupvm: '2026-12-31' })).get(1900)).toBe(5000);
      expect((await s2.getLoki(id)).length).toBe(1);
    });
  });
});
