import { luoPalvelin } from '@penni/server';
import { createMemoryStorage } from '@penni/storage-memory';
import { HttpClient } from './HttpClient.js';
import { type ClientConformanceSeed, runClientConformance } from './conformance.js';
import { injectFetcher } from './test/injectFetcher.js';

runClientConformance('HttpClient', (seed: ClientConformanceSeed) => {
  const storage = createMemoryStorage({
    tilit: seed.tilit,
    tilikaudet: seed.tilikaudet,
    asetukset: seed.asetukset,
  });
  const app = luoPalvelin(storage, { kello: () => '2026-06-01T00:00:00.000Z' });
  return new HttpClient({ baseUrl: 'http://kp.local', api: injectFetcher(app) });
});
