import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { TESTI_SALDOT, luoTestiKitsas } from './luoTestiKitsas.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-tuonti-'));
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

describe('luoTestiKitsas', () => {
  it('kirjoittaa avattavan Kitsas-kannan jossa on odotetut rivit', () => {
    const polku = join(hakemisto, 'testi.kitsas');
    luoTestiKitsas(polku);
    const db = new Database(polku, { readonly: true });
    try {
      const laske = (taulu: string): number =>
        (db.prepare(`SELECT count(*) n FROM ${taulu}`).get() as { n: number }).n;
      expect(laske('Tilikausi')).toBe(2);
      expect(laske('Tosite')).toBe(5);
      expect(laske('Vienti')).toBe(10);
      expect(laske('Liite')).toBe(1);
      expect(laske('Kumppani')).toBe(1);
      // Yksi tosite on poistettu (tila 0) eikä saa näkyä saldoissa.
      expect(
        (db.prepare('SELECT count(*) n FROM Tosite WHERE tila = 0').get() as { n: number }).n,
      ).toBe(1);
      // Kohdennus must contain exactly one seed row with tyyppi=0
      const kohdennus = db.prepare('SELECT count(*) n FROM Kohdennus WHERE tyyppi = 0').get() as {
        n: number;
      };
      expect(kohdennus.n).toBe(1);
    } finally {
      db.close();
    }
  });

  it('odotetut saldot vastaavat kannan omaa summaa', () => {
    const polku = join(hakemisto, 'saldot.kitsas');
    luoTestiKitsas(polku);
    const db = new Database(polku, { readonly: true });
    try {
      const rivit = db
        .prepare(
          `SELECT v.tili tili, SUM(COALESCE(v.debetsnt,0)) - SUM(COALESCE(v.kreditsnt,0)) saldo
           FROM Vienti v JOIN Tosite t ON t.id = v.tosite
           WHERE t.tila >= 100 GROUP BY v.tili ORDER BY v.tili`,
        )
        .all() as { tili: number; saldo: number }[];
      const saldot = Object.fromEntries(rivit.map((r) => [r.tili, r.saldo]));
      expect(saldot).toEqual(TESTI_SALDOT);
    } finally {
      db.close();
    }
  });
});
