import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { describe, expect, it } from 'vitest';
import { luoOo1Ajuri } from './ajuri-oo1.js';

async function muistiAjuri() {
  const sqlite3 = await sqlite3InitModule();
  return luoOo1Ajuri(new sqlite3.oo1.DB(':memory:'));
}

describe('luoOo1Ajuri', () => {
  it('run palauttaa lastInsertRowid:n ja get/all lukevat sarakkeet nimellä', async () => {
    const a = await muistiAjuri();
    a.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, nimi TEXT)');
    const r1 = a.run('INSERT INTO t (nimi) VALUES (?)', ['Aapo']);
    const r2 = a.run('INSERT INTO t (nimi) VALUES (?)', ['Beata']);
    expect(r1.lastInsertRowid).toBe(1);
    expect(r2.lastInsertRowid).toBe(2);
    expect(a.get('SELECT nimi FROM t WHERE id = ?', [2])).toEqual({ nimi: 'Beata' });
    expect(a.all('SELECT id FROM t ORDER BY id')).toEqual([{ id: 1 }, { id: 2 }]);
    a.close();
  });

  it('transaction sitoo onnistuessa ja peruu virheessä', async () => {
    const a = await muistiAjuri();
    a.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)');
    a.transaction((tx) => tx.run('INSERT INTO t (id, n) VALUES (?, ?)', [1, 10]));
    expect(() =>
      a.transaction((tx) => {
        tx.run('INSERT INTO t (id, n) VALUES (?, ?)', [2, 20]);
        throw new Error('peru');
      }),
    ).toThrow('peru');
    expect(a.all('SELECT id FROM t')).toEqual([{ id: 1 }]); // rivi 2 peruttu
    a.close();
  });
});
