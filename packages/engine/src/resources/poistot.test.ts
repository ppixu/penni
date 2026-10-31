import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { putTili } from './masterData.js';
import { haePoistolaskelma, tallennaPoistot } from './poistot.js';
import type { ResourceEnv } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env: ResourceEnv = { aika: '2026-06-01T00:00:00.000Z' };

const SEED = {
  tilit: [{ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } }],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Oy' },
};

// Hankinta: DEBET asset / KREDIT pankki.
async function hanki(
  s: Awaited<ReturnType<typeof createMemoryStorage>>,
  pvm: string,
  tili: number,
  summa: number,
) {
  await tallennaTosite(
    s,
    {
      pvm,
      tyyppi: 0,
      sarja: '',
      viennit: [
        { tili, debet: c(summa), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
        { tili: 1900, debet: c(0), kredit: c(summa), pvm, alvKoodi: 0, alvProsentti: 0 },
      ],
    },
    env,
  );
}

describe('haePoistolaskelma', () => {
  it('laskee menojäännöspoiston prosenttina kirjanpitoarvosta', async () => {
    const s = await createMemoryStorage(SEED);
    await putTili(s, 1120, {
      numero: 1120,
      tyyppi: 'APM',
      nimi: { fi: 'Koneet' },
      menojaannospoisto: 25,
      poistotili: 6820,
    });
    await putTili(s, 6820, { numero: 6820, tyyppi: 'DP', nimi: { fi: 'Poistot koneista' } });
    await hanki(s, '2026-03-01', 1120, 100_000);

    const l = await haePoistolaskelma(s, { loppupvm: '2026-12-31' });
    expect(l.rivit).toHaveLength(1);
    expect(l.rivit[0]).toMatchObject({
      tili: 1120,
      ennen: 100_000,
      poisto: 25_000,
      poistotili: 6820,
    });
    expect(l.yhteensa).toBe(25_000);
    expect(l.joKirjattu).toBe(false);
  });

  it('truncates toward zero ja jättää pois nollapoistot / nollasaldot', async () => {
    const s = await createMemoryStorage(SEED);
    // 7 % of 999 = 69.93 -> 69 (trunc).
    await putTili(s, 1130, {
      numero: 1130,
      tyyppi: 'APM',
      nimi: { fi: 'Kalusto' },
      menojaannospoisto: 7,
      poistotili: 6820,
    });
    await putTili(s, 6820, { numero: 6820, tyyppi: 'DP', nimi: { fi: 'Poistot' } });
    await hanki(s, '2026-03-01', 1130, 999);
    // APM ilman saldoa -> ei riviä.
    await putTili(s, 1140, {
      numero: 1140,
      tyyppi: 'APM',
      nimi: { fi: 'Tyhjä' },
      menojaannospoisto: 25,
      poistotili: 6820,
    });

    const l = await haePoistolaskelma(s, { loppupvm: '2026-12-31' });
    expect(l.rivit).toHaveLength(1);
    expect(l.rivit[0]?.poisto).toBe(69);
  });
});

describe('tallennaPoistot', () => {
  const APM = async (s: Awaited<ReturnType<typeof createMemoryStorage>>) => {
    await putTili(s, 1120, {
      numero: 1120,
      tyyppi: 'APM',
      nimi: { fi: 'Koneet' },
      menojaannospoisto: 25,
      poistotili: 6820,
    });
    await putTili(s, 6820, { numero: 6820, tyyppi: 'DP', nimi: { fi: 'Poistot koneista' } });
  };

  it('kirjaa tasapainoisen POISTOLASKELMAn: KREDIT omaisuus / DEBET poistotili', async () => {
    const s = await createMemoryStorage(SEED);
    await APM(s);
    await hanki(s, '2026-03-01', 1120, 100_000);

    const tosite = await tallennaPoistot(s, { loppupvm: '2026-12-31' }, env);
    expect(tosite.tyyppi).toBe(9910);
    expect(tosite.pvm).toBe('2026-12-31');
    expect(tosite.viennit.find((v) => v.tili === 1120)?.kredit).toBe(25_000);
    expect(tosite.viennit.find((v) => v.tili === 6820)?.debet).toBe(25_000);
    const debet = tosite.viennit.reduce((sum, v) => sum + v.debet, 0);
    const kredit = tosite.viennit.reduce((sum, v) => sum + v.kredit, 0);
    expect(debet).toBe(kredit);
  });

  it('ei poistettavaa => EIPOISTETTAVAA', async () => {
    const s = await createMemoryStorage(SEED);
    await expect(tallennaPoistot(s, { loppupvm: '2026-12-31' }, env)).rejects.toMatchObject({
      code: 'EIPOISTETTAVAA',
    });
  });

  it('kaksinkertainen kirjaus => JOPOISTETTU', async () => {
    const s = await createMemoryStorage(SEED);
    await APM(s);
    await hanki(s, '2026-03-01', 1120, 100_000);
    await tallennaPoistot(s, { loppupvm: '2026-12-31' }, env);
    await expect(tallennaPoistot(s, { loppupvm: '2026-12-31' }, env)).rejects.toMatchObject({
      code: 'JOPOISTETTU',
    });
  });

  it('puuttuva poistotili => EITILIA', async () => {
    const s = await createMemoryStorage(SEED);
    // APM osoittaa poistotiliin 6820 jota ei ole tilikartassa.
    await putTili(s, 1120, {
      numero: 1120,
      tyyppi: 'APM',
      nimi: { fi: 'Koneet' },
      menojaannospoisto: 25,
      poistotili: 6820,
    });
    await hanki(s, '2026-03-01', 1120, 100_000);
    await expect(tallennaPoistot(s, { loppupvm: '2026-12-31' }, env)).rejects.toMatchObject({
      code: 'EITILIA',
    });
  });

  it('estää tuplapoiston: kausiraja ei ole tilikauden loppu => EIKAUDENLOPPU', async () => {
    const s = await createMemoryStorage(SEED);
    await APM(s);
    await hanki(s, '2026-03-01', 1120, 100_000);
    await tallennaPoistot(s, { loppupvm: '2026-12-31' }, env); // kelvollinen
    // Toinen kirjaus eri (ei-tilikauden-lopun) päivälle torjutaan.
    await expect(tallennaPoistot(s, { loppupvm: '2026-12-30' }, env)).rejects.toMatchObject({
      code: 'EIKAUDENLOPPU',
    });
  });

  it('hylkää ei-tilikauden-lopun päivän => EIKAUDENLOPPU', async () => {
    const s = await createMemoryStorage(SEED);
    await APM(s);
    await hanki(s, '2026-03-01', 1120, 100_000);
    await expect(tallennaPoistot(s, { loppupvm: '2026-06-30' }, env)).rejects.toMatchObject({
      code: 'EIKAUDENLOPPU',
    });
  });
});
