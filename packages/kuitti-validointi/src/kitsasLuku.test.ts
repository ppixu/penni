import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { avaaKitsas } from './kitsasLuku.js';

// Reference fixture from the kitsas-source git submodule (skipped if it is not checked out).
const FIXTURE = new URL('../../../kitsas-source/unittest/data/oy.kitsas', import.meta.url).pathname;

describe.skipIf(!existsSync(FIXTURE))('avaaKitsas (oy.kitsas fixture)', () => {
  // oy.kitsas is WAL-mode: opening it creates -shm/-wal sidecar files next to it.
  // kitsas-source is reference-only, so work on a copy in a temp dir instead.
  let dir: string;
  let db: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kitsas-fixture-'));
    db = join(dir, 'oy.kitsas');
    copyFileSync(FIXTURE, db);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lukee tilikartan luonteineen', () => {
    const { chart } = avaaKitsas(db);
    expect(chart.length).toBeGreaterThan(0);
    expect(chart.every((t) => typeof t.numero === 'number')).toBe(true);
    // At least one bank-nature account exists in a real chart.
    expect(chart.some((t) => t.tyyppiKoodi === 'ARP')).toBe(true);
  });

  it('palauttaa vain ostotositteet joilla on liite, oikean muotoisina', () => {
    const { ostotositteet } = avaaKitsas(db);
    for (const t of ostotositteet) {
      expect(t.tyyppi).toBeGreaterThanOrEqual(100);
      expect(t.tyyppi).toBeLessThan(200);
      expect(t.liitteet.length).toBeGreaterThan(0);
      expect(Array.isArray(t.legit)).toBe(true);
      for (const l of t.liitteet) expect(l.data).toBeInstanceOf(Uint8Array);
    }
  });
});
