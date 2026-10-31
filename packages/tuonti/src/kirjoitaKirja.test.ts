import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Storage } from '@penni/engine';
import { createMemoryStorage } from '@penni/storage-memory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kirjoitaKirja } from './kirjoitaKirja.js';
import { lueKitsas } from './lueKitsas.js';
import { luoTestiKitsas } from './testi/luoTestiKitsas.js';
import type { KitsasKirja, KitsasTosite, TuontiEdistyminen } from './tyypit.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-kirjoitus-'));
const polku = join(hakemisto, 'testi.kitsas');
beforeAll(() => luoTestiKitsas(polku));
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

const AIKA = '2026-07-31T12:00:00.000Z';

async function tuoMuistiin(): Promise<{
  storage: Storage;
  raportti: Awaited<ReturnType<typeof kirjoitaKirja>>;
}> {
  const storage = createMemoryStorage();
  const raportti = await kirjoitaKirja(lueKitsas(polku), storage, { aika: AIKA });
  return { storage, raportti };
}

/** A minimal KitsasKirja carrying only the given tositteet — for isolated warning tests. */
function kirjaTositteineen(tositteet: KitsasTosite[]): KitsasKirja {
  return {
    tilit: [],
    tilikaudet: [],
    asetukset: {},
    kumppanit: [],
    tositteet,
    liitteet: [],
    kpVersio: '24',
    ohitetut: {},
  };
}

describe('kirjoitaKirja', () => {
  it('kirjoittaa tilit ja otsikot tilikarttaan', async () => {
    const { storage } = await tuoMuistiin();
    const kartta = await storage.getChart();
    expect(kartta.length).toBe(5);
    expect(kartta.find((t) => t.numero === 1910)).toBeDefined();
  });

  it('kirjoittaa tilikaudet', async () => {
    const { storage } = await tuoMuistiin();
    const kaudet = await storage.getTilikaudet();
    expect(kaudet.map((k) => k.alkaa).sort()).toEqual(['2025-01-01', '2026-01-01']);
  });

  it('kirjoittaa asetukset ilman Kitsaksen käyttöliittymäavaimia', async () => {
    const { storage } = await tuoMuistiin();
    const asetukset = await storage.getAsetukset();
    expect(asetukset.Nimi).toBe('Testikirjanpito Oy');
    expect(asetukset.LaskuIkkunaX).toBeUndefined();
  });

  it('kirjoittaa kumppanit alkuperäisin tunnistein', async () => {
    const { storage } = await tuoMuistiin();
    const kumppanit = await storage.getKumppanit();
    expect(kumppanit).toHaveLength(1);
    expect(kumppanit[0]?.id).toBe(1);
    expect(kumppanit[0]?.nimi).toBe('Testitoimittaja Oy');
  });

  it('säilyttää viimeisteltyjen tositteiden tunnisteet ja tilat', async () => {
    const { storage } = await tuoMuistiin();
    const myynti = await storage.getTosite(1);
    expect(myynti?.tila).toBe(100);
    expect(myynti?.tunniste).toBe(1);
    expect(myynti?.viennit).toHaveLength(3);
  });

  it('säilyttää poistetun tositteen tilan 0', async () => {
    const { storage } = await tuoMuistiin();
    const poistettu = await storage.getTosite(3);
    expect(poistettu?.tila).toBe(0);
    expect(poistettu?.tunniste).toBe(99);
  });

  it('kirjoittaa liitteet oikean tositteen alle', async () => {
    const { storage } = await tuoMuistiin();
    const liitteet = await storage.getLiitteet(2);
    expect(liitteet).toHaveLength(1);
    expect(liitteet[0]?.nimi).toBe('kuitti.pdf');
  });

  it('leimaa koko tuonnin samalla aikaleimalla lokiin', async () => {
    const { storage } = await tuoMuistiin();
    const eka = await storage.getLoki(1);
    const toka = await storage.getLoki(2);
    expect(eka.length).toBeGreaterThan(0);
    expect(eka.every((r) => r.aika === AIKA)).toBe(true);
    expect(toka.every((r) => r.aika === AIKA)).toBe(true);
  });

  it('raportoi kirjoitetut määrät ja ohitetut taulut', async () => {
    const { raportti } = await tuoMuistiin();
    expect(raportti.tilit).toBe(5);
    expect(raportti.tilikaudet).toBe(2);
    expect(raportti.kumppanit).toBe(1);
    expect(raportti.tositteet).toBe(5);
    expect(raportti.viennit).toBe(10);
    expect(raportti.liitteet).toBe(1);
    // Testikanta siementää yhden Kohdennus-rivin ja kaksi Tositeloki-riviä, kuten oikea kirja.
    expect(raportti.ohitetut.Kohdennus).toBe(1);
    expect(raportti.ohitetut.Tositeloki).toBe(2);
  });

  it('ilmoittaa edistymisestä jokaisessa vaiheessa', async () => {
    const storage = createMemoryStorage();
    const vaiheet: TuontiEdistyminen['vaihe'][] = [];
    const tapahtumat: TuontiEdistyminen[] = [];
    await kirjoitaKirja(lueKitsas(polku), storage, {
      aika: AIKA,
      edistyminen: (e) => {
        tapahtumat.push(e);
        if (!vaiheet.includes(e.vaihe)) vaiheet.push(e.vaihe);
      },
    });
    expect(vaiheet).toEqual([
      'tilit',
      'tilikaudet',
      'asetukset',
      'kumppanit',
      'tositteet',
      'liitteet',
    ]);
    // tehty never overshoots kaikkiaan in any phase.
    expect(tapahtumat.every((e) => e.tehty <= e.kaikkiaan)).toBe(true);
    // Testikanta sisältää 5 tositetta: viimeisen 'tositteet'-tapahtuman pitää raportoida
    // tehty === kaikkiaan === 5, ei jämähtänyt nollaan eikä tuplalaskettu.
    const tositeTapahtumat = tapahtumat.filter((e) => e.vaihe === 'tositteet');
    const viimeinen = tositeTapahtumat.at(-1);
    expect(viimeinen?.tehty).toBe(5);
    expect(viimeinen?.kaikkiaan).toBe(5);
  });

  it('varoittaa poikkeavasta KpVersiosta', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    kirja.kpVersio = '99';
    const raportti = await kirjoitaKirja(kirja, storage, { aika: AIKA });
    expect(raportti.varoitukset.some((v) => v.includes('99'))).toBe(true);
  });

  it('ei varoita MUU-tyyppisestä (tyyppi 0) tositteesta', async () => {
    const storage = createMemoryStorage();
    const tosite: KitsasTosite = {
      id: 1,
      pvm: '2026-01-01',
      tyyppi: 0,
      tila: 100,
      tunniste: 1,
      sarja: '',
      viennit: [],
    };
    const raportti = await kirjoitaKirja(kirjaTositteineen([tosite]), storage, { aika: AIKA });
    expect(raportti.varoitukset.some((v) => v.includes('ilman tyyppiä'))).toBe(false);
  });

  it('varoittaa aidosti tyypittömästä tositteesta (tyyppi ei ole numero)', async () => {
    const storage = createMemoryStorage();
    // Kitsaksen Tosite.tyyppi-sarake on nullable oletusarvotta; muunnaTosite päästää sen läpi
    // tarkistamatta, joten tällainen rivi saapuu ajossa arvolla tyyppi: null vaikka staattinen
    // tyyppi väittää number. Cast tarvitaan tämän tuottamiseen testissä.
    const tosite = {
      id: 1,
      pvm: '2026-01-01',
      tyyppi: null,
      tila: 100,
      tunniste: 1,
      sarja: '',
      viennit: [],
    } as unknown as KitsasTosite;
    const raportti = await kirjoitaKirja(kirjaTositteineen([tosite]), storage, { aika: AIKA });
    const osumat = raportti.varoitukset.filter((v) => v.includes('ilman tyyppiä'));
    expect(osumat).toHaveLength(1);
    expect(osumat[0]).toContain('1 tositetta');
  });

  it('selittää ohitetun taulun oletussyyllä', async () => {
    const storage = createMemoryStorage();
    const kirja = { ...kirjaTositteineen([]), ohitetut: { Kohdennus: 3 } };
    const raportti = await kirjoitaKirja(kirja, storage, { aika: AIKA });
    expect(raportti.varoitukset).toContain(
      'Taulua Kohdennus (3 riviä) ei tuotu — Penni ei mallinna sitä.',
    );
  });

  it('selittää Tositelokin omalla syyllään — Penni kyllä mallintaa auditlokin', async () => {
    // Oletussyy ("Penni ei mallinna sitä") olisi Tositelokista suoraan väärä: Penni pitää
    // omaa append-only-lokiaan, mutta ei peri toisen kirjanpidon historiaa.
    const storage = createMemoryStorage();
    const kirja = { ...kirjaTositteineen([]), ohitetut: { Tositeloki: 311 } };
    const raportti = await kirjoitaKirja(kirja, storage, { aika: AIKA });
    const varoitus = raportti.varoitukset.find((v) => v.includes('Tositeloki'));
    expect(varoitus).toBe(
      'Taulua Tositeloki (311 riviä) ei tuotu — Penni ei peri toisen kirjanpidon lokia, vaan kirjaa tuonnista omat lokimerkintänsä.',
    );
    expect(varoitus).not.toContain('ei mallinna');
  });
});
