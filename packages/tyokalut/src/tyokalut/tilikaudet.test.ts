import { InProcessClient } from '@penni/asiakas';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { tilikaudet } from './tilikaudet.js';

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

describe('tilikaudet', () => {
  it('lists fiscal years with lock state', async () => {
    const tulos = (await tilikaudet.suorita(client(), {}, env)) as { tilikaudet: unknown[] };
    expect(tulos.tilikaudet).toEqual([
      { alkaa: '2026-01-01', loppuu: '2026-12-31', lukittu: false },
    ]);
  });
});
