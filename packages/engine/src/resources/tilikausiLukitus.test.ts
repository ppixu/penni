import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { avaaTilikausi, paataTilikausi } from './tilikausiLukitus.js';

const seed = () =>
  createMemoryStorage({
    tilit: [{ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } }],
    tilikaudet: [
      { alkaa: '2025-01-01', loppuu: '2025-12-31' },
      { alkaa: '2026-01-01', loppuu: '2026-12-31' },
    ],
    asetukset: {},
  });

describe('paataTilikausi', () => {
  it('lukitsee kauden loppuun asti (TilitPaatetty = loppuu)', async () => {
    const s = seed();
    await paataTilikausi(s, '2025-01-01');
    expect((await s.getAsetukset()).TilitPaatetty).toBe('2025-12-31');
  });

  it('sallii seuraavan kauden lukituksen kun edellinen on lukittu', async () => {
    const s = seed();
    await paataTilikausi(s, '2025-01-01');
    await paataTilikausi(s, '2026-01-01');
    expect((await s.getAsetukset()).TilitPaatetty).toBe('2026-12-31');
  });

  it('estää kauden lukituksen jos aiempi kausi on vielä auki (EDELLINENAUKI)', async () => {
    const s = seed();
    await expect(paataTilikausi(s, '2026-01-01')).rejects.toMatchObject({ code: 'EDELLINENAUKI' });
  });

  it('hylkää tuntemattoman kauden (EITILIKAUTTA)', async () => {
    const s = seed();
    await expect(paataTilikausi(s, '2099-01-01')).rejects.toMatchObject({ code: 'EITILIKAUTTA' });
  });

  it('ei siirrä rajaa taaksepäin: jo lukitun kauden uudelleenlukitus hylätään (JOLUKITTU)', async () => {
    const s = seed();
    await paataTilikausi(s, '2025-01-01');
    await paataTilikausi(s, '2026-01-01'); // raja = 2026-12-31
    await expect(paataTilikausi(s, '2025-01-01')).rejects.toMatchObject({ code: 'JOLUKITTU' });
    expect((await s.getAsetukset()).TilitPaatetty).toBe('2026-12-31');
  });
});

describe('avaaTilikausi', () => {
  it('avaa kauden (TilitPaatetty = alkaa - 1 pv)', async () => {
    const s = seed();
    await paataTilikausi(s, '2025-01-01');
    await avaaTilikausi(s, '2025-01-01');
    expect((await s.getAsetukset()).TilitPaatetty).toBe('2024-12-31');
  });

  it('avaa myöhemmän kauden ja jättää aiemman lukituksen ennalleen', async () => {
    const s = seed();
    await paataTilikausi(s, '2025-01-01');
    await paataTilikausi(s, '2026-01-01');
    await avaaTilikausi(s, '2026-01-01');
    expect((await s.getAsetukset()).TilitPaatetty).toBe('2025-12-31');
  });

  it('estää avaamisen jos myöhempi kausi on yhä lukittu (SEURAAVALUKITTU)', async () => {
    const s = seed();
    await paataTilikausi(s, '2025-01-01');
    await paataTilikausi(s, '2026-01-01');
    await expect(avaaTilikausi(s, '2025-01-01')).rejects.toMatchObject({ code: 'SEURAAVALUKITTU' });
  });

  it('ei siirrä rajaa eteenpäin: lukitsemattoman kauden avaus hylätään (JOAUKI)', async () => {
    const s = seed();
    await paataTilikausi(s, '2025-01-01'); // raja = 2025-12-31; 2026 auki
    await expect(avaaTilikausi(s, '2026-01-01')).rejects.toMatchObject({ code: 'JOAUKI' });
    expect((await s.getAsetukset()).TilitPaatetty).toBe('2025-12-31');
  });

  it('avaamaton kirjanpito (raja tyhjä): avaus hylätään (JOAUKI)', async () => {
    const s = seed();
    await expect(avaaTilikausi(s, '2025-01-01')).rejects.toMatchObject({ code: 'JOAUKI' });
  });
});
