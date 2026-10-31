import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStorage } from '@penni/storage-memory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { luoPalvelin } from './palvelin.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-staattinen-'));

beforeAll(() => {
  writeFileSync(join(hakemisto, 'index.html'), '<!doctype html><title>Penni</title>');
  writeFileSync(join(hakemisto, 'app.js'), 'console.log("penni");');
});
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

describe('luoPalvelin — staattinen jakelu ja api-etuliite', () => {
  it('tarjoilee sopimusreitit annetun etuliitteen alta', async () => {
    const app = luoPalvelin(createMemoryStorage(), { apiEtuliite: '/api' });
    const vastaus = await app.inject({ method: 'GET', url: '/api/init' });
    expect(vastaus.statusCode).toBe(200);
    await app.close();
  });

  it('ei tarjoile sopimusreittejä juuresta kun etuliite on annettu', async () => {
    const app = luoPalvelin(createMemoryStorage(), { apiEtuliite: '/api' });
    const vastaus = await app.inject({ method: 'GET', url: '/init' });
    expect(vastaus.statusCode).toBe(404);
    await app.close();
  });

  it('tarjoilee index.html:n juuresta kun staattinen hakemisto on annettu', async () => {
    const app = luoPalvelin(createMemoryStorage(), {
      apiEtuliite: '/api',
      staattinenHakemisto: hakemisto,
    });
    const vastaus = await app.inject({ method: 'GET', url: '/' });
    expect(vastaus.statusCode).toBe(200);
    expect(vastaus.body).toContain('<title>Penni</title>');
    await app.close();
  });

  it('tarjoilee staattiset tiedostot', async () => {
    const app = luoPalvelin(createMemoryStorage(), {
      apiEtuliite: '/api',
      staattinenHakemisto: hakemisto,
    });
    const vastaus = await app.inject({ method: 'GET', url: '/app.js' });
    expect(vastaus.statusCode).toBe(200);
    expect(vastaus.body).toContain('penni');
    await app.close();
  });

  it('palauttaa index.html:n tuntemattomasta polusta (SPA-reititys)', async () => {
    const app = luoPalvelin(createMemoryStorage(), {
      apiEtuliite: '/api',
      staattinenHakemisto: hakemisto,
    });
    const vastaus = await app.inject({ method: 'GET', url: '/tositteet/uusi' });
    expect(vastaus.statusCode).toBe(200);
    expect(vastaus.body).toContain('<title>Penni</title>');
    await app.close();
  });

  it('ei palauta index.html:ää tuntemattomasta api-polusta', async () => {
    const app = luoPalvelin(createMemoryStorage(), {
      apiEtuliite: '/api',
      staattinenHakemisto: hakemisto,
    });
    const vastaus = await app.inject({ method: 'GET', url: '/api/ei-ole' });
    expect(vastaus.statusCode).toBe(404);
    expect(vastaus.body).not.toContain('<title>Penni</title>');
    await app.close();
  });

  it('toimii ennallaan ilman uusia valintoja', async () => {
    const app = luoPalvelin(createMemoryStorage());
    const vastaus = await app.inject({ method: 'GET', url: '/init' });
    expect(vastaus.statusCode).toBe(200);
    await app.close();
  });

  it('api-etuliiteraja on segmenttikohtainen, ei raakamerkkijonon alkuvertailu', async () => {
    // Regressio: startsWith(etuliite) täsmäisi myös polkuun, joka vain ALKAA etuliitteen
    // kirjaimilla (esim. '/apifoo' etuliitteelle '/api'), jolloin SPA-varmistus jäisi väliin.
    const app = luoPalvelin(createMemoryStorage(), {
      apiEtuliite: '/api',
      staattinenHakemisto: hakemisto,
    });
    const muunNiminenPolku = await app.inject({ method: 'GET', url: '/apifoo' });
    expect(muunNiminenPolku.statusCode).toBe(200);
    expect(muunNiminenPolku.body).toContain('<title>Penni</title>');

    const paljasEtuliite = await app.inject({ method: 'GET', url: '/api' });
    expect(paljasEtuliite.statusCode).toBe(404);
    expect(paljasEtuliite.body).not.toContain('<title>Penni</title>');

    await app.close();
  });

  it('staattinenHakemisto ilman apiEtuliitettä → virhe palvelimen luonnissa', () => {
    // Ilman etuliitettä ei voida erottaa tuntemattomia api-polkuja muista tuntemattomista
    // poluista, joten staattinen jakelu palauttaisi index.html:n myös niille.
    expect(() => luoPalvelin(createMemoryStorage(), { staattinenHakemisto: hakemisto })).toThrow();
  });

  it('etuliitteen perässä oleva kauttaviiva ei riko api/staattinen-rajaa', async () => {
    // Regressio: notFoundHandlerin raja rakensi `${etuliite}/`:n normalisoimattomasta
    // etuliitteestä. '/api/' + '/' (template-literaatti) = '/api//', joka ei koskaan täsmää
    // oikeaan polkuun '/api/ei-ole'.
    const app = luoPalvelin(createMemoryStorage(), {
      apiEtuliite: '/api/',
      staattinenHakemisto: hakemisto,
    });
    const tuntematonApiPolku = await app.inject({ method: 'GET', url: '/api/ei-ole' });
    expect(tuntematonApiPolku.statusCode).toBe(404);
    expect(tuntematonApiPolku.body).not.toContain('<title>Penni</title>');

    const muunNiminenPolku = await app.inject({ method: 'GET', url: '/apifoo' });
    expect(muunNiminenPolku.statusCode).toBe(200);
    expect(muunNiminenPolku.body).toContain('<title>Penni</title>');

    await app.close();
  });

  it('pelkkä "/" apiEtuliitteenä → virhe palvelimen luonnissa', () => {
    // "/" normalisoituisi tyhjäksi merkkijonoksi, joka poistaisi hiljaisesti koko etuliitteen
    // suojan (mm. staattinenHakemisto-vaatimuksen takaa) — hylätään siis eksplisiittisesti.
    expect(() => luoPalvelin(createMemoryStorage(), { apiEtuliite: '/' })).toThrow();
  });
});
