import { injectFetcher } from '@/client/test/injectFetcher';
import { luoMuistiControlStore } from '@penni/control';
import { luoPalvelin } from '@penni/server';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { luoAuthClient } from './authClient.js';

function client(token?: string) {
  const app = luoPalvelin(createMemoryStorage(), {
    control: luoMuistiControlStore(),
    kello: () => '2026-06-01T00:00:00.000Z',
  });
  return luoAuthClient({
    baseUrl: 'http://kp.local',
    api: injectFetcher(app),
    ...(token ? { token } : {}),
  });
}

describe('authClient', () => {
  it('rekisteröinti palauttaa käyttäjän + tokenin', async () => {
    const c = client();
    const { kayttaja, token } = await c.rekisteroi({ email: 'a@b.fi', salasana: 'salasana1' });
    expect(kayttaja.email).toBe('a@b.fi');
    expect(token).toBeTruthy();
  });

  it('duplikaatti heittää suomenkielisen virheen', async () => {
    const c = client(); // yksi client = yksi app = yksi control-instanssi
    await c.rekisteroi({ email: 'a@b.fi', salasana: 'salasana1' });
    await expect(c.rekisteroi({ email: 'a@b.fi', salasana: 'salasana1' })).rejects.toThrow(
      'Sähköposti on jo käytössä',
    );
  });
});
