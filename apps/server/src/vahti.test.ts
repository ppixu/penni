import type { ControlStore } from '@penni/control';
import { luoMuistiControlStore } from '@penni/control';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { luoPalvelin } from './palvelin.js';

// Sama kelvollinen siemen + tosite kuin palvelin.test.ts:ssä (tilit ARP/CL, avoin tilikausi).
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

function luo() {
  const storage = createMemoryStorage(seed);
  const app = luoPalvelin(storage, {
    control: luoMuistiControlStore(),
    vaadiTunnistus: true,
    kello: () => '2026-06-01T00:00:00.000Z',
  });
  return { storage, app };
}

describe('auth-vahti', () => {
  it('moottorireitti ilman tokenia → 401', async () => {
    const { app } = luo();
    const r = await app.inject({ method: 'GET', url: '/init' });
    expect(r.statusCode).toBe(401);
    expect((r.json() as { koodi: string }).koodi).toBe('EI_SESSIOTA');
  });

  it('auth-reitit ovat julkisia myös vahdin ollessa päällä', async () => {
    const { app } = luo();
    const reg = await app.inject({
      method: 'POST',
      url: '/register',
      payload: { email: 'a@b.fi', salasana: 'salasana1' },
    });
    expect(reg.statusCode).toBe(201);
  });

  it('tokenilla luotu tosite kantaa userId:n tarkastuslokiin', async () => {
    const { storage, app } = luo();
    const reg = await app.inject({
      method: 'POST',
      url: '/register',
      payload: { email: 'a@b.fi', salasana: 'salasana1' },
    });
    const { token, kayttaja } = reg.json() as { token: string; kayttaja: { id: number } };
    const auth = { authorization: `bearer ${token}` };
    const luotu = await app.inject({
      method: 'POST',
      url: '/tositteet',
      payload: tosite,
      headers: auth,
    });
    expect([200, 201]).toContain(luotu.statusCode);
    const id = (luotu.json() as { id: number }).id;
    // Audit-loki EI ole wire-Tositteessa eikä omaa HTTP-päätepistettä → luetaan storage-viitteestä.
    const loki = await storage.getLoki(id);
    expect(loki.some((e) => e.userId === kayttaja.id)).toBe(true);
  });

  it('vaadiTunnistus ilman control-varastoa → virhe palvelimen luonnissa', () => {
    expect(() => luoPalvelin(createMemoryStorage(), { vaadiTunnistus: true })).toThrow();
  });

  it('kontrollivaraston virhe haeSessio:ssa → 500 (ei väärä "istunto vanhentunut")', async () => {
    const control: ControlStore = {
      ...luoMuistiControlStore(),
      haeSessio: () => Promise.reject(new Error('tietokantavirhe')),
    };
    const storage = createMemoryStorage(seed);
    const app = luoPalvelin(storage, {
      control,
      vaadiTunnistus: true,
      kello: () => '2026-06-01T00:00:00.000Z',
    });
    const r = await app.inject({
      method: 'GET',
      url: '/init',
      headers: { authorization: 'bearer joku-token' },
    });
    expect(r.statusCode).toBe(500);
  });

  it('auth-reitit pysyvät julkisina kun apiEtuliite on myös käytössä', async () => {
    // Regressio: authPolut rakennettiin sopimuksen etuliitteettömistä poluista, jolloin esim.
    // '/login' ei koskaan täsmännyt pyynnön oikeaan polkuun '/api/login' — kirjautuminenkin
    // olisi näyttäytynyt suojattuna reittinä ja vaatinut tokenin, jota ei voi vielä olla olemassa.
    const app = luoPalvelin(createMemoryStorage(seed), {
      control: luoMuistiControlStore(),
      vaadiTunnistus: true,
      apiEtuliite: '/api',
      kello: () => '2026-06-01T00:00:00.000Z',
    });
    const reg = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { email: 'a@b.fi', salasana: 'salasana1' },
    });
    expect(reg.statusCode).toBe(201);

    const kirjautuminen = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { email: 'a@b.fi', salasana: 'salasana1' },
    });
    expect(kirjautuminen.statusCode).toBe(200);

    const suojattu = await app.inject({ method: 'GET', url: '/api/init' });
    expect(suojattu.statusCode).toBe(401);
    expect((suojattu.json() as { koodi: string }).koodi).toBe('EI_SESSIOTA');
  });

  it('etuliitteen perässä oleva kauttaviiva ei riko auth-polkujen tunnistusta', async () => {
    // Regressio: authPolut rakensi polun raa'alla merkkijonokatenaatiolla (etuliite + polku).
    // Fastify normalisoi itse { prefix: '/api/' } + '/register' -> '/api/register', mutta
    // '/api/' + '/register' (katenaatio) = '/api//register', joka ei koskaan täsmää.
    const app = luoPalvelin(createMemoryStorage(seed), {
      control: luoMuistiControlStore(),
      vaadiTunnistus: true,
      apiEtuliite: '/api/',
      kello: () => '2026-06-01T00:00:00.000Z',
    });
    const reg = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { email: 'a@b.fi', salasana: 'salasana1' },
    });
    expect(reg.statusCode).toBe(201);

    const suojattu = await app.inject({ method: 'GET', url: '/api/init' });
    expect(suojattu.statusCode).toBe(401);
    expect((suojattu.json() as { koodi: string }).koodi).toBe('EI_SESSIOTA');
  });
});
