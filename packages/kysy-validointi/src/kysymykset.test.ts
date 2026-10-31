import { InProcessClient } from '@penni/asiakas';
import { type TositeSyote, TositeTila, TositeTyyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { KYSYMYKSET } from './kysymykset.js';

const c = (n: number): Cents => n as Cents;
const PVM = '2026-08-15'; // "today", inside the current (unlocked) 2026 tilikausi

/**
 * A richer memory book than the plain tyokalut test seed: covers every account nature the
 * golden set's odotus functions filter by (pankki, käteinen, myyntisaamiset, ostovelka,
 * alv-velka, osakepääoma, myynti, ostot), two tilikaudet (one locked), and vouchers across
 * every bucket (kirjanpidossa/luonnos/poistetut) with a sarja and an alv-coded line — just
 * enough to exercise every odotus function's code path without throwing.
 */
async function luoTestikirja(): Promise<InProcessClient> {
  const storage = createMemoryStorage({
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 1000, tyyppi: 'ARK', nimi: { fi: 'Käteiskassa' } },
      { numero: 1700, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset' } },
      { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
      { numero: 2001, tyyppi: 'BY', nimi: { fi: 'Osakepääoma' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    ],
    tilikaudet: [
      { alkaa: '2025-01-01', loppuu: '2025-12-31' },
      { alkaa: '2026-01-01', loppuu: '2026-12-31' },
    ],
    asetukset: { Nimi: 'Testi Oy', AlvVelvollinen: 'true', TilitPaatetty: '2025-12-31' },
  });
  const client = new InProcessClient(storage, () => `${PVM}T12:00:00.000Z`);

  const v = (
    tili: number,
    debet: number,
    kredit: number,
    pvm: string,
    alvKoodi = 0,
    alvProsentti = 0,
  ) => ({ tili, debet: c(debet), kredit: c(kredit), pvm, alvKoodi, alvProsentti });

  // Finalized sale, January 2026, sarja 'A', alv-coded 25,5 % (mirrors engine's own
  // alvLaskelma.test.ts fixture), title matches the golden set's 'konsultointi' search.
  const myynti = await client.luoTosite({
    pvm: '2026-01-15',
    tyyppi: TositeTyyppi.TULO,
    sarja: 'A',
    otsikko: 'Konsultointi tammikuu',
    viennit: [
      v(1900, 12550, 0, '2026-01-15'),
      v(3000, 0, 10000, '2026-01-15', 11, 25.5),
      v(2939, 0, 2550, '2026-01-15', 111, 25.5),
    ],
  } satisfies TositeSyote);
  await client.muutaTila(myynti.id, TositeTila.KIRJANPIDOSSA);

  // Finalized purchase, February 2026.
  const osto = await client.luoTosite({
    pvm: '2026-02-10',
    tyyppi: TositeTyyppi.MENO,
    sarja: '',
    otsikko: 'Toimistotarvikkeet',
    viennit: [v(4000, 5000, 0, '2026-02-10'), v(1900, 0, 5000, '2026-02-10')],
  } satisfies TositeSyote);
  await client.muutaTila(osto.id, TositeTila.KIRJANPIDOSSA);

  // Draft voucher — stays in the 'luonnos' bucket.
  await client.luoTosite({
    pvm: '2026-03-01',
    tyyppi: TositeTyyppi.MENO,
    sarja: '',
    otsikko: 'Luonnoslasku',
    tila: TositeTila.LUONNOS,
    viennit: [v(4000, 2000, 0, '2026-03-01'), v(1900, 0, 2000, '2026-03-01')],
  } satisfies TositeSyote);

  // Created then soft-deleted — stays in the 'poistetut' bucket.
  const poistettava = await client.luoTosite({
    pvm: '2026-03-05',
    tyyppi: TositeTyyppi.MENO,
    sarja: '',
    otsikko: 'Peruttu kirjaus',
    tila: TositeTila.LUONNOS,
    viennit: [v(4000, 100, 0, '2026-03-05'), v(1900, 0, 100, '2026-03-05')],
  } satisfies TositeSyote);
  await client.poistaTosite(poistettava.id);

  return client;
}

describe('KYSYMYKSET', () => {
  it('has unique ids', () => {
    const idt = KYSYMYKSET.map((k) => k.id);
    expect(new Set(idt).size).toBe(idt.length);
  });

  it('has 30–50 questions with at least 5 deliberately unanswerable (kieltäytyminen)', () => {
    expect(KYSYMYKSET.length).toBeGreaterThanOrEqual(30);
    expect(KYSYMYKSET.length).toBeLessThanOrEqual(50);
    const kieltaytymiset = KYSYMYKSET.filter((k) => k.odotus.tyyppi === 'kieltaytyminen');
    expect(kieltaytymiset.length).toBeGreaterThanOrEqual(5);
  });

  it('every numeric odotus function runs against a seeded book and returns an integer', async () => {
    const client = await luoTestikirja();
    for (const k of KYSYMYKSET) {
      if (k.odotus.tyyppi === 'kieltaytyminen') continue;
      const arvo = await k.odotus.arvo(client, PVM);
      expect(Number.isInteger(arvo), `${k.id} palautti ei-kokonaisluvun: ${arvo}`).toBe(true);
    }
  });
});
