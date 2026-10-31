import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { avaaTilikausi, paataTilikausi } from './tilikausiLukitus.js';
import {
  laadiTilinpaatos,
  peruVahvistus,
  tallennaLiitetiedot,
  vahvistaTilinpaatos,
} from './tilinpaatos.js';
import { tallennaTosite } from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2027-01-15T00:00:00.000Z' };

const seed = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } },
      { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {
      Nimi: 'Testi Oy',
      'tulos/yleinen': JSON.stringify({
        nimi: { fi: 'Tuloslaskelma' },
        rivit: [{ fi: 'Liikevaihto', L: '3' }],
      }),
      'tase/yleinen': JSON.stringify({
        nimi: { fi: 'Tase' },
        rivit: [{ fi: 'Pankkitili', L: '1900' }],
      }),
    },
  });

const tulo = (pvm: string, summa: number) => ({
  pvm,
  tyyppi: 200,
  sarja: '',
  viennit: [
    { tili: 1900, debet: c(summa), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
    { tili: 3000, debet: c(0), kredit: c(summa), pvm, alvKoodi: 0, alvProsentti: 0 },
  ],
});

describe('laadiTilinpaatos', () => {
  it('assembles tuloslaskelma + tase from the existing report engine', async () => {
    const s = seed();
    await tallennaTosite(s, tulo('2026-06-01', 100_000), env);
    const tp = await laadiTilinpaatos(s, env, { alkaa: '2026-01-01' });
    expect(tp.tilikausi).toEqual({ alkaa: '2026-01-01', loppuu: '2026-12-31' });
    expect(tp.muoto).toBe('yleinen');
    expect(tp.tuloslaskelma.find((r) => r.teksti === 'Liikevaihto')?.arvo).toBe(100_000);
    expect(tp.tase.find((r) => r.teksti === 'Pankkitili')?.arvo).toBe(100_000);
    expect(tp.liitetiedot).toBe('');
    expect(tp.vahvistettu).toBeNull();
  });

  it('echoes stored liitetiedot and vahvistettu', async () => {
    const s = seed();
    await tallennaLiitetiedot(s, { loppupvm: '2026-12-31', teksti: 'Yhtiö on toiminut...' });
    await s.patchAsetukset({ 'vahvistettu/2026-12-31': '2027-01-10' });
    const tp = await laadiTilinpaatos(s, env, { alkaa: '2026-01-01' });
    expect(tp.liitetiedot).toBe('Yhtiö on toiminut...');
    expect(tp.vahvistettu).toBe('2027-01-10');
  });

  it('selects the layout pair by muoto', async () => {
    const s = seed();
    await tallennaTosite(s, tulo('2026-06-01', 50_000), env);
    await s.patchAsetukset({
      'tase/PMA': JSON.stringify({
        nimi: { fi: 'Tase PMA' },
        rivit: [{ fi: 'Pankki', L: '1900' }],
      }),
      'tulos/mikrobrutto': JSON.stringify({
        nimi: { fi: 'Tulos mikro' },
        rivit: [{ fi: 'LV', L: '3' }],
      }),
    });
    const tp = await laadiTilinpaatos(s, env, { alkaa: '2026-01-01', muoto: 'mikro' });
    expect(tp.muoto).toBe('mikro');
    expect(tp.tase.some((r) => r.teksti === 'Pankki')).toBe(true); // used tase/PMA
    expect(tp.tuloslaskelma.some((r) => r.teksti === 'LV')).toBe(true); // used tulos/mikrobrutto
  });

  it('throws EITILIKAUTTA for an unknown fiscal year', async () => {
    const s = seed();
    await expect(laadiTilinpaatos(s, env, { alkaa: '2099-01-01' })).rejects.toMatchObject({
      code: 'EITILIKAUTTA',
    });
  });

  it('rejects editing notes of a confirmed year (JOVAHVISTETTU)', async () => {
    const s = seed();
    await s.patchAsetukset({ 'vahvistettu/2026-12-31': '2027-01-10' });
    await expect(
      tallennaLiitetiedot(s, { loppupvm: '2026-12-31', teksti: 'muutos' }),
    ).rejects.toMatchObject({ code: 'JOVAHVISTETTU' });
  });

  it('rejects notes whose loppupvm is not any fiscal year end (EITILIKAUTTA)', async () => {
    const s = seed();
    // Näppäilyvirhe (30.12. eikä 31.12.) ei saa hiljaisesti tallentaa orpoa liitetietoa.
    await expect(
      tallennaLiitetiedot(s, { loppupvm: '2026-12-30', teksti: 'orpo' }),
    ).rejects.toMatchObject({ code: 'EITILIKAUTTA' });
  });
});

describe('vahvistaTilinpaatos / peruVahvistus', () => {
  it('requires the period to be locked first (EIPAATETTY)', async () => {
    const s = seed();
    await expect(vahvistaTilinpaatos(s, { alkaa: '2026-01-01' }, env)).rejects.toMatchObject({
      code: 'EIPAATETTY',
    });
  });

  it('confirms a locked period and laadiTilinpaatos then shows vahvistettu', async () => {
    const s = seed();
    await paataTilikausi(s, '2026-01-01');
    await vahvistaTilinpaatos(s, { alkaa: '2026-01-01' }, env);
    const tp = await laadiTilinpaatos(s, env, { alkaa: '2026-01-01' });
    expect(tp.vahvistettu).toBe('2027-01-15'); // env.aika date portion
  });

  it('rejects re-confirming (JOVAHVISTETTU)', async () => {
    const s = seed();
    await paataTilikausi(s, '2026-01-01');
    await vahvistaTilinpaatos(s, { alkaa: '2026-01-01' }, env);
    await expect(vahvistaTilinpaatos(s, { alkaa: '2026-01-01' }, env)).rejects.toMatchObject({
      code: 'JOVAHVISTETTU',
    });
  });

  it('avaaTilikausi refuses a confirmed year (VAHVISTETTU) until peruVahvistus', async () => {
    const s = seed();
    await paataTilikausi(s, '2026-01-01');
    await vahvistaTilinpaatos(s, { alkaa: '2026-01-01' }, env);
    await expect(avaaTilikausi(s, '2026-01-01')).rejects.toMatchObject({ code: 'VAHVISTETTU' });
    await peruVahvistus(s, { alkaa: '2026-01-01' });
    await avaaTilikausi(s, '2026-01-01'); // now succeeds
    expect((await laadiTilinpaatos(s, env, { alkaa: '2026-01-01' })).vahvistettu).toBeNull();
  });
});
