import { InProcessClient } from '@penni/asiakas';
import { TositeTyyppi } from '@penni/engine';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { c, env, luoTestikirja } from '../testi/kirja.js';
import { saldot } from './saldot.js';

describe('saldot', () => {
  it('returns balances with account names and money in both forms', async () => {
    const tulos = (await saldot.suorita(
      (
        await luoTestikirja()
      ).client,
      { pvm: '2026-12-31' },
      env,
    )) as {
      saldot: { tili: number; nimi: string; sentit: number; eur: string }[];
    };
    const pankki = tulos.saldot.find((s) => s.tili === 1900);
    expect(pankki?.sentit).toBe(10000);
    expect(pankki?.eur).toBe('100,00\u00a0€'); // muotoileEuro emits U+00A0 NBSP, not a plain space
    expect(pankki?.nimi).toBe('Pankkitili');
  });

  it('defaults pvm to today from env', async () => {
    const tulos = (await saldot.suorita((await luoTestikirja()).client, {}, env)) as {
      pvm: string;
    };
    expect(tulos.pvm).toBe('2026-08-15');
  });

  it('reports alkupvm as null when not given', async () => {
    const tulos = (await saldot.suorita(
      (
        await luoTestikirja()
      ).client,
      { pvm: '2026-12-31' },
      env,
    )) as { alkupvm: string | null };
    expect(tulos.alkupvm).toBeNull();
  });

  it('only includes vouchers posted (kirjanpidossa), not the draft purchase', async () => {
    const tulos = (await saldot.suorita(
      (
        await luoTestikirja()
      ).client,
      { pvm: '2026-12-31' },
      env,
    )) as { saldot: { tili: number }[] };
    expect(tulos.saldot.map((s) => s.tili).sort()).toEqual([1900, 3000]);
  });

  it('filters by the given tilit', async () => {
    const tulos = (await saldot.suorita(
      (
        await luoTestikirja()
      ).client,
      { pvm: '2026-12-31', tilit: [1900] },
      env,
    )) as { saldot: { tili: number }[] };
    expect(tulos.saldot.map((s) => s.tili)).toEqual([1900]);
  });

  it('filters by haku over account names and gives matches 0-rows when unposted', async () => {
    const tulos = (await saldot.suorita(
      (
        await luoTestikirja()
      ).client,
      { pvm: '2026-12-31', haku: 'osto' },
      env,
    )) as { saldot: { tili: number; nimi: string; sentit: number }[] };
    expect(tulos.saldot).toHaveLength(1);
    expect(tulos.saldot[0]).toMatchObject({ tili: 4000, nimi: 'Ostot', sentit: 0 });
  });

  it('haku "alv" also finds accounts that spell out arvonlisävero', async () => {
    // Real charts name the VAT liability "Arvonlisäverovelka" while other accounts say "ALV";
    // models search "alv" and must not miss the account that actually holds the balance.
    const client = new InProcessClient(
      createMemoryStorage({
        tilit: [
          { numero: 2920, tyyppi: 'BV', nimi: { fi: 'Verovelka ALV SUORITUKSET' } },
          { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
        ],
        tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
        asetukset: { Nimi: 'Testi Oy', AlvVelvollinen: 'true' },
      }),
      () => env.aika,
    );
    const tulos = (await saldot.suorita(client, { pvm: '2026-12-31', haku: 'alv' }, env)) as {
      saldot: { tili: number }[];
    };
    expect(tulos.saldot.map((s) => s.tili)).toEqual([2920, 2939]);
    // Finnish compounds get hyphenated or split by the model ("alv-velka", "alv velka").
    for (const haku of ['alv-velka', 'alv velka', 'arvonlisäverovelka']) {
      const osuma = (await saldot.suorita(client, { pvm: '2026-12-31', haku }, env)) as {
        saldot: { tili: number }[];
      };
      expect(osuma.saldot.map((s) => s.tili)).toEqual([2939]);
    }
  });

  it('haku also matches an account-number prefix', async () => {
    const tulos = (await saldot.suorita(
      (
        await luoTestikirja()
      ).client,
      { pvm: '2026-12-31', haku: '19' },
      env,
    )) as { saldot: { tili: number }[] };
    expect(tulos.saldot.map((s) => s.tili)).toEqual([1900]);
  });

  it('returns an explicit 0-row for a requested account with no postings', async () => {
    const tulos = (await saldot.suorita(
      (
        await luoTestikirja()
      ).client,
      { pvm: '2026-12-31', tilit: [4000] },
      env,
    )) as { saldot: { tili: number; sentit: number; eur: string }[] };
    expect(tulos.saldot).toHaveLength(1);
    expect(tulos.saldot[0]?.tili).toBe(4000);
    expect(tulos.saldot[0]?.sentit).toBe(0);
  });

  it('sorts rows by tili ascending', async () => {
    const tulos = (await saldot.suorita(
      (
        await luoTestikirja()
      ).client,
      { pvm: '2026-12-31' },
      env,
    )) as { saldot: { tili: number }[] };
    const numerot = tulos.saldot.map((s) => s.tili);
    expect(numerot).toEqual([...numerot].sort((a, b) => a - b));
  });

  it('rejects a malformed pvm via zod', async () => {
    await expect(
      saldot.suorita((await luoTestikirja()).client, { pvm: '31.12.2026' }, env),
    ).rejects.toThrow();
  });

  it('does not let a heading sharing the numero override the leaf account name', async () => {
    // Chart rows are keyed by (numero, taso), so a heading and a leaf can share a numero
    // (InitBundle.tilit is the flat raw array of both). The name map must skip headings.
    const storage = createMemoryStorage({
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
        { numero: 1900, tyyppi: 'H1', nimi: { fi: 'Vastaavaa' } },
        { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { Nimi: 'Testi Oy', AlvVelvollinen: 'true' },
    });
    const client = new InProcessClient(storage, () => env.aika);
    await client.luoTosite({
      pvm: '2026-02-01',
      tyyppi: TositeTyyppi.TULO,
      sarja: '',
      viennit: [
        {
          tili: 1900,
          debet: c(500),
          kredit: c(0),
          pvm: '2026-02-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 3000,
          debet: c(0),
          kredit: c(500),
          pvm: '2026-02-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
    const tulos = (await saldot.suorita(client, { pvm: '2026-12-31' }, env)) as {
      saldot: { tili: number; nimi: string }[];
    };
    expect(tulos.saldot.find((s) => s.tili === 1900)?.nimi).toBe('Pankkitili');
  });
});
