import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { TositeTyyppi } from '../vouchers/enums.js';
import { luoTilinavaus } from './tilinavaus.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-06-01T00:00:00.000Z' };

const seed = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } }, // vastaavaa (asset)
      { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } }, // oma pääoma
      { numero: 2800, tyyppi: 'BL', nimi: { fi: 'Ostovelat' } }, // vastattavaa (liability)
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {},
  });

describe('luoTilinavaus', () => {
  it('kirjaa TILINAVAUS-tositteen: vastaavaa debetiin, muut kreditiin', async () => {
    const s = seed();
    const t = await luoTilinavaus(
      s,
      {
        pvm: '2026-01-01',
        saldot: [
          { tili: 1900, saldo: c(15000) }, // asset positiivinen -> debet
          { tili: 2800, saldo: c(5000) }, // velka positiivinen -> kredit
          { tili: 2251, saldo: c(10000) }, // oma pääoma -> kredit
        ],
      },
      env,
    );
    expect(t.tyyppi).toBe(TositeTyyppi.TILINAVAUS);
    expect(t.tila).toBe(100);
    expect(t.viennit.find((v) => v.tili === 1900)?.debet).toBe(15000);
    expect(t.viennit.find((v) => v.tili === 1900)?.kredit).toBe(0);
    expect(t.viennit.find((v) => v.tili === 2800)?.kredit).toBe(5000);
    expect(t.viennit.find((v) => v.tili === 2251)?.kredit).toBe(10000);
  });

  it('negatiivinen saldo kääntää puolen', async () => {
    const s = seed();
    const t = await luoTilinavaus(
      s,
      { pvm: '2026-01-01', saldot: [{ tili: 1900, saldo: c(-2000) }] }, // asset negatiivinen -> kredit
      env,
    );
    expect(t.viennit.find((v) => v.tili === 1900)?.kredit).toBe(2000);
    expect(t.viennit.find((v) => v.tili === 1900)?.debet).toBe(0);
  });

  it('ohittaa nollasaldot', async () => {
    const s = seed();
    const t = await luoTilinavaus(
      s,
      {
        pvm: '2026-01-01',
        saldot: [
          { tili: 1900, saldo: c(15000) },
          { tili: 2800, saldo: c(0) },
        ],
      },
      env,
    );
    expect(t.viennit).toHaveLength(1);
  });

  it('kirjaa epätasapainoisenkin avauksen (TILINAVAUS on EITASMAA-vapaa)', async () => {
    const s = seed();
    const t = await luoTilinavaus(
      s,
      { pvm: '2026-01-01', saldot: [{ tili: 1900, saldo: c(15000) }] }, // vain toinen puoli
      env,
    );
    expect(t.viennit).toHaveLength(1);
    expect(t.tila).toBe(100);
  });

  it('merkitsee Tilinavaus- ja TilinavausPvm-asetukset', async () => {
    const s = seed();
    await luoTilinavaus(s, { pvm: '2026-01-01', saldot: [{ tili: 1900, saldo: c(15000) }] }, env);
    const a = await s.getAsetukset();
    expect(a.Tilinavaus).toBe('1');
    expect(a.TilinavausPvm).toBe('2026-01-01');
  });

  it('hylkää tuntemattoman tilin (TILIPUUTTUU)', async () => {
    const s = seed();
    await expect(
      luoTilinavaus(s, { pvm: '2026-01-01', saldot: [{ tili: 9999, saldo: c(100) }] }, env),
    ).rejects.toMatchObject({ code: 'TILIPUUTTUU' });
  });

  it('ei-vastaavaa-tili negatiivisella saldolla menee debetiin', async () => {
    const s = seed();
    const t = await luoTilinavaus(
      s,
      { pvm: '2026-01-01', saldot: [{ tili: 2800, saldo: c(-3000) }] }, // velka negatiivinen -> debet
      env,
    );
    expect(t.viennit.find((v) => v.tili === 2800)?.debet).toBe(3000);
    expect(t.viennit.find((v) => v.tili === 2800)?.kredit).toBe(0);
  });

  it('hylkää tilinavauksen lukitulle kaudelle (PVMLUKITTU) eikä merkitse asetuksia', async () => {
    const s = seed();
    await s.patchAsetukset({ TilitPaatetty: '2026-12-31' });
    await expect(
      luoTilinavaus(s, { pvm: '2026-01-01', saldot: [{ tili: 1900, saldo: c(15000) }] }, env),
    ).rejects.toMatchObject({ code: 'PVMLUKITTU' });
    const a = await s.getAsetukset();
    expect(a.Tilinavaus).toBeUndefined();
  });
});
