import { InProcessClient } from '@penni/asiakas';
import { ResourceError, TositeTila } from '@penni/engine';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { env, luoTestikirja } from '../testi/kirja.js';
import { tositeLuonnos } from './tositeLuonnos.js';

const syote = {
  pvm: '2026-04-01',
  tyyppi: 101,
  otsikko: 'Agentin luonnos',
  viennit: [
    { tili: 4000, debet: 2550, kredit: 0 },
    { tili: 1900, debet: 0, kredit: 2550 },
  ],
};

describe('tosite_luonnos', () => {
  it('creates a draft voucher with tila LUONNOS', async () => {
    const { client } = await luoTestikirja();
    const tulos = (await tositeLuonnos.suorita(client, syote, env)) as {
      id: number;
      tila: number;
      tunniste: number;
    };
    expect(tulos.tila).toBe(TositeTila.LUONNOS);
    expect(tulos.tunniste).toBe(0); // no gapless number consumed
    const haettu = await client.haeTosite(tulos.id);
    expect(haettu?.otsikko).toBe('Agentin luonnos');
  });

  it('rejects tila >= 100 before the engine sees it', async () => {
    const { client } = await luoTestikirja();
    await expect(tositeLuonnos.suorita(client, { ...syote, tila: 100 }, env)).rejects.toMatchObject(
      { koodi: 'LUONNOSVAIN' },
    );
  });

  it('rejects a sub-100 non-draft tila such as VALMISLASKU (80)', async () => {
    const { client } = await luoTestikirja();
    await expect(tositeLuonnos.suorita(client, { ...syote, tila: 80 }, env)).rejects.toMatchObject({
      koodi: 'LUONNOSVAIN',
    });
  });

  it('stamps the audit row with the client lahde', async () => {
    const { client, storage } = await luoTestikirja('agentti:testi');
    const tulos = (await tositeLuonnos.suorita(client, syote, env)) as { id: number };
    const loki = await storage.getLoki(tulos.id);
    expect(loki.at(-1)?.lahde).toBe('agentti:testi');
  });

  it('surfaces the period lock as a ResourceError', async () => {
    const storage = createMemoryStorage({
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
        { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
        { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { Nimi: 'Testi Oy', AlvVelvollinen: 'true', TilitPaatetty: '2026-12-31' },
    });
    const client = new InProcessClient(storage, () => env.aika);
    await expect(tositeLuonnos.suorita(client, syote, env)).rejects.toBeInstanceOf(ResourceError);
  });

  it('returns no varoitukset for a balanced draft on existing accounts', async () => {
    const { client } = await luoTestikirja();
    const tulos = (await tositeLuonnos.suorita(client, syote, env)) as { varoitukset: unknown[] };
    expect(tulos.varoitukset).toEqual([]);
  });

  it('saves an unbalanced draft but reports EITASMAA as a finalize-blocking warning', async () => {
    const { client } = await luoTestikirja();
    const epatasainen = {
      ...syote,
      viennit: [
        { tili: 4000, debet: 2550, kredit: 0 },
        { tili: 1900, debet: 0, kredit: 2500 },
      ],
    };
    const tulos = (await tositeLuonnos.suorita(client, epatasainen, env)) as {
      id: number;
      varoitukset: { koodi: string; viesti: string; estaaKirjauksen: boolean }[];
    };
    expect(await client.haeTosite(tulos.id)).not.toBeNull(); // still saved
    const eitasmaa = tulos.varoitukset.find((v) => v.koodi === 'EITASMAA');
    expect(eitasmaa?.estaaKirjauksen).toBe(true);
    expect(eitasmaa?.viesti).toContain('25,50');
    expect(eitasmaa?.viesti).toContain('25,00');
    // the same finding makes the human's finalize fail, exactly as the warning said
    await expect(client.muutaTila(tulos.id, TositeTila.KIRJANPIDOSSA)).rejects.toMatchObject({
      code: 'EIVALMISTU',
    });
  });

  it('warns (without refusing) when the date is outside every fiscal year', async () => {
    const { client } = await luoTestikirja();
    const tulos = (await tositeLuonnos.suorita(client, { ...syote, pvm: '2027-01-15' }, env)) as {
      varoitukset: { koodi: string }[];
    };
    expect(tulos.varoitukset.map((v) => v.koodi)).toContain('EIAVOINTAKUTTA');
  });

  it('refuses a draft on an account that is not in the chart, saving nothing', async () => {
    const { client } = await luoTestikirja();
    const ennen = await client.listaaTositteet({ bucket: 'luonnos' });
    const vaaraTili = {
      ...syote,
      viennit: [
        { tili: 4999, debet: 2550, kredit: 0 },
        { tili: 1900, debet: 0, kredit: 2550 },
      ],
    };
    await expect(tositeLuonnos.suorita(client, vaaraTili, env)).rejects.toMatchObject({
      koodi: 'TILIPUUTTUU',
      message: expect.stringContaining('4999'),
    });
    expect(await client.listaaTositteet({ bucket: 'luonnos' })).toHaveLength(ennen.length);
  });

  it('refuses an impossible calendar date', async () => {
    const { client } = await luoTestikirja();
    await expect(
      tositeLuonnos.suorita(client, { ...syote, pvm: '2026-02-30' }, env),
    ).rejects.toMatchObject({ koodi: 'PVMPUUTTUU' });
  });
});
