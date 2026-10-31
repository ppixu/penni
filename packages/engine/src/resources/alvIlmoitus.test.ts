import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { haeAlvIlmoitus } from './alvIlmoitus.js';
import { tallennaTosite } from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-06-01T00:00:00.000Z' };

const seed = (asetukset: Record<string, string> = { AlvVelvollinen: 'true' }) =>
  createMemoryStorage({
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset,
  });

/** Kotimaan nettomyynti: pankki debet brutto, myynti kredit netto (11), alv-velka kredit vero (111). */
const myynti = (pvm: string, netto: number, vero: number) => ({
  pvm,
  tyyppi: 0,
  sarja: '',
  viennit: [
    { tili: 1900, debet: c(netto + vero), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
    { tili: 3000, debet: c(0), kredit: c(netto), pvm, alvKoodi: 11, alvProsentti: 25.5 },
    { tili: 2939, debet: c(0), kredit: c(vero), pvm, alvKoodi: 111, alvProsentti: 25.5 },
  ],
});

describe('haeAlvIlmoitus', () => {
  it('paketoi haeAlvLaskelman koodit ja laskee kausityypin (kuukausi)', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    const i = await haeAlvIlmoitus(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
    expect(i.koodit.get(301)).toBe(2550);
    expect(i.maksettava).toBe(2550);
    expect(i.kausityyppi).toBe('K');
    expect(i.nolla).toBe(false);
    expect(i.maksuperusteinen).toBe(false);
  });

  it('tunnistaa neljännes- ja vuosikauden', async () => {
    const s = seed();
    const q = await haeAlvIlmoitus(s, { alkupvm: '2026-04-01', loppupvm: '2026-06-30' });
    expect(q.kausityyppi).toBe('Q');
    const v = await haeAlvIlmoitus(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-31' });
    expect(v.kausityyppi).toBe('V');
  });

  it('merkitsee nollailmoituksen kun kaudella ei ole koodeja', async () => {
    const s = seed();
    const i = await haeAlvIlmoitus(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
    expect(i.nolla).toBe(true);
    expect(i.koodit.size).toBe(0);
    expect(i.maksettava).toBe(0);
  });

  it('heijastaa maksuperusteisuuden asetuksesta', async () => {
    const s = seed({ AlvVelvollinen: 'true', Maksuperusteinen: 'true' });
    const i = await haeAlvIlmoitus(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
    expect(i.maksuperusteinen).toBe(true);
  });

  it("tunnistaa Kitsasista tuodun 'ON'-totuusarvon", async () => {
    const s = seed({ AlvVelvollinen: 'ON', Maksuperusteinen: 'ON' });
    const i = await haeAlvIlmoitus(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
    expect(i.maksuperusteinen).toBe(true);
  });
});
