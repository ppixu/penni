import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { describe, expect, it } from 'vitest';
import { luoOo1Ajuri } from './ajuri-oo1.js';

async function muistiAjuri() {
  const sqlite3 = await sqlite3InitModule();
  return luoOo1Ajuri(new sqlite3.oo1.DB(':memory:'));
}

describe('oo1 (sqlite-wasm) BLOB-kierto', () => {
  it('sitoo ja palauttaa Uint8Arrayn muuttumattomana', async () => {
    const ajuri = await muistiAjuri();
    ajuri.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, b BLOB)');
    const tavut = new Uint8Array([0x00, 0x7f, 0xff, 0x10, 0x20]);
    ajuri.run('INSERT INTO t (id, b) VALUES (?, ?)', [1, tavut]);
    const rivi = ajuri.get('SELECT b FROM t WHERE id = ?', [1]);
    expect(new Uint8Array(rivi?.b as Uint8Array)).toEqual(tavut);
    ajuri.close();
  });
});
