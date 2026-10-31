import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InProcessClient } from '@penni/asiakas';
import { yritysAsetukset, yritysRaportit, yritysTilit } from '@penni/charts';
import type { Cents } from '@penni/engine';
import { TositeTyyppi } from '@penni/engine';
import { createSqliteStorage } from '@penni/storage-sqlite';

const c = (n: number): Cents => n as Cents;

/** Build a temp .penni SQLite book seeded from the yritys chart, mirroring
 * apps/web/src/client/luoSiemen.ts (fold asetukset + report layouts to strings/JSON). */
export function luoTestikirja(): string {
  const asetukset: Record<string, string> = {};
  for (const [avain, arvo] of Object.entries(yritysAsetukset))
    asetukset[avain] = typeof arvo === 'string' ? arvo : JSON.stringify(arvo);
  for (const [avain, maaritys] of Object.entries(yritysRaportit))
    asetukset[avain] = JSON.stringify(maaritys);
  asetukset.Nimi = 'Testi Oy';
  asetukset.AlvVelvollinen = 'true';

  const polku = join(mkdtempSync(join(tmpdir(), 'penni-cli-')), 'testi.penni');
  const storage = createSqliteStorage(
    {
      tilit: yritysTilit as never,
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset,
    },
    { tiedosto: polku },
  );
  storage.close();
  return polku;
}

/** Seed a couple of vouchers into an existing fixture book through the normal client path.
 * Accounts 1910 (Pankkitili 1), 3000 (Myynti) and 4000 (Ostot) all exist in the yritys chart
 * (charts/yritys/tilit.json). TositeTyyppi has no MYYNTI constant — TULO (200) is the sale
 * type, matching packages/tyokalut/src/testi/kirja.ts. */
export async function siemennaTositteet(polku: string): Promise<void> {
  const storage = createSqliteStorage({}, { tiedosto: polku });
  try {
    const client = new InProcessClient(storage, () => '2026-08-15T12:00:00.000Z');
    // finalized sale 100,00 € on 2026-02-01
    const myynti = await client.luoTosite({
      pvm: '2026-02-01',
      tyyppi: TositeTyyppi.TULO,
      sarja: '',
      otsikko: 'Konsultointi',
      viennit: [
        {
          tili: 1910,
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
    });
    await client.muutaTila(myynti.id, 100);
    // draft purchase 25,50 € on 2026-03-05
    await client.luoTosite({
      pvm: '2026-03-05',
      tyyppi: TositeTyyppi.MENO,
      sarja: '',
      otsikko: 'Puhelinlasku',
      tila: 50,
      viennit: [
        {
          tili: 4000,
          debet: c(2550),
          kredit: c(0),
          pvm: '2026-03-05',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 1910,
          debet: c(0),
          kredit: c(2550),
          pvm: '2026-03-05',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
  } finally {
    storage.close();
  }
}
