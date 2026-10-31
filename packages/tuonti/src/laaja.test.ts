import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStorage } from '@penni/storage-memory';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kirjoitaKirja } from './kirjoitaKirja.js';
import { lueKitsas } from './lueKitsas.js';
import { tarkistaTuonti } from './tarkistaTuonti.js';
import { LAAJA_ALV, LAAJA_ERAT, luoLaajaKitsas } from './testi/luoLaajaKitsas.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-laaja-'));
const polku = join(hakemisto, 'laaja.kitsas');
beforeAll(() => luoLaajaKitsas(polku));
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

const AIKA = '2026-10-31T12:00:00.000Z';

async function tuo() {
  const storage = createMemoryStorage();
  const kirja = lueKitsas(polku);
  const raportti = await kirjoitaKirja(kirja, storage, { aika: AIKA });
  return { storage, kirja, raportti };
}

describe('laaja Kitsas-kirja', () => {
  it('avoimet erät täsmäävät Kitsaksen omaan eraid-ryhmittelyyn', async () => {
    const { storage } = await tuo();
    const erat = Object.fromEntries(await storage.queryErat({}));
    expect(erat).toEqual(LAAJA_ERAT);
  });

  it('Pennissä myöhemmin tehty erä ei sekoitu tuotuihin eriin', async () => {
    // Vanha tuonti säilytti Kitsaksen rivi-id:t (101, 121, ...) erien niminä; Pennin oma erä
    // nimetään tosite-id:llä, joten tosite 101 olisi summautunut tuodun laskun erään.
    const { storage } = await tuo();
    await storage.saveTosite(
      {
        id: 101,
        pvm: '2026-04-01',
        tyyppi: 100,
        tila: 100,
        tunniste: 6,
        sarja: '',
        viennit: [
          {
            tili: 4000,
            debet: 700 as never,
            kredit: 0 as never,
            pvm: '2026-04-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 1701,
            debet: 0 as never,
            kredit: 700 as never,
            pvm: '2026-04-01',
            alvKoodi: 0,
            alvProsentti: 0,
            era: 101,
          },
        ],
      },
      { aika: AIKA },
    );
    const erat = await storage.queryErat({});
    expect(erat.get(10)).toBe(LAAJA_ERAT[10]);
    expect(erat.get(101)).toBe(-700);
  });

  it('tallentaa rivin oman kumppanin, arkistotunnuksen ja viitteen vain tiliotteen riveille', async () => {
    const { storage } = await tuo();
    const lasku = await storage.getTosite(10);
    expect(lasku?.viennit.every((v) => v.kumppani === undefined && v.viite === undefined)).toBe(
      true,
    );
    expect(lasku?.info).toBe('Muista karhuta');
    const tiliote = await storage.getTosite(11);
    expect(tiliote?.tiliote).toEqual({ tili: 1910, alkupvm: '2026-03-01', loppupvm: '2026-03-31' });
    expect(tiliote?.viennit[1]).toMatchObject({
      kumppani: 1,
      arkistotunnus: 'ARK123',
      viite: '1232',
      era: 10,
    });
  });

  it('linkittää hyvityslaskun alkuperäiseen laskuun numeron perusteella', async () => {
    const { storage } = await tuo();
    expect((await storage.getTosite(13))?.alkuperainenTosite).toBe(10);
  });

  it('tuo muutoshistorian Kitsaksen aikaleimoin ennen tuonnin lokiriviä', async () => {
    const { storage, raportti } = await tuo();
    expect(raportti.loki).toBe(4); // 2 perustestikannasta + 2 hyvityslaskulle
    const loki = await storage.getLoki(13);
    expect(loki.map((r) => [r.aika, r.lahde ?? null, r.tila])).toEqual([
      ['2026-03-25T08:00:00Z', 'kitsas', 1],
      ['2026-03-25T08:05:00Z', 'kitsas', 100],
      [AIKA, null, 100],
    ]);
  });

  it('täsmäytys laskee alv-ilmoituksen uudelleen ja hyväksyy sen', async () => {
    const { storage, kirja } = await tuo();
    const tulos = await tarkistaTuonti(kirja, storage);
    expect(tulos.alvIlmoituksia).toBe(1);
    expect(tulos.alvErot).toEqual([]);
    expect(tulos.tasmaa).toBe(true);
  });

  it('täsmäytys huomaa, jos Penni laskee ilmoitetun alv:n eri tavalla', async () => {
    const { storage, kirja } = await tuo();
    const vaaristetty = {
      ...kirja,
      alvIlmoitukset: kirja.alvIlmoitukset.map((i) => ({ ...i, maksettava: i.maksettava + 1 })),
    };
    const tulos = await tarkistaTuonti(vaaristetty, storage);
    expect(tulos.alvErot).toEqual([
      {
        alkupvm: LAAJA_ALV.alkupvm,
        loppupvm: LAAJA_ALV.loppupvm,
        koodi: 308,
        kitsas: LAAJA_ALV.vero + 1,
        penni: LAAJA_ALV.vero,
      },
    ]);
    expect(tulos.tasmaa).toBe(false);
  });

  it('kattavuustarkastus raportoi tuomatta jääneet tiedot', async () => {
    const { kirja, raportti } = await tuo();
    expect(kirja.kattamattomat).toEqual({
      'Liite (ei tositetta)': 1,
      'Tosite.json.lasku.osoite': 1,
      'Vienti.json.palkkakoodi': 1,
    });
    expect(raportti.varoitukset.some((v) => v.includes('Vienti.json.palkkakoodi (1)'))).toBe(true);
  });
});

describe('alv-ilmoituksen yksiköt', () => {
  it('lukee vanhan Kitsaksen euromääräiset koodit sentteinä', () => {
    const vanha = join(hakemisto, 'vanha.kitsas');
    luoLaajaKitsas(vanha);
    const db = new Database(vanha);
    db.prepare('UPDATE Tosite SET json = ? WHERE id = 14').run(
      JSON.stringify({
        alv: {
          kausialkaa: '2026-03-01',
          kausipaattyy: '2026-03-31',
          koodit: { '301': 21.6, '308': 21.6, '337': 1 },
          maksettava: 21.6,
        },
      }),
    );
    db.close();
    const [ilmoitus] = lueKitsas(vanha).alvIlmoitukset;
    expect(ilmoitus?.maksettava).toBe(2160);
    expect(ilmoitus?.koodit).toEqual({ 301: 2160, 308: 2160 });
  });
});
