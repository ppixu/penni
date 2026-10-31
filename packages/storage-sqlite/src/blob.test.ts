import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { luoBetterSqliteAjuriDb } from './ajuri-better.js';

describe('better-sqlite3 BLOB-kierto', () => {
  it('sitoo ja palauttaa Uint8Arrayn muuttumattomana', () => {
    const ajuri = luoBetterSqliteAjuriDb(new Database(':memory:'));
    ajuri.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, b BLOB)');
    const tavut = new Uint8Array([0x00, 0x7f, 0xff, 0x10, 0x20]);
    ajuri.run('INSERT INTO t (id, b) VALUES (?, ?)', [1, tavut]);
    const rivi = ajuri.get('SELECT b FROM t WHERE id = ?', [1]);
    const takaisin = rivi?.b as Uint8Array;
    expect(takaisin).toBeInstanceOf(Uint8Array);
    expect(new Uint8Array(takaisin)).toEqual(tavut);
    ajuri.close();
  });
});
