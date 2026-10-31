import { describe, expect, it } from 'vitest';
import { c, env, luoTestikirja } from '../testi/kirja.js';
import { viennitHaku } from './viennitHaku.js';

describe('viennitHaku', () => {
  it('lists posted viennit with money in both forms', async () => {
    const tulos = (await viennitHaku.suorita((await luoTestikirja()).client, {}, env)) as {
      viennit: {
        tili: number;
        debet: { sentit: number; eur: string };
        kredit: { sentit: number; eur: string };
        alvProsentti: number;
        selite: string | null;
      }[];
      lukumaara: number;
      rajattu: boolean;
    };
    // only the finalized sale's two viennit; the draft purchase is not posted
    expect(tulos.viennit).toHaveLength(2);
    expect(tulos.lukumaara).toBe(2);
    expect(tulos.rajattu).toBe(false);
    expect(tulos.viennit[0]?.alvProsentti).toBe(0);
    const pankki = tulos.viennit.find((v) => v.tili === 1900);
    expect(pankki?.debet).toEqual({ sentit: 10000, eur: '100,00\u00a0€' });
    expect(pankki?.selite).toBeNull();
  });

  it('filters by alvProsentti and reports the filtered lukumaara', async () => {
    const { client } = await luoTestikirja();
    const nolla = (await viennitHaku.suorita(client, { alvProsentti: 0 }, env)) as {
      lukumaara: number;
    };
    expect(nolla.lukumaara).toBe(2);
    const korkea = (await viennitHaku.suorita(client, { alvProsentti: 25.5 }, env)) as {
      lukumaara: number;
      viennit: unknown[];
    };
    expect(korkea.lukumaara).toBe(0);
    expect(korkea.viennit).toEqual([]);
  });

  it('caps rows at raja but keeps the full lukumaara', async () => {
    const tulos = (await viennitHaku.suorita((await luoTestikirja()).client, { raja: 1 }, env)) as {
      lukumaara: number;
      viennit: unknown[];
      rajattu: boolean;
    };
    expect(tulos.viennit).toHaveLength(1);
    expect(tulos.lukumaara).toBe(2);
    expect(tulos.rajattu).toBe(true);
  });

  it('filters by tili', async () => {
    const tulos = (await viennitHaku.suorita(
      (
        await luoTestikirja()
      ).client,
      { tili: 3000 },
      env,
    )) as { viennit: { tili: number }[] };
    expect(tulos.viennit).toHaveLength(1);
    expect(tulos.viennit[0]?.tili).toBe(3000);
  });

  it('filters by alkaen/loppuen', async () => {
    const tulos = (await viennitHaku.suorita(
      (
        await luoTestikirja()
      ).client,
      { alkaen: '2026-03-01', loppuen: '2026-12-31' },
      env,
    )) as { viennit: unknown[] };
    // the sale is on 2026-02-01, so it falls outside this window
    expect(tulos.viennit).toEqual([]);
  });

  it('rejects a malformed loppuen via zod', async () => {
    await expect(
      viennitHaku.suorita((await luoTestikirja()).client, { loppuen: '2026/03/01' }, env),
    ).rejects.toThrow();
  });

  it('links every row to its voucher and carries the alv code', async () => {
    const { client } = await luoTestikirja();
    const [myynti] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    const tulos = (await viennitHaku.suorita(client, { tili: 1900 }, env)) as {
      viennit: Record<string, unknown>[];
    };
    expect(tulos.viennit).toHaveLength(1);
    expect(tulos.viennit[0]).toMatchObject({
      tosite: myynti?.id,
      tunniste: myynti?.tunniste,
      otsikko: 'Konsultointi',
      alvKoodi: 0,
      alvProsentti: 0,
    });
  });

  it('filters by the vienti date, not the voucher date', async () => {
    const { client } = await luoTestikirja();
    const t = await client.luoTosite({
      pvm: '2026-05-31',
      tyyppi: 0,
      sarja: '',
      otsikko: 'Jaksotus',
      viennit: [
        {
          tili: 4000,
          debet: c(500),
          kredit: c(0),
          pvm: '2026-06-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 1900,
          debet: c(0),
          kredit: c(500),
          pvm: '2026-06-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
    await client.muutaTila(t.id, 100);
    const kesakuu = (await viennitHaku.suorita(
      client,
      { alkaen: '2026-06-01', loppuen: '2026-06-30' },
      env,
    )) as { lukumaara: number; viennit: { tosite: number }[] };
    expect(kesakuu.lukumaara).toBe(2);
    expect(kesakuu.viennit.every((v) => v.tosite === t.id)).toBe(true);
    const toukokuu = (await viennitHaku.suorita(
      client,
      { alkaen: '2026-05-01', loppuen: '2026-05-31' },
      env,
    )) as { lukumaara: number };
    expect(toukokuu.lukumaara).toBe(0);
  });
});
