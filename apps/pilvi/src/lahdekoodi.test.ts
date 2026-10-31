import { SELF, env } from 'cloudflare:test';
import { LAHDEKOODI_URL } from '@penni/contract';
import { describe, expect, it } from 'vitest';
import worker from './index.js';
import { POHJA } from './test/apu.js';

describe('pilvi-Worker: GET /lahdekoodi — AGPL §13 -lähdekoodin tarjous', () => {
  it('vastaa ilman kirjautumista tekstinä lisenssillä ja lähdekoodin osoitteella', async () => {
    const vastaus = await SELF.fetch(`${POHJA}/lahdekoodi`);
    expect(vastaus.status).toBe(200);
    expect(vastaus.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const teksti = await vastaus.text();
    expect(teksti).toContain('AGPL-3.0-or-later');
    expect(teksti).toContain(`Tämän palvelun lähdekoodi: ${LAHDEKOODI_URL}`);
  });

  it('osoittaa LAHDEKOODI_URL-muuttujan antamaan lähdekoodiin', async () => {
    const vastaus = await worker.fetch(new Request(`${POHJA}/lahdekoodi`), {
      ...env,
      LAHDEKOODI_URL: 'https://git.example.fi/oma-penni',
    });
    expect(await vastaus.text()).toContain(
      'Tämän palvelun lähdekoodi: https://git.example.fi/oma-penni',
    );
  });
});
