import { bytesToBase64 } from '@penni/contract';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { luoPalvelin } from './palvelin.js';

const seed = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Oy Esimerkki' },
};

const tosite = {
  pvm: '2026-03-01',
  tyyppi: 0,
  sarja: '',
  viennit: [
    { tili: 1900, debet: '100.00', pvm: '2026-03-01' },
    { tili: 3000, kredit: '100.00', pvm: '2026-03-01' },
  ],
};

const app = () =>
  luoPalvelin(createMemoryStorage(seed), { kello: () => '2026-06-01T00:00:00.000Z' });

describe('liite HTTP:n yli', () => {
  it('POST luo liitteen (200, ei dataa), GET listaa + hakee blobin tavulleen, DELETE poistaa', async () => {
    const a = app();
    const tositeId = (await a.inject({ method: 'POST', url: '/tositteet', payload: tosite })).json()
      .id as number;

    const data = bytesToBase64(new Uint8Array([0x00, 0xff, 0x10]));
    const post = await a.inject({
      method: 'POST',
      url: '/liitteet',
      payload: {
        tosite: tositeId,
        nimi: 'kuitti.pdf',
        tyyppi: 'application/pdf',
        luotu: '2026-06-01T00:00:00.000Z',
        data,
      },
    });
    expect(post.statusCode).toBe(200);
    const luotu = post.json() as { id: number; data?: unknown };
    expect(luotu.id).toBeGreaterThan(0);
    expect(luotu.data).toBeUndefined(); // vastaus on vain metatiedot

    const lista = await a.inject({ method: 'GET', url: `/tositteet/${tositeId}/liitteet` });
    expect(lista.statusCode).toBe(200);
    expect(lista.json()).toHaveLength(1);

    const blob = await a.inject({ method: 'GET', url: `/liitteet/${luotu.id}` });
    expect(blob.statusCode).toBe(200);
    expect((blob.json() as { data: string }).data).toBe(data); // sama base64 takaisin

    expect((await a.inject({ method: 'DELETE', url: `/liitteet/${luotu.id}` })).statusCode).toBe(
      200,
    );
    expect(
      (await a.inject({ method: 'GET', url: `/tositteet/${tositeId}/liitteet` })).json(),
    ).toHaveLength(0);
    await a.close();
  });

  it('GET /liitteet/9999 palauttaa 404 puuttuvalle liitteelle', async () => {
    const a = app();
    expect((await a.inject({ method: 'GET', url: '/liitteet/9999' })).statusCode).toBe(404);
    await a.close();
  });
});
