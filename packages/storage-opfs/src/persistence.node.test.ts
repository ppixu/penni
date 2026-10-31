import type { Cents } from '@penni/euro';
import { createSqliteCoreStorage } from '@penni/storage-sqlite-core';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { describe, expect, it } from 'vitest';
import { luoOo1Ajuri } from './ajuri-oo1.js';

const c = (n: number): Cents => n as Cents;

describe('OO1 seed-if-empty + uudelleenrakentaminen samalle kahvalle', () => {
  it('siementää tyhjän kannan ja ohittaa siemennyksen ei-tyhjälle', async () => {
    const sqlite3 = await sqlite3InitModule();
    const db = new sqlite3.oo1.DB(':memory:');
    const ajuri = luoOo1Ajuri(db);
    const s1 = createSqliteCoreStorage(ajuri, {
      tilit: [{ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } }],
    });
    const saved = await s1.saveTosite(
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
      { aika: '2026-06-01T10:00:00.000Z' },
    );
    // Rakenna uusi core-storage SAMAN kahvan päälle eri siemenellä — kanta ei ole tyhjä,
    // joten siemennys ohitetaan ja olemassa oleva data säilyy.
    const s2 = createSqliteCoreStorage(ajuri, {
      tilit: [{ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'EI SAA YLIKIRJOITTAA' } }],
    });
    expect((await s2.getTosite(saved.id))?.tunniste).toBe(1);
    expect((await s2.getChart()).find((t) => t.numero === 1900)?.nimi.fi).toBe('Pankki');
    expect((await s2.querySaldot({ loppupvm: '2026-12-31' })).get(1900)).toBe(5000);
    db.close();
  });
});
