import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { haeJaksotukset, laskeJaksotus, tallennaJaksotukset } from './jaksotukset.js';
import type { ResourceEnv } from './storage.js';
import { listaaTositteet, tallennaTosite } from './tositeResource.js';

const K = '2026-12-31';
const c = (n: number): Cents => n as Cents;

describe('laskeJaksotus', () => {
  it('Branch B: prepaid booked before close defers the after-period portion (negative)', () => {
    // 36500 over 365 days; 304 days after close -> defer 30400, keep 6100.
    expect(laskeJaksotus(K, '2026-11-01', '2026-11-01', '2027-10-31', 36_500)).toBe(-30_400);
  });

  it('Branch B: no end date and span starts after close -> defer whole amount', () => {
    expect(laskeJaksotus(K, '2026-12-01', '2027-01-01', undefined, 12_000)).toBe(-12_000);
  });

  it('Branch B: span fully within closing period -> nothing to defer (0)', () => {
    expect(laskeJaksotus(K, '2026-06-01', '2026-06-01', '2026-12-01', 12_000)).toBe(0);
  });

  it('Branch B: no end date, span starts on/before close -> 0', () => {
    expect(laskeJaksotus(K, '2026-06-01', '2026-06-01', undefined, 12_000)).toBe(0);
  });

  it('Branch A: invoice booked after close, span straddles -> accrue the before-close portion (positive)', () => {
    // Same 365-day span; 61 days on/before close -> accrue 6100.
    expect(laskeJaksotus(K, '2027-01-15', '2026-11-01', '2027-10-31', 36_500)).toBe(6_100);
  });

  it('Branch A: invoice after close, span ends on/before close -> whole amount belongs to closing period', () => {
    expect(laskeJaksotus(K, '2027-01-15', '2026-11-01', '2026-12-15', 5_000)).toBe(5_000);
  });

  it('Branch A: invoice after close, span starts after close -> 0', () => {
    expect(laskeJaksotus(K, '2027-01-15', '2027-02-01', '2027-03-01', 5_000)).toBe(0);
  });

  it('boundary: jaksoalkaa == kausiLoppuu makes ennen = 1', () => {
    // span 2026-12-31..2027-01-01 (2 days), euro 200; before-close portion = 200*1/2 = 100 deferred.
    expect(laskeJaksotus(K, '2026-12-31', '2026-12-31', '2027-01-01', 200)).toBe(-100);
  });
});

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Vakuutukset' } },
    { numero: 1774, tyyppi: 'AJ', nimi: { fi: 'Siirtosaamiset' } },
    { numero: 2925, tyyppi: 'BJ', nimi: { fi: 'Siirtovelat' } },
  ],
  tilikaudet: [
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
    { alkaa: '2027-01-01', loppuu: '2027-12-31' },
  ],
  asetukset: { Nimi: 'Oy' },
};
const env: ResourceEnv = { aika: '2026-06-01T00:00:00.000Z' };

describe('haeJaksotukset', () => {
  it('EIKAUDENLOPPU kun loppupvm ei ole tilikauden viimeinen päivä', async () => {
    const s = await createMemoryStorage(SEED);
    await expect(haeJaksotukset(s, { loppupvm: '2026-06-30' })).rejects.toMatchObject({
      code: 'EIKAUDENLOPPU',
    });
  });

  it('suhteuttaa etukäteen maksetun kulun (siirtosaaminen) päättyvältä kaudelta pois', async () => {
    const s = await createMemoryStorage(SEED);
    // Vakuutus 36 500 maksettu 2026-11-01, jakso 2026-11-01..2027-10-31.
    await tallennaTosite(
      s,
      {
        pvm: '2026-11-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 4000,
            debet: c(36_500),
            kredit: c(0),
            pvm: '2026-11-01',
            alvKoodi: 0,
            alvProsentti: 0,
            jaksoalkaa: '2026-11-01',
            jaksoloppuu: '2027-10-31',
          },
          {
            tili: 1900,
            debet: c(0),
            kredit: c(36_500),
            pvm: '2026-11-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const l = await haeJaksotukset(s, { loppupvm: '2026-12-31' });
    expect(l.rivit).toHaveLength(1);
    // Branch B: defer 304/365 -> -30400 on account 4000.
    expect(l.rivit[0]).toMatchObject({
      tili: 4000,
      maara: -30_400,
      jaksoalkaa: '2026-11-01',
      jaksoloppuu: '2027-10-31',
    });
    expect(l.joKirjattu).toBe(false);
  });

  it('ei jaksotettavaa -> tyhjä lista', async () => {
    const s = await createMemoryStorage(SEED);
    const l = await haeJaksotukset(s, { loppupvm: '2026-12-31' });
    expect(l.rivit).toHaveLength(0);
  });
});

describe('tallennaJaksotukset', () => {
  const vakuutus = async (s: Awaited<ReturnType<typeof createMemoryStorage>>) => {
    await tallennaTosite(
      s,
      {
        pvm: '2026-11-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 4000,
            debet: c(36_500),
            kredit: c(0),
            pvm: '2026-11-01',
            alvKoodi: 0,
            alvProsentti: 0,
            jaksoalkaa: '2026-11-01',
            jaksoloppuu: '2027-10-31',
          },
          {
            tili: 1900,
            debet: c(0),
            kredit: c(36_500),
            pvm: '2026-11-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
  };

  it('kirjaa päätösjaksotuksen ja seuraavan kauden purun', async () => {
    const s = await createMemoryStorage(SEED);
    await vakuutus(s);
    const paatos = await tallennaJaksotukset(s, { loppupvm: '2026-12-31' }, env);
    // Branch B: −30400 -> päälle KREDIT 4000, vasta DEBET SIIRTOSAATAVA 1774.
    expect(paatos.tyyppi).toBe(9920);
    expect(paatos.pvm).toBe('2026-12-31');
    expect(paatos.viennit.find((v) => v.tili === 4000)?.kredit).toBe(30_400);
    expect(paatos.viennit.find((v) => v.tili === 1774)?.debet).toBe(30_400);
    const dPaatos = paatos.viennit.reduce((s2, v) => s2 + v.debet, 0);
    const kPaatos = paatos.viennit.reduce((s2, v) => s2 + v.kredit, 0);
    expect(dPaatos).toBe(kPaatos);

    // Purku 2027-01-01: sivut vaihtuneet, tyyppi JAKSOTUS_TA.
    const purut = await listaaTositteet(s, { alkupvm: '2027-01-01', loppupvm: '2027-01-01' });
    const purku = purut.find((t) => t.tyyppi === 9920);
    expect(purku).toBeDefined();
    expect(purku?.viennit.find((v) => v.tili === 4000)?.debet).toBe(30_400);
    expect(purku?.viennit.find((v) => v.tili === 1774)?.kredit).toBe(30_400);
    expect(purku?.viennit.find((v) => v.tili === 4000)?.tyyppi).toBe(99220 + 1); // JAKSOTUS_TA+KIRJAUS
  });

  it('EIJAKSOTETTAVAA kun ei jaksoja', async () => {
    const s = await createMemoryStorage(SEED);
    await expect(tallennaJaksotukset(s, { loppupvm: '2026-12-31' }, env)).rejects.toMatchObject({
      code: 'EIJAKSOTETTAVAA',
    });
  });

  it('JOJAKSOTETTU uusintakirjauksessa', async () => {
    const s = await createMemoryStorage(SEED);
    await vakuutus(s);
    await tallennaJaksotukset(s, { loppupvm: '2026-12-31' }, env);
    await expect(tallennaJaksotukset(s, { loppupvm: '2026-12-31' }, env)).rejects.toMatchObject({
      code: 'JOJAKSOTETTU',
    });
  });

  it('viimeinen tilikausi (ei seuraavaa kautta): vain päätöstosite, ei purkua', async () => {
    const yksiKausi = { ...SEED, tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }] };
    const s = await createMemoryStorage(yksiKausi);
    await vakuutus(s);
    const paatos = await tallennaJaksotukset(s, { loppupvm: '2026-12-31' }, env);
    expect(paatos.tyyppi).toBe(9920);
    // Ei purkutositetta (ei 2027-kautta).
    const purut = await listaaTositteet(s, { alkupvm: '2027-01-01', loppupvm: '2027-01-01' });
    expect(purut).toHaveLength(0);
  });

  it('rullaus: yli seuraavan kauden ulottuva jakso kantaa jaksoalkaa/jaksoloppuu purkuun', async () => {
    const kolmeVuotta = {
      ...SEED,
      tilikaudet: [
        { alkaa: '2026-01-01', loppuu: '2026-12-31' },
        { alkaa: '2027-01-01', loppuu: '2027-12-31' },
      ],
    };
    const s = await createMemoryStorage(kolmeVuotta);
    // Jakso 2026-11-01..2028-10-31 (yli 2027-lopun).
    await tallennaTosite(
      s,
      {
        pvm: '2026-11-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 4000,
            debet: c(73_000),
            kredit: c(0),
            pvm: '2026-11-01',
            alvKoodi: 0,
            alvProsentti: 0,
            jaksoalkaa: '2026-11-01',
            jaksoloppuu: '2028-10-31',
          },
          {
            tili: 1900,
            debet: c(0),
            kredit: c(73_000),
            pvm: '2026-11-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    await tallennaJaksotukset(s, { loppupvm: '2026-12-31' }, env);
    const purut = await listaaTositteet(s, { alkupvm: '2027-01-01', loppupvm: '2027-01-01' });
    const purkuVienti = purut[0]?.viennit.find((v) => v.tili === 4000);
    // KIRJAUS-jalka kantaa uuden jakson (jaksoloppuu > 2027-loppu).
    expect(purkuVienti?.jaksoalkaa).toBe('2027-01-01');
    expect(purkuVienti?.jaksoloppuu).toBe('2028-10-31');
  });
});
