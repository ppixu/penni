import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import {
  haeAsetukset,
  haeInit,
  paivitaAsetukset,
  paivitaInit,
  poistaTili,
  putTili,
  putTilikausi,
} from './masterData.js';

const seed = {
  tilit: [{ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } }],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Oy' },
};

describe('master-data handlers', () => {
  it('haeInit returns the bundle', async () => {
    const s = createMemoryStorage(seed);
    const init = await haeInit(s);
    expect(init.asetukset.Nimi).toBe('Oy');
    expect(init.tilit).toHaveLength(1);
  });

  it('putTili upserts and is protected from paivitaInit', async () => {
    const s = createMemoryStorage(seed);
    await putTili(s, 1900, { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Oma pankki' } });
    await paivitaInit(s, { tilit: [{ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Malli' } }] });
    const init = await haeInit(s);
    expect(
      init.tilit.find((t) => Number((t as { numero: number }).numero) === 1900)?.nimi,
    ).toMatchObject({ fi: 'Oma pankki' });
  });

  it('paivitaAsetukset + haeAsetukset round-trip', async () => {
    const s = createMemoryStorage(seed);
    await paivitaAsetukset(s, { Maa: 'FI' });
    expect((await haeAsetukset(s)).Maa).toBe('FI');
  });

  it('putTilikausi adds a fiscal year; poistaTili removes an account', async () => {
    const s = createMemoryStorage(seed);
    await putTilikausi(s, '2027-01-01', { alkaa: '2027-01-01', loppuu: '2027-12-31' });
    expect((await haeInit(s)).tilikaudet).toHaveLength(2);
    await poistaTili(s, 1900);
    expect((await haeInit(s)).tilit).toHaveLength(0);
  });
});
