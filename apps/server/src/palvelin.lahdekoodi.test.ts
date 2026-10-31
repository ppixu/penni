import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAHDEKOODI_URL } from '@penni/contract';
import { luoMuistiControlStore } from '@penni/control';
import { createMemoryStorage } from '@penni/storage-memory';
import { afterAll, describe, expect, it } from 'vitest';
import { luoPalvelin } from './palvelin.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-lahdekoodi-'));
writeFileSync(join(hakemisto, 'index.html'), '<!doctype html><title>Penni</title>');
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

describe('GET /lahdekoodi — AGPL §13 -lähdekoodin tarjous', () => {
  it('palauttaa tekstinä lisenssin ja lähdekoodin osoitteen', async () => {
    const app = luoPalvelin(createMemoryStorage());
    const vastaus = await app.inject({ method: 'GET', url: '/lahdekoodi' });
    expect(vastaus.statusCode).toBe(200);
    expect(vastaus.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(vastaus.body).toContain('AGPL-3.0-or-later');
    expect(vastaus.body).toContain(`Tämän palvelun lähdekoodi: ${LAHDEKOODI_URL}`);
    await app.close();
  });

  it('osoittaa ylläpitäjän antamaan lähdekoodiin', async () => {
    const app = luoPalvelin(createMemoryStorage(), {
      lahdekoodiUrl: 'https://git.example.fi/oma-penni',
    });
    const vastaus = await app.inject({ method: 'GET', url: '/lahdekoodi' });
    expect(vastaus.body).toContain('Tämän palvelun lähdekoodi: https://git.example.fi/oma-penni');
    await app.close();
  });

  it('vastaa ilman kirjautumista, vaikka moottorireitit vaativat session', async () => {
    const app = luoPalvelin(createMemoryStorage(), {
      control: luoMuistiControlStore(),
      vaadiTunnistus: true,
    });
    expect((await app.inject({ method: 'GET', url: '/init' })).statusCode).toBe(401);
    const vastaus = await app.inject({ method: 'GET', url: '/lahdekoodi' });
    expect(vastaus.statusCode).toBe(200);
    expect(vastaus.body).toContain(LAHDEKOODI_URL);
    await app.close();
  });

  it('on juuripolussa API-etuliitteen ulkopuolella eikä jää SPA-reitityksen alle', async () => {
    const app = luoPalvelin(createMemoryStorage(), {
      apiEtuliite: '/api',
      staattinenHakemisto: hakemisto,
    });
    const vastaus = await app.inject({ method: 'GET', url: '/lahdekoodi' });
    expect(vastaus.statusCode).toBe(200);
    expect(vastaus.body).toContain(LAHDEKOODI_URL);
    expect(vastaus.body).not.toContain('<!doctype html>');
    await app.close();
  });
});
