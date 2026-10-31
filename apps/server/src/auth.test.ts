import { luoMuistiControlStore } from '@penni/control';
import { createMemoryStorage } from '@penni/storage-memory';
import { beforeEach, describe, expect, it } from 'vitest';
import { luoPalvelin } from './palvelin.js';

function palvelin() {
  return luoPalvelin(createMemoryStorage(), {
    control: luoMuistiControlStore(),
    kello: () => '2026-06-01T00:00:00.000Z',
  });
}

describe('auth-reitit', () => {
  let app: ReturnType<typeof palvelin>;
  beforeEach(() => {
    app = palvelin();
  });

  async function rekisteroi(email = 'a@b.fi', salasana = 'salasana1') {
    return app.inject({ method: 'POST', url: '/register', payload: { email, salasana } });
  }

  it('rekisteröinti palauttaa 201 + tokenin, ja /me toimii tokenilla', async () => {
    const reg = await rekisteroi();
    expect(reg.statusCode).toBe(201);
    const { token, kayttaja } = JSON.parse(reg.body);
    expect(kayttaja.email).toBe('a@b.fi');
    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body).kayttaja.email).toBe('a@b.fi');
  });

  it('/me ilman tokenia → 401', async () => {
    const me = await app.inject({ method: 'GET', url: '/me' });
    expect(me.statusCode).toBe(401);
    expect(JSON.parse(me.body).koodi).toBe('EI_SESSIOTA');
  });

  it('duplikaattisähköposti → 409', async () => {
    await rekisteroi();
    const uusi = await rekisteroi();
    expect(uusi.statusCode).toBe(409);
    expect(JSON.parse(uusi.body).koodi).toBe('EMAIL_VARATTU');
  });

  it('väärät tunnukset → 401 (sama tuntemattomalle ja väärälle salasanalle)', async () => {
    await rekisteroi();
    const a = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'a@b.fi', salasana: 'vaara' },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'ei@ole.fi', salasana: 'salasana1' },
    });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(JSON.parse(a.body).koodi).toBe('VAARA_TUNNUS');
  });

  it('uloskirjautuminen mitätöi session', async () => {
    const reg = await rekisteroi();
    const { token } = JSON.parse(reg.body);
    const out = await app.inject({
      method: 'POST',
      url: '/logout',
      payload: {},
      headers: { authorization: `bearer ${token}` },
    });
    expect(out.statusCode).toBe(200);
    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `bearer ${token}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it('salasananvaihto: vanha lakkaa toimimasta, uusi toimii', async () => {
    const reg = await rekisteroi();
    const { token } = JSON.parse(reg.body);
    const vaihto = await app.inject({
      method: 'POST',
      url: '/vaihda-salasana',
      payload: { vanhaSalasana: 'salasana1', uusiSalasana: 'uusisala1' },
      headers: { authorization: `bearer ${token}` },
    });
    expect(vaihto.statusCode).toBe(200);
    const vanha = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'a@b.fi', salasana: 'salasana1' },
    });
    const uusi = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'a@b.fi', salasana: 'uusisala1' },
    });
    expect(vanha.statusCode).toBe(401);
    expect(uusi.statusCode).toBe(200);
  });
});
