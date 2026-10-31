import { createPostgresStorage, luoPglite } from '@penni/storage-postgres';
import { describe, expect, it } from 'vitest';
import { luoPalvelin } from './palvelin.js';

describe('e2e over HTTP on storage-postgres (PGlite)', () => {
  it('posts a voucher and reads saldot back through the full stack', async () => {
    const storage = await createPostgresStorage(await luoPglite(), {
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
        { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: {},
    });
    const app = luoPalvelin(storage, { kello: () => '2026-06-01T00:00:00.000Z' });

    const post = await app.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          { tili: 1900, debet: '250.00', pvm: '2026-03-01' },
          { tili: 3000, kredit: '250.00', pvm: '2026-03-01' },
        ],
      },
    });
    expect(post.statusCode).toBe(201);
    expect((post.json() as { tunniste: number }).tunniste).toBe(1);

    const saldot = (
      await app.inject({ method: 'GET', url: '/saldot?pvm=2026-12-31' })
    ).json() as Record<string, string>;
    expect(saldot['1900']).toBe('250.00');

    await app.close();
    await storage.close();
  });
});
