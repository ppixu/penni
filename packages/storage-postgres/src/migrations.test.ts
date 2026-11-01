import { describe, expect, it } from 'vitest';
import { luoPglite } from './ajuri.js';
import { ajaMigraatiot } from './migrations.js';
import { createPostgresStorage } from './postgres.js';
import { SCHEMA_VERSIONS } from './schema.js';

describe('ajaMigraatiot', () => {
  it('creates the tables and is idempotent', async () => {
    const ajuri = await luoPglite();
    await ajaMigraatiot(ajuri);
    await ajaMigraatiot(ajuri); // second run must be a no-op, not an error
    const { rows } = await ajuri.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    const taulut = rows.map((r) => r.table_name);
    for (const t of [
      'asetus',
      'tili',
      'tilikausi',
      'tosite',
      'vienti',
      'loki',
      'kumppani',
      'liite',
      'kohdennus',
      'merkkaus',
      'budjetti',
      'migraatio',
    ]) {
      expect(taulut).toContain(t);
    }
    await ajuri.close();
  });

  it('records each applied migration version exactly once', async () => {
    const ajuri = await luoPglite();
    await ajaMigraatiot(ajuri);
    await ajaMigraatiot(ajuri);
    const { rows } = await ajuri.query('SELECT COUNT(*) AS n FROM migraatio');
    expect(Number(rows[0]?.n)).toBe(6); // six append-only migrations applied, each recorded once
    await ajuri.close();
  });

  it('upgrades an existing book: numero-keyed tili rows survive the (numero, taso) rebuild', async () => {
    // Simulate a real, already-migrated book: only schema version 0 (the original numero-PRIMARY-KEY
    // tili table) has been applied. Insert a leaf account and a heading the way the OLD schema
    // allowed (one row per numero), record version 0 as done, then let ajaMigraatiot run the rest —
    // including the new (numero, taso) key change (v3) — on top of it.
    const ajuri = await luoPglite();
    await ajuri.exec(SCHEMA_VERSIONS[0] as string);
    await ajuri.query(
      'CREATE TABLE IF NOT EXISTS migraatio (versio INTEGER PRIMARY KEY, ajettu TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    await ajuri.query('INSERT INTO migraatio (versio) VALUES (0)');
    await ajuri.query('INSERT INTO tili (numero, tyyppi, json, muokattu) VALUES ($1, $2, $3, 0)', [
      1781,
      'A',
      JSON.stringify({ numero: 1781, tyyppi: 'A', nimi: { fi: 'Osakemerkintäsaamiset' } }),
    ]);
    await ajuri.query('INSERT INTO tili (numero, tyyppi, json, muokattu) VALUES ($1, $2, $3, 0)', [
      3,
      'H1',
      JSON.stringify({ numero: 3, tyyppi: 'H1', nimi: { fi: 'Tuloslaskelma' } }),
    ]);

    await ajaMigraatiot(ajuri);

    const { rows } = await ajuri.query(
      'SELECT numero, taso, tyyppi FROM tili ORDER BY numero, taso',
    );
    expect(rows).toHaveLength(2);
    const tili = rows.find((r) => Number(r.numero) === 1781);
    const otsikko = rows.find((r) => Number(r.numero) === 3);
    expect(
      tili && { numero: Number(tili.numero), taso: Number(tili.taso), tyyppi: tili.tyyppi },
    ).toEqual({ numero: 1781, taso: 0, tyyppi: 'A' });
    expect(
      otsikko && {
        numero: Number(otsikko.numero),
        taso: Number(otsikko.taso),
        tyyppi: otsikko.tyyppi,
      },
    ).toEqual({ numero: 3, taso: 1, tyyppi: 'H1' });
    await ajuri.close();
  });

  it('v4 → v5: vanha kirja migroituu, tositteet säilyvät ja uudet taulut toimivat', async () => {
    const ajuri = await luoPglite();
    await ajuri.query(
      'CREATE TABLE IF NOT EXISTS migraatio (versio INTEGER PRIMARY KEY, ajettu TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    for (const versio of [0, 1, 2, 3, 4]) {
      await ajuri.exec(SCHEMA_VERSIONS[versio] as string);
      await ajuri.query('INSERT INTO migraatio (versio) VALUES ($1)', [versio]);
    }
    const tosite = {
      id: 1,
      pvm: '2026-03-01',
      tyyppi: 0,
      tila: 100,
      tunniste: 1,
      sarja: '',
      viennit: [{ tili: 3000, pvm: '2026-03-01', debet: 0, kredit: 500 }],
    };
    await ajuri.query(
      'INSERT INTO tosite (id, pvm, tyyppi, tila, tunniste, sarja, json) VALUES (1, $1, 0, 100, 1, $2, $3)',
      [tosite.pvm, '', JSON.stringify(tosite)],
    );
    const ennen = await ajuri.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'merkkaus'",
    );
    expect(ennen.rows).toHaveLength(0);

    const kirja = await createPostgresStorage(ajuri, {});
    expect(await kirja.getTosite(1)).toEqual(tosite);
    expect(await kirja.getKohdennukset()).toEqual([]);
    expect(await kirja.getBudjetti('2026-01-01')).toEqual([]);
    expect(await kirja.laskeKohdennustenKaytto()).toEqual(new Map());
    const k = await kirja.saveKohdennus({ tyyppi: 1, nimi: { fi: 'Nuoriso' } });
    expect(await kirja.getKohdennukset()).toEqual([k]);
    await kirja.close();
  });
});
