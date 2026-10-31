import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { tallennaHyvityslasku } from './hyvityslaskuResource.js';
import { listaaMyyntilaskut, tallennaMyyntilasku } from './myyntilaskuResource.js';
import { listaaOstolaskut, tallennaOstolasku } from './ostolaskuResource.js';
import type { ResourceEnv } from './storage.js';

const env: ResourceEnv = { aika: '2026-06-01T00:00:00.000Z' };
const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 1700, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
    { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Oy',
    OletusMyyntitili: '3000',
    AlvVelkaTili: '2939',
    LaskuSaatavaTili: '1700',
    LaskuMaksutili: '1900',
    OstoVelkaTili: '2870',
    OletusMenotili: '4000',
    LaskuSeuraavaId: '100',
    LaskuNumerointialkaa: '100',
  },
};

describe('tallennaHyvityslasku', () => {
  it('myyntilaskun hyvitys: HYVITYSLASKU(214), käänteiset viennit, alkuperainenTosite, avoin nollautuu', async () => {
    const s = await createMemoryStorage(SEED);
    const lasku = await tallennaMyyntilasku(
      s,
      {
        pvm: '2026-03-01',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5, tili: 3000 }],
      },
      env,
    );
    const hyv = await tallennaHyvityslasku(
      s,
      { alkuperainenTosite: lasku.id, pvm: '2026-03-15' },
      env,
    );
    expect(hyv.tyyppi).toBe(214); // HYVITYSLASKU
    expect(hyv.alkuperainenTosite).toBe(lasku.id);
    // AR leg reversed: original debit 1700 -> credit 1700 on the same era.
    const ar = hyv.viennit.find((v) => v.tili === 1700);
    expect(ar?.kredit).toBeGreaterThan(0);
    const d = hyv.viennit.reduce((a, v) => a + v.debet, 0);
    const k = hyv.viennit.reduce((a, v) => a + v.kredit, 0);
    expect(d).toBe(k);
    // Original invoice's open balance nets to 0.
    const lista = await listaaMyyntilaskut(s, {});
    expect(lista.find((r) => r.tosite === lasku.id)?.avoin).toBe(0);
  });

  it('ostolaskun hyvitys: MENO-käänteiskirjaus, ostovelka-avoin nollautuu', async () => {
    const s = await createMemoryStorage(SEED);
    const osto = await tallennaOstolasku(
      s,
      {
        pvm: '2026-03-01',
        erapvm: '2026-03-31',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
      },
      env,
    );
    const hyv = await tallennaHyvityslasku(
      s,
      { alkuperainenTosite: osto.id, pvm: '2026-03-15' },
      env,
    );
    expect(hyv.tyyppi).toBe(100); // MENO reversal
    // AP leg reversed: original credit 2870 -> debit 2870 on the same era.
    expect(hyv.viennit.find((v) => v.tili === 2870)?.debet).toBeGreaterThan(0);
    expect((await listaaOstolaskut(s, {})).find((r) => r.tosite === osto.id)?.avoin).toBe(0);
  });

  it('EITOSITETTA tuntemattomalle alkuperäiselle', async () => {
    const s = await createMemoryStorage(SEED);
    await expect(
      tallennaHyvityslasku(s, { alkuperainenTosite: 9999, pvm: '2026-03-15' }, env),
    ).rejects.toMatchObject({ code: 'EITOSITETTA' });
  });

  it('EIHYVITETTAVAA kun alkuperäisellä ei ole erää', async () => {
    const s = await createMemoryStorage(SEED);
    // A plain memo voucher with no era leg.
    const muistio = await (await import('./tositeResource.js')).tallennaTosite(
      s,
      {
        pvm: '2026-03-01',
        tyyppi: 700,
        tila: 100,
        sarja: '',
        viennit: [
          {
            tili: 3000,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(100),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 1900,
            debet: Euro.fromCents(100),
            kredit: Euro.fromCents(0),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    await expect(
      tallennaHyvityslasku(s, { alkuperainenTosite: muistio.id, pvm: '2026-03-15' }, env),
    ).rejects.toMatchObject({ code: 'EIHYVITETTAVAA' });
  });
});
