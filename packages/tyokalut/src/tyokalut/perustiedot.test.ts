import { InProcessClient } from '@penni/asiakas';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { perustiedot } from './perustiedot.js';

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

describe('perustiedot', () => {
  it('returns company basics and the current fiscal year', async () => {
    const tulos = (await perustiedot.suorita(client(), {}, env)) as Record<string, unknown>;
    expect(tulos.nimi).toBe('Testi Oy');
    expect(tulos.alvVelvollinen).toBe(true);
    expect(tulos.pvm).toBe('2026-08-15');
    expect(tulos.tilikausi).toEqual({
      alkaa: '2026-01-01',
      loppuu: '2026-12-31',
      paiviaAlusta: 226,
    });
  });
});
