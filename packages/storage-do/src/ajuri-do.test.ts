import { env, runInDurableObject } from 'cloudflare:test';
import type { SqliteAjuri } from '@penni/storage-sqlite-core';
import { describe, expect, it } from 'vitest';
import { luoDoSqliteAjuri } from './ajuri-do.js';

/** Aja fn tuoreen DO:n sisällä uutta ajuria vasten. */
function tuoreessa<R>(fn: (ajuri: SqliteAjuri) => R): Promise<R> {
  const stub = env.KIRJA.get(env.KIRJA.newUniqueId());
  return runInDurableObject(stub, (_o, state) => fn(luoDoSqliteAjuri(state.storage)));
}

describe('DO SQLite -ajuri', () => {
  it('sitoo ja palauttaa Uint8Arrayn muuttumattomana (myös offsetillinen näkymä)', async () => {
    await tuoreessa((ajuri) => {
      ajuri.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, b BLOB)');
      const tavut = new Uint8Array([0x00, 0x7f, 0xff, 0x10, 0x20]);
      const isompi = new Uint8Array([9, 9, 0x00, 0x7f, 0xff, 0x10, 0x20, 9]);
      ajuri.run('INSERT INTO t (id, b) VALUES (?, ?)', [1, tavut]);
      ajuri.run('INSERT INTO t (id, b) VALUES (?, ?)', [2, isompi.subarray(2, 7)]);
      for (const id of [1, 2]) {
        const takaisin = ajuri.get('SELECT b FROM t WHERE id = ?', [id])?.b;
        expect(takaisin).toBeInstanceOf(Uint8Array);
        expect(Array.from(takaisin as Uint8Array)).toEqual(Array.from(tavut));
      }
      expect(ajuri.get('SELECT typeof(b) AS t FROM t WHERE id = 1')?.t).toBe('blob');
    });
  });

  it('palauttaa luvut, tekstin ja nullin samoina kuin better-sqlite3', async () => {
    await tuoreessa((ajuri) => {
      ajuri.exec('CREATE TABLE t (i INTEGER, r REAL, s TEXT, n INTEGER)');
      ajuri.run('INSERT INTO t VALUES (?, ?, ?, ?)', [-123456789012, 1.5, 'äö€', null]);
      expect(ajuri.get('SELECT * FROM t')).toEqual({ i: -123456789012, r: 1.5, s: 'äö€', n: null });
      expect(ajuri.get('SELECT typeof(i) AS t FROM t')?.t).toBe('integer');
    });
  });

  it('sitoo turvallisen alueen bigintin kokonaislukuna, hylkää muut', async () => {
    await tuoreessa((ajuri) => {
      ajuri.exec('CREATE TABLE t (i INTEGER)');
      ajuri.run('INSERT INTO t VALUES (?)', [9007199254740991n]);
      expect(ajuri.get('SELECT i, typeof(i) AS t FROM t')).toEqual({
        i: 9007199254740991,
        t: 'integer',
      });
      expect(() => ajuri.run('INSERT INTO t VALUES (?)', [9007199254740993n])).toThrow(RangeError);
    });
  });

  it('palauttaa lastInsertRowidin; päivitys ei muuta sitä (kuten better-sqlite3)', async () => {
    await tuoreessa((ajuri) => {
      ajuri.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, x TEXT)');
      expect(ajuri.run('INSERT INTO t (x) VALUES (?)', ['a']).lastInsertRowid).toBe(1);
      expect(ajuri.run('INSERT INTO t (x) VALUES (?)', ['b']).lastInsertRowid).toBe(2);
      expect(ajuri.run('UPDATE t SET x = ? WHERE id = 1', ['c']).lastInsertRowid).toBe(2);
      expect(ajuri.all('SELECT id, x FROM t ORDER BY id')).toEqual([
        { id: 1, x: 'c' },
        { id: 2, x: 'b' },
      ]);
      expect(ajuri.get('SELECT x FROM t WHERE id = 99')).toBeUndefined();
    });
  });

  it('ajaa monilauseisen DDL-lohkon yhdellä exec-kutsulla', async () => {
    await tuoreessa((ajuri) => {
      ajuri.exec(`
        CREATE TABLE a (id INTEGER PRIMARY KEY);
        CREATE INDEX idx_a ON a(id);
        CREATE TABLE b (id INTEGER PRIMARY KEY, a INTEGER REFERENCES a(id));
        INSERT INTO a (id) VALUES (1);
      `);
      expect(
        ajuri.all("SELECT name FROM sqlite_master WHERE name IN ('a','b','idx_a') ORDER BY name"),
      ).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'idx_a' }]);
      expect(ajuri.get('SELECT COUNT(*) AS n FROM a')?.n).toBe(1);
    });
  });

  it('valvoo vierasavaimet (vrt. better-sqlite3-ajurin foreign_keys = ON)', async () => {
    await tuoreessa((ajuri) => {
      ajuri.exec(
        'CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (a INTEGER NOT NULL REFERENCES a(id))',
      );
      expect(() => ajuri.run('INSERT INTO b (a) VALUES (?)', [42])).toThrow(/FOREIGN KEY/);
    });
  });

  it('transaktio palauttaa arvon ja peruu kaiken poikkeuksessa', async () => {
    await tuoreessa((ajuri) => {
      ajuri.exec('CREATE TABLE t (x INTEGER)');
      expect(
        ajuri.transaction((tx) => {
          tx.run('INSERT INTO t VALUES (?)', [1]);
          return tx.get('SELECT COUNT(*) AS n FROM t')?.n;
        }),
      ).toBe(1);
      expect(() =>
        ajuri.transaction((tx) => {
          tx.run('INSERT INTO t VALUES (?)', [2]);
          throw new Error('peru');
        }),
      ).toThrow('peru');
      expect(ajuri.all('SELECT x FROM t')).toEqual([{ x: 1 }]);
    });
  });

  it('sisäkkäinen transaktio peruu vain oman osuutensa', async () => {
    await tuoreessa((ajuri) => {
      ajuri.exec('CREATE TABLE t (x INTEGER)');
      ajuri.transaction((tx) => {
        tx.run('INSERT INTO t VALUES (?)', [1]);
        expect(() =>
          ajuri.transaction((sisa) => {
            sisa.run('INSERT INTO t VALUES (?)', [2]);
            throw new Error('sisä');
          }),
        ).toThrow('sisä');
      });
      expect(ajuri.all('SELECT x FROM t')).toEqual([{ x: 1 }]);
    });
  });

  it('suljettu ajuri hylkää kutsut', async () => {
    await tuoreessa((ajuri) => {
      ajuri.close();
      expect(() => ajuri.all('SELECT 1')).toThrow(/not open/);
      expect(() => ajuri.transaction(() => 1)).toThrow(/not open/);
    });
  });
});
