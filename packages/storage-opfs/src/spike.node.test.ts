import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { describe, expect, it } from 'vitest';

describe('sqlite-wasm OO1 Nodessa (spike)', () => {
  it('alustaa moduulin ja ajaa SQL:n muistissa', async () => {
    const sqlite3 = await sqlite3InitModule();
    const db = new sqlite3.oo1.DB(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, nimi TEXT)');
    db.exec({ sql: 'INSERT INTO t (nimi) VALUES (?)', bind: ['Kissa'] });
    const rivi = db.selectObject('SELECT id, nimi FROM t WHERE id = ?', [1]);
    expect(rivi).toEqual({ id: 1, nimi: 'Kissa' });
    const id = db.selectValue('SELECT last_insert_rowid()');
    expect(Number(id)).toBe(1);
    db.close();
  });
});
