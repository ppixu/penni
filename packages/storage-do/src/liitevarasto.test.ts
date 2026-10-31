import { env, runInDurableObject } from 'cloudflare:test';
import { createSqliteCoreStorage, sha256Heksa } from '@penni/storage-sqlite-core';
import { describe, expect, it } from 'vitest';
import { luoDoSqliteAjuri } from './ajuri-do.js';
import { liiteAvain, luoR2Liitevarasto } from './liitevarasto-r2.js';

const aika = '2026-06-01T10:00:00.000Z';
const tosite = { pvm: '2026-03-01', tyyppi: 0, tila: 50, tunniste: 1, sarja: '', viennit: [] };
const MIB = 1024 * 1024;
const tavut = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31) & 0xff);

const uusiStub = () => env.KIRJA.get(env.KIRJA.newUniqueId());

describe('R2-liitevarasto DO:n SQLiten rinnalla', () => {
  it('DO SQLite ei mahduta yli 2 MB:n liitettä riville (syy varastolle) — R2:n kanssa mahtuu', async () => {
    const data = tavut(3 * MIB);
    // Ilman varastoa: tavut riville → DO:n rivi-/blob-raja (2 MB) kaataa tallennuksen.
    await runInDurableObject(uusiStub(), async (_o, state) => {
      const kirja = createSqliteCoreStorage(luoDoSqliteAjuri(state.storage));
      const t = await kirja.saveTosite(tosite as never, { aika });
      await expect(
        kirja.saveLiite({
          tosite: t.id,
          nimi: 'iso.pdf',
          tyyppi: 'application/pdf',
          luotu: aika,
          data,
        }),
      ).rejects.toThrow(/too big|TOOBIG|exceeds|too large/i);
    });
    // Varaston kanssa: sama liite kulkee R2:n kautta, rivi pysyy pienenä.
    const kirjaId = crypto.randomUUID();
    await runInDurableObject(uusiStub(), async (_o, state) => {
      const kirja = createSqliteCoreStorage(
        luoDoSqliteAjuri(state.storage),
        {},
        { liitevarasto: luoR2Liitevarasto(env.LIITETESTI, kirjaId) },
      );
      const t = await kirja.saveTosite(tosite as never, { aika });
      const meta = await kirja.saveLiite({
        tosite: t.id,
        nimi: 'iso.pdf',
        tyyppi: 'application/pdf',
        luotu: aika,
        data,
      });
      expect((await kirja.getLiite(meta.id))?.data).toEqual(data);
      const sha = await sha256Heksa(data);
      const objekti = await env.LIITETESTI.get(liiteAvain(kirjaId, sha));
      expect(objekti?.size).toBe(3 * MIB);
    });
  });

  it('liiteAvain on kirja/<kirjaId>/liite/<sha256>', () => {
    expect(liiteAvain('k-1', 'abc')).toBe('kirja/k-1/liite/abc');
  });

  it('R2 hylkää tavut, jotka eivät vastaa ilmoitettua sha256:ta (put-valinta)', async () => {
    const varasto = luoR2Liitevarasto(env.LIITETESTI, crypto.randomUUID());
    await expect(varasto.tallenna('0'.repeat(64), tavut(100))).rejects.toThrow();
  });

  it('hae palauttaa null puuttuvalle avaimelle', async () => {
    const varasto = luoR2Liitevarasto(env.LIITETESTI, crypto.randomUUID());
    expect(await varasto.hae('kirja/ei/liite/ole')).toBeNull();
  });
});
