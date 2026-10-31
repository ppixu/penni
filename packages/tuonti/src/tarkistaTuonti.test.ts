import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Euro } from '@penni/euro';
import { createMemoryStorage } from '@penni/storage-memory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kirjoitaKirja } from './kirjoitaKirja.js';
import { lueKitsas } from './lueKitsas.js';
import { tarkistaTuonti } from './tarkistaTuonti.js';
import { luoTestiKitsas } from './testi/luoTestiKitsas.js';
import type { KitsasKirja } from './tyypit.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-tasmays-'));
const polku = join(hakemisto, 'testi.kitsas');
beforeAll(() => luoTestiKitsas(polku));
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

const AIKA = '2026-07-31T12:00:00.000Z';

describe('tarkistaTuonti', () => {
  it('täsmää onnistuneen tuonnin jälkeen', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    await kirjoitaKirja(kirja, storage, { aika: AIKA });
    const raportti = await tarkistaTuonti(kirja, storage);
    expect(raportti.erot).toEqual([]);
    expect(raportti.tasmaa).toBe(true);
  });

  it('vertaa myös rivimäärät', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    await kirjoitaKirja(kirja, storage, { aika: AIKA });
    const raportti = await tarkistaTuonti(kirja, storage);
    expect(raportti.maarat.kumppanit).toEqual([1, 1]);
    expect(raportti.maarat.liitteet).toEqual([1, 1]);
  });

  it('havaitsee puuttuvan tositteen erona', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    // Jätetään yksi viimeistelty tosite kirjoittamatta.
    const vajaa = { ...kirja, tositteet: kirja.tositteet.filter((t) => t.id !== 2) };
    await kirjoitaKirja(vajaa, storage, { aika: AIKA });
    const raportti = await tarkistaTuonti(kirja, storage);
    expect(raportti.tasmaa).toBe(false);
    expect(raportti.erot.length).toBeGreaterThan(0);
    expect(raportti.erot.some((e) => e.tili === 4000)).toBe(true);
  });

  it('ei laske poistettuja tositteita saldoihin', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    await kirjoitaKirja(kirja, storage, { aika: AIKA });
    const raportti = await tarkistaTuonti(kirja, storage);
    // Poistetun tositteen 500000 sentin vienti tilille 4000 ei saa näkyä.
    expect(raportti.tasmaa).toBe(true);
  });

  it('varmistaa suodatuksen suunnan: poistetun tositteen 500000 sentin viennit puuttuvat varastosta', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    await kirjoitaKirja(kirja, storage, { aika: AIKA });
    const raportti = await tarkistaTuonti(kirja, storage);
    expect(raportti.tasmaa).toBe(true);

    // Suoraan varastosta: jos tila >= 100 -suodatin olisi väärinpäin (tai puuttuisi),
    // poistetun tositteen 500000 sentin vienti näkyisi tilillä 4000 (29194 + 500000 = 529194)
    // ja tilillä 1910 (66200 − 500000 = −433800).
    const saldot = await storage.querySaldot({ alkupvm: '2025-01-01', loppupvm: '2025-12-31' });
    expect(saldot.get(4000)).toBe(29194);
    expect(saldot.get(1910)).toBe(66200);
  });

  it('havaitsee tilikausien ulkopuolelle jäävän viennin', async () => {
    const storage = createMemoryStorage();
    // Kummankin tilikauden (2025, 2026) ulkopuolella: kirja.tilikaudet-silmukka ei koskaan
    // kysele tätä päivää kummaltakaan puolelta, joten pelkkä erot-vertailu ei huomaisi tätä.
    const ulkopuolinenPvm = '2027-06-15';
    const kirja: KitsasKirja = {
      tilit: [],
      tilikaudet: [
        { alkaa: '2025-01-01', loppuu: '2025-12-31' },
        { alkaa: '2026-01-01', loppuu: '2026-12-31' },
      ],
      asetukset: {},
      kumppanit: [],
      tositteet: [
        {
          id: 1,
          pvm: ulkopuolinenPvm,
          tyyppi: 0,
          tila: 100,
          tunniste: 1,
          sarja: '',
          viennit: [
            {
              tili: 4000,
              debet: Euro.fromCents(1000),
              kredit: Euro.fromCents(0),
              pvm: ulkopuolinenPvm,
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
      ],
      liitteet: [],
      kpVersio: '24',
      ohitetut: {},
      loki: [],
      kattamattomat: {},
      alvIlmoitukset: [],
    };
    await kirjoitaKirja(kirja, storage, { aika: AIKA });
    const raportti = await tarkistaTuonti(kirja, storage);
    expect(raportti.ulkopuoliset).toBe(1);
    expect(raportti.tasmaa).toBe(false);
  });

  it('havaitsee puuttuvan tositteen myös tosite- ja vientimäärästä', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    // Jätetään yksi viimeistelty tosite kirjoittamatta — sama tilanne kuin saldovertailun
    // testissä, mutta tässä tarkistetaan nimenomaan maarat.tositteet/viennit, koska pelkkä
    // netto-saldovertailu ei huomaisi esim. kahta toisensa kumoavaa tositetta.
    const vajaa = { ...kirja, tositteet: kirja.tositteet.filter((t) => t.id !== 2) };
    await kirjoitaKirja(vajaa, storage, { aika: AIKA });
    const raportti = await tarkistaTuonti(kirja, storage);
    expect(raportti.maarat.tositteet).toEqual([3, 2]);
    expect(raportti.maarat.viennit).toEqual([8, 5]);
    expect(raportti.tasmaa).toBe(false);
  });
});
