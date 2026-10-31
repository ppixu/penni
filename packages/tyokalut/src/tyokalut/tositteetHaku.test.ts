import { TositeTyyppi } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { c, env, luoTestikirja } from '../testi/kirja.js';
import { tositteetHaku } from './tositteetHaku.js';

describe('tositteetHaku', () => {
  it('filters by free text over otsikko', async () => {
    const tulos = (await tositteetHaku.suorita(
      (
        await luoTestikirja()
      ).client,
      { teksti: 'puhelin', bucket: 'luonnos' },
      env,
    )) as { tositteet: { otsikko?: string }[] };
    expect(tulos.tositteet).toHaveLength(1);
    expect(tulos.tositteet[0]?.otsikko).toBe('Puhelinlasku');
  });

  it('defaults to the kirjanpidossa bucket and sums debet into debetSumma', async () => {
    const tulos = (await tositteetHaku.suorita((await luoTestikirja()).client, {}, env)) as {
      tositteet: { otsikko: string | null; debetSumma: { sentit: number; eur: string } }[];
    };
    expect(tulos.tositteet).toHaveLength(1);
    expect(tulos.tositteet[0]?.otsikko).toBe('Konsultointi');
    expect(tulos.tositteet[0]?.debetSumma?.sentit).toBe(10000);
    expect(tulos.tositteet[0]?.debetSumma?.eur).toBe('100,00\u00a0€');
  });

  it('is not rajattu under the 100-row cap and reports the total match count', async () => {
    const tulos = (await tositteetHaku.suorita((await luoTestikirja()).client, {}, env)) as {
      lukumaara: number;
      rajattu: boolean;
    };
    expect(tulos.rajattu).toBe(false);
    expect(tulos.lukumaara).toBe(1);
  });

  it('lists newest (largest tunniste) first and caps rows at raja', async () => {
    const { client } = await luoTestikirja();
    const uusi = await client.luoTosite({
      pvm: '2026-04-01',
      tyyppi: TositeTyyppi.TULO,
      sarja: '',
      otsikko: 'Uudempi myynti',
      viennit: [
        {
          tili: 1900,
          debet: c(500),
          kredit: c(0),
          pvm: '2026-04-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 3000,
          debet: c(0),
          kredit: c(500),
          pvm: '2026-04-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
    await client.muutaTila(uusi.id, 100);
    const tulos = (await tositteetHaku.suorita(client, { raja: 1 }, env)) as {
      lukumaara: number;
      tositteet: { otsikko: string | null }[];
      rajattu: boolean;
    };
    expect(tulos.lukumaara).toBe(2);
    expect(tulos.tositteet).toHaveLength(1);
    expect(tulos.tositteet[0]?.otsikko).toBe('Uudempi myynti');
    expect(tulos.rajattu).toBe(true);
  });

  it('filters by exact sarja match', async () => {
    const tulos = (await tositteetHaku.suorita(
      (
        await luoTestikirja()
      ).client,
      { sarja: 'X' },
      env,
    )) as { tositteet: unknown[] };
    expect(tulos.tositteet).toEqual([]);
  });

  it('rejects a malformed alkaen via zod', async () => {
    await expect(
      tositteetHaku.suorita((await luoTestikirja()).client, { alkaen: '1.1.2026' }, env),
    ).rejects.toThrow();
  });
});
