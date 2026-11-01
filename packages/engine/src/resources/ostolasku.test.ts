import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { tallennaSuoritus } from './myyntilaskuResource.js';
import { listaaOstolaskut, tallennaOstolasku } from './ostolaskuResource.js';
import type { ResourceEnv } from './storage.js';

const c = (n: number) => Euro.fromCents(n);
const env: ResourceEnv = { aika: '2026-06-01T00:00:00.000Z' };
const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
    { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Oy', OstoVelkaTili: '2870', OletusMenotili: '4000', LaskuMaksutili: '1900' },
};
// SEED + maksuperusteisen alv:n kohdentamaton saatavatili (ALM).
const SEED_MAKSUPERUSTEINEN = {
  ...SEED,
  tilit: [
    ...SEED.tilit,
    { numero: 1764, tyyppi: 'ALM', nimi: { fi: 'Kohdentamaton ALV-saatava' } },
  ],
};

describe('tallennaOstolasku', () => {
  it('kirjaa kotimaisen ostolaskun: menon debet + ALV-saatava debet + ostovelka kredit, era = tosite.id', async () => {
    const s = await createMemoryStorage(SEED);
    // Netto 100,00 + 25,5% ALV; brutto 125,50 velkaa toimittajalle.
    const t = await tallennaOstolasku(
      s,
      {
        pvm: '2026-03-01',
        laskupvm: '2026-03-01',
        erapvm: '2026-03-31',
        viite: '1234567',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 21, alvProsentti: 25.5, tili: 4000 }],
      },
      env,
    );
    expect(t.tyyppi).toBe(100); // MENO
    const meno = t.viennit.find((v) => v.tili === 4000);
    const alv = t.viennit.find((v) => v.tili === 1763);
    const velka = t.viennit.find((v) => v.tili === 2870);
    expect(meno?.debet).toBe(10_000);
    expect(alv?.debet).toBe(2_550);
    expect(velka?.kredit).toBe(12_550);
    expect(velka?.era).toBe(t.id); // E2
    const d = t.viennit.reduce((a, v) => a + v.debet, 0);
    const k = t.viennit.reduce((a, v) => a + v.kredit, 0);
    expect(d).toBe(k);
    expect(t.viite).toBe('1234567');
  });

  it('kopioi rivin kohdennuksen ja merkkaukset meno- ja ALV-vienneille', async () => {
    const s = await createMemoryStorage(SEED);
    const t = await tallennaOstolasku(
      s,
      {
        pvm: '2026-03-01',
        rivit: [
          {
            myyntiKpl: 1,
            aNetto: 100,
            alvKoodi: 21,
            alvProsentti: 25.5,
            tili: 4000,
            kohdennus: 4,
            merkkaukset: [7, 3],
          },
        ],
      },
      env,
    );
    for (const tili of [4000, 1763])
      expect(t.viennit.find((v) => v.tili === tili)).toMatchObject({
        kohdennus: 4,
        merkkaukset: [3, 7],
      });
    expect(t.viennit.find((v) => v.tili === 2870)).not.toHaveProperty('merkkaukset');
  });

  it('EIOSTOVELKATILIA kun ostovelkatiliä ei löydy', async () => {
    const s = await createMemoryStorage({
      ...SEED,
      asetukset: { Nimi: 'Oy', OletusMenotili: '4000' },
      tilit: SEED.tilit.filter((x) => x.numero !== 2870),
    });
    await expect(
      tallennaOstolasku(
        s,
        {
          pvm: '2026-03-01',
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
        },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EIOSTOVELKATILIA' });
  });

  it('EISUMMAA kun laskun loppusumma on negatiivinen', async () => {
    const s = await createMemoryStorage(SEED);
    await expect(
      tallennaOstolasku(
        s,
        {
          pvm: '2026-03-01',
          rivit: [{ myyntiKpl: 1, aNetto: -100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
        },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EISUMMAA' });
  });

  it('EIRIVEJA kun ostolaskulla ei ole yhtään riviä', async () => {
    const s = await createMemoryStorage(SEED);
    await expect(tallennaOstolasku(s, { pvm: '2026-03-01', rivit: [] }, env)).rejects.toMatchObject(
      { code: 'EIRIVEJA' },
    );
  });
});

describe('tallennaOstolasku maksuperusteinen', () => {
  it('defers input VAT to the KOHDENTAMATON account when the book is on cash-basis', async () => {
    const s = await createMemoryStorage(SEED_MAKSUPERUSTEINEN);
    await s.patchAsetukset({ AlvVelvollinen: 'true', MaksuAlvAlkaa: '2026-01-01' });
    const lasku = await tallennaOstolasku(
      s,
      {
        pvm: '2026-06-01',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 21, alvProsentti: 25.5, tili: 4000 }],
      },
      env,
    );
    expect(lasku.viennit.find((v) => v.tili === 1764)?.debet).toBe(2_550); // deferred VAT in holding
    expect(lasku.viennit.some((v) => v.tili === 1763)).toBe(false); // not in real ALVSAATAVA
    expect(lasku.viennit.find((v) => v.tili === 4000)?.alvKoodi).toBe(28);
    // still balanced, AP unchanged (gross 12550 credit)
    expect(lasku.viennit.reduce((a, v) => a + v.debet, 0)).toBe(
      lasku.viennit.reduce((a, v) => a + v.kredit, 0),
    );
    expect(lasku.viennit.find((v) => v.tili === 2870)?.kredit).toBe(12_550);
  });

  it('EIKOHDENTAMATONTILIA kun kohdentamaton-tili puuttuu maksuperusteisessa kirjanpidossa', async () => {
    const s = await createMemoryStorage(SEED); // ei ALM-tiliä
    await s.patchAsetukset({ AlvVelvollinen: 'true', MaksuAlvAlkaa: '2026-01-01' });
    await expect(
      tallennaOstolasku(
        s,
        {
          pvm: '2026-06-01',
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 21, alvProsentti: 25.5, tili: 4000 }],
        },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EIKOHDENTAMATONTILIA' });
  });
});

describe('tallennaSuoritus (ostovelka)', () => {
  it('maksaa ostolaskun: pankki kredit + ostovelka debet, nettouttaa erän nollaan', async () => {
    const s = await createMemoryStorage(SEED);
    const lasku = await tallennaOstolasku(
      s,
      {
        pvm: '2026-03-01',
        erapvm: '2026-03-31',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
      },
      env,
    );
    const maksu = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-04-01', summa: c(10_000) },
      env,
    );
    expect(maksu.tyyppi).toBe(400); // TILIOTE
    expect(maksu.viennit.find((v) => v.tili === 1900)?.kredit).toBe(10_000); // pankki kredit
    expect(maksu.viennit.find((v) => v.tili === 2870)?.debet).toBe(10_000); // ostovelka debet
    // Erä nollautuu: queryErat era-saldo (debet-kredit) == 0.
    const erat = await s.queryErat({});
    expect(erat.get(lasku.id) ?? 0).toBe(0);
  });
});

describe('listaaOstolaskut', () => {
  it('listaa ostolaskun positiivisella avoimella (velan luonnollinen etumerkki)', async () => {
    const s = await createMemoryStorage(SEED);
    const lasku = await tallennaOstolasku(
      s,
      {
        pvm: '2026-03-01',
        laskupvm: '2026-03-01',
        erapvm: '2026-03-31',
        viite: '77',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
      },
      env,
    );
    const lista = await listaaOstolaskut(s, {});
    expect(lista).toHaveLength(1);
    expect(lista[0]?.tosite).toBe(lasku.id);
    expect(lista[0]?.summa).toBe(10_000);
    expect(lista[0]?.avoin).toBe(10_000); // positive open payable (E1)
    expect(lista[0]?.era).toBe(lasku.id);
  });

  it('avoin-suodatin piilottaa maksetun laskun', async () => {
    const s = await createMemoryStorage(SEED);
    const lasku = await tallennaOstolasku(
      s,
      {
        pvm: '2026-03-01',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
      },
      env,
    );
    await tallennaSuoritus(s, { tosite: lasku.id, pvm: '2026-04-01', summa: c(10_000) }, env);
    expect(await listaaOstolaskut(s, { avoin: true })).toHaveLength(0);
  });
});
