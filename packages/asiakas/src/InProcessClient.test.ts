import type { TositeSyote } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { InProcessClient } from './InProcessClient.js';

const c = (n: number): Cents => n as Cents;

const seed = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Testi Oy' },
};

describe('InProcessClient (@penni/asiakas)', () => {
  it('serves master data from the given storage', async () => {
    const client = new InProcessClient(createMemoryStorage(seed));
    const kaudet = await client.haeTilikaudet();
    expect(kaudet).toHaveLength(1);
    const asetukset = await client.haeAsetukset();
    expect(asetukset.Nimi).toBe('Testi Oy');
  });

  it('stamps writes with the client-level lahde', async () => {
    const storage = createMemoryStorage(seed);
    const client = new InProcessClient(storage, () => '2026-03-10T10:00:00.000Z', 'agentti:testi');
    const syote: TositeSyote = {
      pvm: '2026-03-10',
      tyyppi: 100,
      sarja: '',
      viennit: [
        {
          tili: 1900,
          debet: c(0),
          kredit: c(1000),
          pvm: '2026-03-10',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 4000,
          debet: c(1000),
          kredit: c(0),
          pvm: '2026-03-10',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    };
    const t = await client.luoTosite(syote);
    const loki = await storage.getLoki(t.id);
    expect(loki.at(-1)?.lahde).toBe('agentti:testi');
  });
});
