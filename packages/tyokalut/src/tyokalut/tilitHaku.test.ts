import { InProcessClient } from '@penni/asiakas';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { tilitHaku } from './tilitHaku.js';

const seed = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Testi Oy', AlvVelvollinen: 'true' },
};
const env = { aika: '2026-08-15T12:00:00.000Z' };
const client = () => new InProcessClient(createMemoryStorage(seed));

describe('tilitHaku', () => {
  it('finds accounts by name substring, case-insensitive', async () => {
    const tulos = (await tilitHaku.suorita(client(), { haku: 'pankki' }, env)) as {
      tilit: unknown[];
      lukumaara: number;
    };
    expect(tulos.tilit).toEqual([{ numero: 1900, nimi: 'Pankkitili', tyyppi: 'ARP' }]);
    expect(tulos.lukumaara).toBe(1);
  });
  it('finds accounts by number prefix', async () => {
    const tulos = (await tilitHaku.suorita(client(), { haku: '19' }, env)) as {
      tilit: unknown[];
    };
    expect(tulos.tilit).toEqual([{ numero: 1900, nimi: 'Pankkitili', tyyppi: 'ARP' }]);
  });
  it('treats "alv" and "arvonlisävero" as the same word in account names', async () => {
    const alvKirja = () =>
      new InProcessClient(
        createMemoryStorage({
          ...seed,
          tilit: [
            ...seed.tilit,
            { numero: 2920, tyyppi: 'BV', nimi: { fi: 'Verovelka ALV SUORITUKSET' } },
            { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
          ],
        }),
      );
    const alv = (await tilitHaku.suorita(alvKirja(), { haku: 'alv' }, env)) as {
      tilit: { numero: number }[];
    };
    expect(alv.tilit.map((t) => t.numero)).toEqual([2920, 2939]);
    const auki = (await tilitHaku.suorita(alvKirja(), { haku: 'arvonlisävero' }, env)) as {
      tilit: { numero: number }[];
    };
    expect(auki.tilit.map((t) => t.numero)).toEqual([2920, 2939]);
  });
  it('rejects garbage input via zod', async () => {
    await expect(tilitHaku.suorita(client(), { haku: 42 }, env)).rejects.toThrow();
  });
});
