import { HttpClient } from '../../web/src/client/HttpClient.js';
import { runClientConformance } from '../../web/src/client/conformance.js';
import { POHJA, selfFetcher, uusiKayttaja, uusiKirja } from './test/apu.js';

// Sama jaettu asiakas-conformance kuin InProcessClientille ja Fastify-palvelimelle, nyt koko
// pilviketjun läpi: HttpClient → Worker (5a-tunnistus + jäsenyys Control DO:ssa) → ts-rest
// fetch-reititin → Book DO:n RPC → moottori DO:n SQLitessä. Jokainen tapaus saa oman käyttäjän
// ja kirjan.
runClientConformance('HttpClient → pilvi-Worker → KirjaDO', async (seed) => {
  const { token } = await uusiKayttaja();
  const kirjaId = await uusiKirja(token, seed);
  return new HttpClient({
    baseUrl: `${POHJA}/api/kirjat/${kirjaId}`,
    baseHeaders: { authorization: `Bearer ${token}` },
    api: selfFetcher,
  });
});
