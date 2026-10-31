import { InProcessClient } from '@penni/asiakas';
import type { Storage, TositeSyote } from '@penni/engine';
import { TositeTyyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { createMemoryStorage } from '@penni/storage-memory';

export const c = (n: number): Cents => n as Cents;
export const env = { aika: '2026-08-15T12:00:00.000Z' };

/** Memory-backed test book. Returns storage too so tests can read loki. */
export async function luoTestikirja(
  lahde?: string,
): Promise<{ client: InProcessClient; storage: Storage }> {
  const storage = createMemoryStorage({
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { Nimi: 'Testi Oy', AlvVelvollinen: 'true' },
  });
  const client = new InProcessClient(storage, () => env.aika, lahde);
  // finalized sale 100,00 € on 2026-02-01
  const myyntiSyote: TositeSyote = {
    pvm: '2026-02-01',
    tyyppi: TositeTyyppi.TULO,
    sarja: '',
    otsikko: 'Konsultointi',
    viennit: [
      {
        tili: 1900,
        debet: c(10000),
        kredit: c(0),
        pvm: '2026-02-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: 3000,
        debet: c(0),
        kredit: c(10000),
        pvm: '2026-02-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ],
  };
  const myynti = await client.luoTosite(myyntiSyote);
  await client.muutaTila(myynti.id, 100);
  // draft purchase 25,50 € on 2026-03-05
  const ostoSyote: TositeSyote = {
    pvm: '2026-03-05',
    tyyppi: TositeTyyppi.MENO,
    sarja: '',
    otsikko: 'Puhelinlasku',
    tila: 50,
    viennit: [
      { tili: 4000, debet: c(2550), kredit: c(0), pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
      { tili: 1900, debet: c(0), kredit: c(2550), pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
    ],
  };
  await client.luoTosite(ostoSyote);
  return { client, storage };
}
