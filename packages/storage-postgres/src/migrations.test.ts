import { describe, expect, it } from 'vitest';
import { luoPglite } from './ajuri.js';
import { ajaMigraatiot } from './migrations.js';
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
    expect(Number(rows[0]?.n)).toBe(5); // five append-only migrations applied, each recorded once
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
});
