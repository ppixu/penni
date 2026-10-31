import { SCHEMA_VERSIONS, createSqliteCoreStorage } from '@penni/storage-sqlite-core';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { luoBetterSqliteAjuriDb } from './ajuri-better.js';
import { ajaMigraatiot } from './migrations.js';

describe('ajaMigraatiot', () => {
  it('creates the tables and is idempotent', () => {
    const db = new Database(':memory:');
    ajaMigraatiot(db);
    ajaMigraatiot(db); // second run must be a no-op, not an error
    const taulut = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
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
    db.close();
  });

  it('records each applied migration version exactly once', () => {
    const db = new Database(':memory:');
    ajaMigraatiot(db);
    ajaMigraatiot(db);
    const n = (db.prepare('SELECT COUNT(*) AS n FROM migraatio').get() as { n: number }).n;
    expect(n).toBe(6); // six append-only migrations applied, each recorded once
    db.close();
  });

  it('upgrades an existing book: numero-keyed tili rows survive rebuild with the right taso', () => {
    // Simulate a real, already-migrated book: only schema version 0 (the original
    // numero-PRIMARY-KEY tili table) has been applied. Insert a leaf account and a heading
    // the way the OLD schema allowed (one row per numero), record version 0 as done, then let
    // ajaMigraatiot run the rest — including the new (numero, taso) rebuild — on top of it.
    const db = new Database(':memory:');
    db.exec(SCHEMA_VERSIONS[0] as string);
    db.exec(
      'CREATE TABLE IF NOT EXISTS migraatio (versio INTEGER PRIMARY KEY NOT NULL, ajettu TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    db.prepare('INSERT INTO migraatio (versio) VALUES (0)').run();

    db.prepare('INSERT INTO tili (numero, tyyppi, json, muokattu) VALUES (?, ?, ?, 0)').run(
      1781,
      'A',
      JSON.stringify({ numero: 1781, tyyppi: 'A', nimi: { fi: 'Osakemerkintäsaamiset' } }),
    );
    db.prepare('INSERT INTO tili (numero, tyyppi, json, muokattu) VALUES (?, ?, ?, 0)').run(
      3,
      'H1',
      JSON.stringify({ numero: 3, tyyppi: 'H1', nimi: { fi: 'Tuloslaskelma' } }),
    );

    ajaMigraatiot(db);

    const rivit = db
      .prepare('SELECT numero, taso, tyyppi FROM tili ORDER BY numero, taso')
      .all() as { numero: number; taso: number; tyyppi: string }[];
    expect(rivit).toHaveLength(2);
    const tili = rivit.find((r) => r.numero === 1781);
    const otsikko = rivit.find((r) => r.numero === 3);
    expect(tili).toEqual({ numero: 1781, taso: 0, tyyppi: 'A' });
    expect(otsikko).toEqual({ numero: 3, taso: 1, tyyppi: 'H1' });
    db.close();
  });

  it('v4 → v5: vanha inline-liite säilyy tavu tavulta, metatieto ennallaan ja uudet sarakkeet NULL', async () => {
    // Rakennetaan kirja skeemaversioon 4 (migraatiot 0–3 ajettu, v5 puuttuu) ja kirjoitetaan
    // liite vanhalla rivimuodolla: tavut inline `data`-sarakkeessa, ei varasto_avain/koko-sarakkeita.
    const db = new Database(':memory:');
    db.exec(
      'CREATE TABLE IF NOT EXISTS migraatio (versio INTEGER PRIMARY KEY NOT NULL, ajettu TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    for (const versio of [0, 1, 2, 3, 4]) {
      // SCHEMA_VERSIONS[0..4] = v0…v4; indeksi 5 (varasto_avain + koko) jätetään ajamatta.
      db.exec(SCHEMA_VERSIONS[versio] as string);
      db.prepare('INSERT INTO migraatio (versio) VALUES (?)').run(versio);
    }
    const sarakkeet = (
      db.prepare("SELECT name FROM pragma_table_info('liite')").all() as { name: string }[]
    ).map((r) => r.name);
    expect(sarakkeet).not.toContain('varasto_avain');
    expect(sarakkeet).not.toContain('koko');

    db.prepare(
      'INSERT INTO tosite (id, pvm, tyyppi, tila, tunniste, sarja, json) VALUES (1, ?, 0, 100, 1, ?, ?)',
    ).run('2026-03-01', '', JSON.stringify({ id: 1 }));
    const data = Uint8Array.from({ length: 4096 }, (_, i) => (i * 31 + 7) & 0xff);
    const meta = {
      id: 7,
      tosite: 1,
      nimi: 'kuitti.pdf',
      roolinimi: 'kuitti',
      tyyppi: 'application/pdf',
      sha: 'abc123',
      luotu: '2026-03-01T10:00:00.000Z',
    };
    db.prepare(
      'INSERT INTO liite (id, tosite, nimi, roolinimi, tyyppi, sha, luotu, data, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      meta.id,
      meta.tosite,
      meta.nimi,
      meta.roolinimi,
      meta.tyyppi,
      meta.sha,
      meta.luotu,
      Buffer.from(data),
      JSON.stringify(meta),
    );

    ajaMigraatiot(db);

    const versiot = (
      db.prepare('SELECT versio FROM migraatio ORDER BY versio').all() as {
        versio: number;
      }[]
    ).map((r) => r.versio);
    expect(versiot).toContain(5);
    const rivi = db
      .prepare('SELECT varasto_avain, koko, length(data) AS n FROM liite WHERE id = 7')
      .get();
    expect(rivi).toEqual({ varasto_avain: null, koko: null, n: 4096 });

    // Ilman liitevarastoa luku menee inline-polkua: vanhan rivin on luettava kuten ennen.
    const kirja = createSqliteCoreStorage(luoBetterSqliteAjuriDb(db), {});
    const luettu = await kirja.getLiite(7);
    expect(luettu).not.toBeNull();
    expect(luettu?.data).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(luettu?.data as Uint8Array).equals(Buffer.from(data))).toBe(true);
    expect({ ...luettu, data: undefined }).toEqual({ ...meta, data: undefined });
    expect(await kirja.getLiitteet(1)).toEqual([meta]);
    db.close();
  });
});
