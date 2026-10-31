import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Cents } from '@penni/euro';
import { afterAll, describe, expect, it } from 'vitest';
import { luoPglite } from './ajuri.js';
import { createPostgresStorage } from './postgres.js';

const c = (n: number): Cents => n as Cents;
const audit = { aika: '2026-06-01T10:00:00.000Z' };
const dir = mkdtempSync(join(tmpdir(), 'penni-pg-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('postgres persistence', () => {
  it('round-trips a seeded chart and a posted voucher across close/reopen', async () => {
    const path = join(dir, 'kirja');
    const s1 = await createPostgresStorage(await luoPglite(path), {
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
      audit,
    );
    await s1.close();

    // Reopen a fresh connection on the same dataDir — seeding is skipped (db not empty).
    const s2 = await createPostgresStorage(await luoPglite(path), {});
    expect((await s2.getTosite(saved.id))?.tunniste).toBe(1);
    expect((await s2.getChart()).find((t) => t.numero === 1900)?.nimi.fi).toBe('Pankki');
    expect((await s2.querySaldot({ loppupvm: '2026-12-31' })).get(1900)).toBe(5000);
    await s2.close();
  });
});
