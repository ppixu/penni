import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { putTili } from './masterData.js';
import type { ResourceEnv } from './storage.js';
import { tallennaTosite } from './tositeResource.js';
import { haeVerolaskelma, tallennaTulovero } from './tulovero.js';

const c = (n: number): Cents => n as Cents;
const env: ResourceEnv = { aika: '2026-06-01T00:00:00.000Z' };

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
    { numero: 5000, tyyppi: 'DH', nimi: { fi: 'Edustus' } },
    { numero: 1770, tyyppi: 'DVE', nimi: { fi: 'Ennakkoverot' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Oy' },
};

// Balanced voucher: `tili` gets `debet`, 1900 the mirror.
async function kirjaa(
  s: Awaited<ReturnType<typeof createMemoryStorage>>,
  pvm: string,
  tili: number,
  debet: number,
) {
  await tallennaTosite(
    s,
    {
      pvm,
      tyyppi: 0,
      sarja: '',
      viennit: [
        { tili, debet: c(debet), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
        { tili: 1900, debet: c(0), kredit: c(debet), pvm, alvKoodi: 0, alvProsentti: 0 },
      ],
    },
    env,
  );
}

describe('haeVerolaskelma', () => {
  it('summaa tulot, vähennykset ja ennakot tilityypeittäin ja laskee veron (20 %)', async () => {
    const s = await createMemoryStorage(SEED);
    // Tulo 100 000 = kredit 3000 (CL): kirjaa 1900 debet / 3000 kredit.
    await tallennaTosite(
      s,
      {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(100_000),
            kredit: c(0),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(100_000),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    await kirjaa(s, '2026-03-02', 4000, 30_000); // täysvähennys D
    await kirjaa(s, '2026-03-03', 5000, 10_000); // puolivähennys DH
    await kirjaa(s, '2026-03-04', 1770, 4_000); // ennakko DVE

    const l = await haeVerolaskelma(s, {
      alkupvm: '2026-01-01',
      loppupvm: '2026-12-31',
      aiempiTappio: c(5_000),
    });
    expect(l.tulo).toBe(100_000);
    expect(l.taysivahennys).toBe(30_000);
    expect(l.puolivahennys).toBe(10_000);
    expect(l.vahennys).toBe(35_000); // 30000 + trunc(10000/2)
    expect(l.tulos).toBe(65_000); // 100000 - 30000 - 5000
    expect(l.aiempiTappio).toBe(5_000);
    expect(l.loppuTulos).toBe(60_000); // 65000 - 5000
    expect(l.vero).toBe(12_000); // trunc(60000/5)
    expect(l.jaaveroa).toBe(8_000); // 12000 - 4000
    expect(l.joKirjattu).toBe(false);
  });

  it('tulos <= 0 => vero 0 (tappiollinen kausi)', async () => {
    const s = await createMemoryStorage(SEED);
    await kirjaa(s, '2026-03-02', 4000, 50_000); // pelkkiä kuluja
    const l = await haeVerolaskelma(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-31' });
    expect(l.tulos).toBe(-50_000);
    expect(l.vero).toBe(0);
    expect(l.jaaveroa).toBe(0);
  });
});

describe('tallennaTulovero', () => {
  const VEROTILIT = async (s: Awaited<ReturnType<typeof createMemoryStorage>>) => {
    await putTili(s, 9940, { numero: 9940, tyyppi: 'DZ', nimi: { fi: 'Tilikauden verojaksotus' } });
    await putTili(s, 2968, { numero: 2968, tyyppi: 'B', nimi: { fi: 'Tuloverot (siirtovelat)' } });
    await putTili(s, 1813, {
      numero: 1813,
      tyyppi: 'A',
      nimi: { fi: 'Tuloverot (siirtosaamiset)' },
    });
  };

  it('kirjaa jäljelle jäävän veron: DEBET 9940 / KREDIT 2968', async () => {
    const s = await createMemoryStorage(SEED);
    await VEROTILIT(s);
    // Tulo 50 000 -> vero 10 000, ei ennakkoa -> jaaveroa 10 000.
    await tallennaTosite(
      s,
      {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(50_000),
            kredit: c(0),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(50_000),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const tosite = await tallennaTulovero(
      s,
      { alkupvm: '2026-01-01', loppupvm: '2026-12-31' },
      env,
    );
    expect(tosite.tyyppi).toBe(9930);
    expect(tosite.pvm).toBe('2026-12-31');
    expect(tosite.viennit.find((v) => v.tili === 9940)?.debet).toBe(10_000);
    expect(tosite.viennit.find((v) => v.tili === 2968)?.kredit).toBe(10_000);
    const debet = tosite.viennit.reduce((sum, v) => sum + v.debet, 0);
    const kredit = tosite.viennit.reduce((sum, v) => sum + v.kredit, 0);
    expect(debet).toBe(kredit); // tasapaino
  });

  it('palautus (ennakko > vero): KREDIT 9940 / DEBET 1813', async () => {
    const s = await createMemoryStorage(SEED);
    await VEROTILIT(s);
    // Tulo 50 000 -> vero 10 000; ennakko 15 000 -> jaaveroa -5 000.
    await tallennaTosite(
      s,
      {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(50_000),
            kredit: c(0),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(50_000),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    await tallennaTosite(
      s,
      {
        pvm: '2026-03-04',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1770,
            debet: c(15_000),
            kredit: c(0),
            pvm: '2026-03-04',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 1900,
            debet: c(0),
            kredit: c(15_000),
            pvm: '2026-03-04',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const tosite = await tallennaTulovero(
      s,
      { alkupvm: '2026-01-01', loppupvm: '2026-12-31' },
      env,
    );
    expect(tosite.viennit.find((v) => v.tili === 9940)?.kredit).toBe(5_000);
    expect(tosite.viennit.find((v) => v.tili === 1813)?.debet).toBe(5_000);
  });

  it('jaaveroa === 0 => EIVEROA (ei kirjausta)', async () => {
    const s = await createMemoryStorage(SEED);
    await VEROTILIT(s);
    await expect(
      tallennaTulovero(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-31' }, env),
    ).rejects.toMatchObject({ code: 'EIVEROA' });
  });

  it('kaksinkertainen kirjaus => JOVEROKIRJATTU', async () => {
    const s = await createMemoryStorage(SEED);
    await VEROTILIT(s);
    await tallennaTosite(
      s,
      {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(50_000),
            kredit: c(0),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(50_000),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    await tallennaTulovero(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-31' }, env);
    await expect(
      tallennaTulovero(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-31' }, env),
    ).rejects.toMatchObject({ code: 'JOVEROKIRJATTU' });
    expect(
      (await haeVerolaskelma(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-31' })).joKirjattu,
    ).toBe(true);
  });

  it('estää tuplakirjauksen: kausiraja ei ole tilikauden loppu => EIKAUDENLOPPU', async () => {
    const s = await createMemoryStorage(SEED);
    await VEROTILIT(s);
    await tallennaTosite(
      s,
      {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(50_000),
            kredit: c(0),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(50_000),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    await tallennaTulovero(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-31' }, env); // kelvollinen
    // Toinen kirjaus eri (ei-tilikauden-lopun) päivälle torjutaan.
    await expect(
      tallennaTulovero(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-30' }, env),
    ).rejects.toMatchObject({ code: 'EIKAUDENLOPPU' });
  });

  it('hylkää ei-tilikauden-lopun päivän => EIKAUDENLOPPU', async () => {
    const s = await createMemoryStorage(SEED);
    await VEROTILIT(s);
    await tallennaTosite(
      s,
      {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(50_000),
            kredit: c(0),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(50_000),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    await expect(
      tallennaTulovero(s, { alkupvm: '2026-01-01', loppupvm: '2026-06-30' }, env),
    ).rejects.toMatchObject({ code: 'EIKAUDENLOPPU' });
  });

  it('puuttuva verotili => EITILIA', async () => {
    const s = await createMemoryStorage(SEED); // ei VEROTILIT-tilejä
    await tallennaTosite(
      s,
      {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(50_000),
            kredit: c(0),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(50_000),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    await expect(
      tallennaTulovero(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-31' }, env),
    ).rejects.toMatchObject({ code: 'EITILIA' });
  });
});
