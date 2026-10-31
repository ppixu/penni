import { InProcessClient } from '@penni/asiakas';
import { createMemoryStorage } from '@penni/storage-memory';
import { type ClientConformanceSeed, runClientConformance } from './conformance.js';

runClientConformance('InProcessClient', (seed: ClientConformanceSeed) => {
  const storage = createMemoryStorage({
    tilit: seed.tilit,
    tilikaudet: seed.tilikaudet,
    asetukset: seed.asetukset,
  });
  // Deterministic clock so audit timestamps are stable across runs.
  return new InProcessClient(storage, () => '2026-06-01T00:00:00.000Z');
});
