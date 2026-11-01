import { HttpClient } from '../../web/src/client/HttpClient.js';
import {
  type ClientConformanceSeed,
  runClientConformance,
} from '../../web/src/client/conformance.js';
import { runKohdennusClientConformance } from '../../web/src/client/conformanceKohdennukset.js';
import { POHJA, selfFetcher, uusiKayttaja, uusiKirja } from './test/apu.js';

// Sama jaettu asiakas-conformance kuin InProcessClientille ja Fastify-palvelimelle, nyt koko
// pilviketjun läpi: HttpClient → Worker (5a-tunnistus + jäsenyys Control DO:ssa) → ts-rest
// fetch-reititin → Book DO:n RPC → moottori DO:n SQLitessä. Jokainen tapaus saa oman käyttäjän
// ja kirjan.
const luoAsiakas = async (seed: ClientConformanceSeed) => {
  const { token } = await uusiKayttaja();
  const kirjaId = await uusiKirja(token, seed);
  return new HttpClient({
    baseUrl: `${POHJA}/api/kirjat/${kirjaId}`,
    baseHeaders: { authorization: `Bearer ${token}` },
    api: selfFetcher,
  });
};

runClientConformance('HttpClient → pilvi-Worker → KirjaDO', luoAsiakas);
runKohdennusClientConformance('HttpClient → pilvi-Worker → KirjaDO', luoAsiakas);
