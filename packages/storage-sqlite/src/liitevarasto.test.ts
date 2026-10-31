import type { Liitevarasto } from '@penni/storage-sqlite-core';
import { createSqliteCoreStorage, sha256Heksa } from '@penni/storage-sqlite-core';
import { describe, expect, it } from 'vitest';
import { luoBetterSqliteAjuri } from './ajuri-better.js';

const aika = '2026-06-01T10:00:00.000Z';
const tosite = {
  pvm: '2026-03-01',
  tyyppi: 0,
  tila: 50,
  tunniste: 1,
  sarja: '',
  viennit: [],
};

/** Muistinvarainen varasto; kirjaa kutsut. */
function muistiVarasto(): Liitevarasto & { objektit: Map<string, Uint8Array> } {
  const objektit = new Map<string, Uint8Array>();
  return {
    objektit,
    async tallenna(sha, data) {
      const avain = `testi/${sha}`;
      objektit.set(avain, data);
      return avain;
    },
    async hae(avain) {
      return objektit.get(avain) ?? null;
    },
  };
}

const tavut = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 7) & 0xff);

async function liitteellinen(valinnat?: { liitevarasto?: Liitevarasto }) {
  const ajuri = luoBetterSqliteAjuri(':memory:');
  const kirja = createSqliteCoreStorage(ajuri, {}, valinnat);
  const t = await kirja.saveTosite(tosite as never, { aika });
  return { ajuri, kirja, tositeId: t.id };
}

describe('liitevarasto-sauma (createSqliteCoreStorage)', () => {
  it('ilman varastoa tavut ovat SQLite-rivillä kuten ennen (varasto_avain NULL)', async () => {
    const { ajuri, kirja, tositeId } = await liitteellinen();
    const data = tavut(1000);
    const meta = await kirja.saveLiite({
      tosite: tositeId,
      nimi: 'a.pdf',
      tyyppi: 'application/pdf',
      luotu: aika,
      data,
    });
    const rivi = ajuri.get(
      'SELECT length(data) AS n, varasto_avain, koko FROM liite WHERE id = ?',
      [meta.id],
    );
    expect(rivi).toEqual({ n: 1000, varasto_avain: null, koko: 1000 });
    expect((await kirja.getLiite(meta.id))?.data).toEqual(data);
  });

  it('varaston kanssa tavut menevät varastoon sha256-avaimella; rivillä vain metatieto + avain', async () => {
    const varasto = muistiVarasto();
    const { ajuri, kirja, tositeId } = await liitteellinen({ liitevarasto: varasto });
    const data = tavut(5000);
    const sha = await sha256Heksa(data);
    const meta = await kirja.saveLiite({
      tosite: tositeId,
      nimi: 'b.pdf',
      tyyppi: 'application/pdf',
      sha,
      luotu: aika,
      data,
    });
    expect(meta).not.toHaveProperty('data');
    const rivi = ajuri.get(
      'SELECT length(data) AS n, varasto_avain, koko, sha FROM liite WHERE id = ?',
      [meta.id],
    );
    expect(rivi).toEqual({ n: 0, varasto_avain: `testi/${sha}`, koko: 5000, sha });
    expect(varasto.objektit.get(`testi/${sha}`)).toEqual(data);
    expect((await kirja.getLiite(meta.id))?.data).toEqual(data);
    expect((await kirja.getLiitteet(tositeId)).map((l) => l.id)).toEqual([meta.id]);
  });

  it('avain johdetaan sisällöstä itse, ei asiakkaan ilmoittamasta sha-kentästä', async () => {
    const varasto = muistiVarasto();
    const { kirja, tositeId } = await liitteellinen({ liitevarasto: varasto });
    const data = tavut(64);
    await kirja.saveLiite({
      tosite: tositeId,
      nimi: 'c.png',
      tyyppi: 'image/png',
      sha: 'vaara',
      luotu: aika,
      data,
    });
    expect([...varasto.objektit.keys()]).toEqual([`testi/${await sha256Heksa(data)}`]);
  });

  it('roolipäivitys ja id-päivitys vaihtavat varastoviitteen; vanha objekti jää (ei poistoa)', async () => {
    const varasto = muistiVarasto();
    const { ajuri, kirja, tositeId } = await liitteellinen({ liitevarasto: varasto });
    const a = tavut(10);
    const b = tavut(20);
    const m1 = await kirja.saveLiite({
      tosite: tositeId,
      nimi: 'x',
      roolinimi: 'kuitti',
      tyyppi: 'text/plain',
      luotu: aika,
      data: a,
    });
    const m2 = await kirja.saveLiite({
      tosite: tositeId,
      nimi: 'x',
      roolinimi: 'kuitti',
      tyyppi: 'text/plain',
      luotu: aika,
      data: b,
    });
    expect(m2.id).toBe(m1.id);
    expect((await kirja.getLiite(m1.id))?.data).toEqual(b);
    const c = tavut(30);
    await kirja.saveLiite({ ...m2, data: c });
    expect((await kirja.getLiite(m1.id))?.data).toEqual(c);
    expect(varasto.objektit.size).toBe(3);
    expect(ajuri.get('SELECT koko FROM liite WHERE id = ?', [m1.id])).toEqual({ koko: 30 });
  });

  it('vanha rivi (tavut rivillä) luetaan varaston kanssa avatussa kirjassa; poisto poistaa rivin', async () => {
    const tiedosto = `${process.env.TMPDIR ?? '/tmp'}/penni-liite-${crypto.randomUUID()}.db`;
    const ajuri = luoBetterSqliteAjuri(tiedosto);
    const vanha = createSqliteCoreStorage(ajuri);
    const t = await vanha.saveTosite(tosite as never, { aika });
    const data = tavut(300);
    const m = await vanha.saveLiite({
      tosite: t.id,
      nimi: 'vanha.pdf',
      tyyppi: 'application/pdf',
      luotu: aika,
      data,
    });
    const varasto = muistiVarasto();
    const uusi = createSqliteCoreStorage(ajuri, {}, { liitevarasto: varasto });
    expect((await uusi.getLiite(m.id))?.data).toEqual(data);
    await uusi.deleteLiite(m.id);
    expect(await uusi.getLiite(m.id)).toBeNull();
    ajuri.close();
  });

  it('puuttuva varastoobjekti ja puuttuva varasto antavat selkeän virheen', async () => {
    const varasto = muistiVarasto();
    const { ajuri, kirja, tositeId } = await liitteellinen({ liitevarasto: varasto });
    const m = await kirja.saveLiite({
      tosite: tositeId,
      nimi: 'p',
      tyyppi: 'text/plain',
      luotu: aika,
      data: tavut(8),
    });
    varasto.objektit.clear();
    await expect(kirja.getLiite(m.id)).rejects.toThrow(/puuttuvat liitevarastosta/);
    const ilman = createSqliteCoreStorage(ajuri);
    await expect(ilman.getLiite(m.id)).rejects.toThrow(/varastoa ei ole annettu/);
  });
});
