import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { AlvKoodi } from '../alv/koodit.js';
import { haeAlvLaskelma } from './alvLaskelma.js';
import { vanhennaMaksuperusteinenAlv } from './maksuperusteinenVanhennus.js';
import { tallennaMyyntilasku, tallennaSuoritus } from './myyntilaskuResource.js';
import { tallennaOstolasku } from './ostolaskuResource.js';
import type { ResourceEnv } from './storage.js';

const env: ResourceEnv = { aika: '2027-06-30T00:00:00.000Z' };

const seed = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Suoritettava alv' } },
      { numero: 2949, tyyppi: 'BLM', nimi: { fi: 'Kohdentamaton alv-velka' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {
      AlvVelvollinen: 'true',
      LaskuSaatavaTili: '1701',
      OletusMyyntitili: '3000',
      AlvVelkaTili: '2939',
      LaskuMaksutili: '1900',
    },
  });

// Cash-basis seed: sales + purchase VAT accounts, spans 2026-2027 so the fiscal-year
// filter never rejects the 12-month-old invoices used below. Never locked/closed here.
const seedMp = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Suoritettava alv' } },
      { numero: 2949, tyyppi: 'BLM', nimi: { fi: 'Kohdentamaton alv-velka' } },
      { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
      { numero: 1764, tyyppi: 'ALM', nimi: { fi: 'Kohdentamaton ALV-saatava' } },
      { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    ],
    tilikaudet: [
      { alkaa: '2026-01-01', loppuu: '2026-12-31' },
      { alkaa: '2027-01-01', loppuu: '2027-12-31' },
    ],
    asetukset: {
      AlvVelvollinen: 'true',
      MaksuAlvAlkaa: '2020-01-01',
      LaskuSaatavaTili: '1701',
      OletusMyyntitili: '3000',
      AlvVelkaTili: '2939',
      LaskuMaksutili: '1900',
      OstoVelkaTili: '2870',
      OletusMenotili: '4000',
    },
  });

const yksiRivi = {
  myyntiKpl: 1,
  aNetto: 100,
  alvKoodi: AlvKoodi.MYYNNIT_NETTO,
  alvProsentti: 25.5,
};

describe('vanhennaMaksuperusteinenAlv', () => {
  it('12-month cap: recognizes an unpaid old sale into real ALVVELKA (code 118) and links it', async () => {
    const s = seedMp();
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-01-15', rivit: [yksiRivi] }, env); // > 12mo before 2027-06-30
    const sweep = await vanhennaMaksuperusteinenAlv(s, { loppupvm: '2027-06-30' }, env);
    expect(sweep).not.toBeNull();
    expect(sweep?.tyyppi).toBe(1000); // JARJESTELMATOSITE
    const real = sweep?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118);
    expect(real?.kredit).toBe(2550);
    expect(real?.maksuperusteinenTosite).toBe(lasku.id);
    expect(sweep?.viennit.reduce((a, v) => a + v.debet, 0)).toBe(
      sweep?.viennit.reduce((a, v) => a + v.kredit, 0),
    );
    // return now counts it
    const laskelma = await haeAlvLaskelma(s, { alkupvm: '2027-06-01', loppupvm: '2027-06-30' });
    expect(laskelma.koodit.get(301)).toBe(2550);
  });

  it('does not sweep a sale dated within the last 12 months', async () => {
    const s = seedMp();
    await tallennaMyyntilasku(s, { pvm: '2027-06-01', rivit: [yksiRivi] }, env);
    expect(await vanhennaMaksuperusteinenAlv(s, { loppupvm: '2027-06-30' }, env)).toBeNull();
  });

  it('12-month cap is sales-side only: an old unpaid purchase is NOT swept', async () => {
    const s = seedMp();
    await tallennaOstolasku(
      s,
      {
        pvm: '2026-01-15',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 21, alvProsentti: 25.5, tili: 4000 }],
      },
      env,
    );
    expect(await vanhennaMaksuperusteinenAlv(s, { loppupvm: '2027-06-30' }, env)).toBeNull();
  });

  it('partial payment then expiry recognizes only the remaining VAT (holding nets to 0)', async () => {
    const s = seedMp();
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-01-15', rivit: [yksiRivi] }, env);
    await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-02-01', summa: Euro.fromCents(5000) },
      env,
    ); // recognizes 1016
    const sweep = await vanhennaMaksuperusteinenAlv(s, { loppupvm: '2027-06-30' }, env);
    expect(sweep?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit).toBe(1534); // 2550 - 1016
  });

  it('idempotent: a second sweep recognizes nothing', async () => {
    const s = seedMp();
    await tallennaMyyntilasku(s, { pvm: '2026-01-15', rivit: [yksiRivi] }, env);
    await vanhennaMaksuperusteinenAlv(s, { loppupvm: '2027-06-30' }, env);
    expect(await vanhennaMaksuperusteinenAlv(s, { loppupvm: '2027-06-30' }, env)).toBeNull();
  });

  it('a payment after expiry recognizes no further VAT (the guard)', async () => {
    const s = seedMp();
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-01-15', rivit: [yksiRivi] }, env);
    await vanhennaMaksuperusteinenAlv(s, { loppupvm: '2027-06-30' }, env);
    const maksu = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2027-07-01', summa: Euro.fromCents(12550) },
      env,
    );
    expect(maksu.viennit.some((v) => v.alvKoodi === 118)).toBe(false); // no recognition legs
    expect(maksu.viennit).toHaveLength(2); // bank + settlement only
  });

  it('discontinuation (MaksuAlvLoppuu <= loppupvm) recognizes both a recent sale and an unpaid purchase', async () => {
    const s = seedMp();
    await s.patchAsetukset({ MaksuAlvLoppuu: '2026-06-30' });
    await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env); // within 12mo of 2026-06-30 but discontinued
    await tallennaOstolasku(
      s,
      {
        pvm: '2026-06-02',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 21, alvProsentti: 25.5, tili: 4000 }],
      },
      env,
    );
    const sweep = await vanhennaMaksuperusteinenAlv(s, { loppupvm: '2026-06-30' }, env);
    expect(sweep?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit).toBe(2550); // sale
    expect(sweep?.viennit.find((v) => v.tili === 1763 && v.alvKoodi === 228)?.debet).toBe(2550); // purchase deduction
  });

  it('throws EIMAKSUPERUSTEINEN when the book was never cash-basis', async () => {
    const s = seed(); // no MaksuAlvAlkaa
    await expect(
      vanhennaMaksuperusteinenAlv(s, { loppupvm: '2027-06-30' }, env),
    ).rejects.toMatchObject({ code: 'EIMAKSUPERUSTEINEN' });
  });
});
