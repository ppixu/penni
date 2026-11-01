import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TuontiVirhe, lueKitsas, yhteenveto } from './lueKitsas.js';
import { luoTestiKitsas } from './testi/luoTestiKitsas.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-luku-'));
const testiPolku = join(hakemisto, 'testi.kitsas');
// Never open kitsas-source/ in place — WAL mode would drop -shm/-wal files beside the
// reference fixture. Copy it into the temp dir first, same as the synthetic book.
const OIKEA_LAHDE = new URL('../../../kitsas-source/unittest/data/oy.kitsas', import.meta.url)
  .pathname;
const oikeaPolku = join(hakemisto, 'oy.kitsas');
// kitsas-source on git-alimoduuli: ilman `git submodule update --init` fixtuuria ei ole ja
// sitä käyttävät testit ohitetaan.
const onOikeaLahde = existsSync(OIKEA_LAHDE);

beforeAll(() => {
  luoTestiKitsas(testiPolku);
  if (onOikeaLahde) copyFileSync(OIKEA_LAHDE, oikeaPolku);
});
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

/** Run fn, return the TuontiVirhe.koodi it throws (or undefined if it doesn't throw / throws something else). */
function siepattuKoodi(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (virhe) {
    return virhe instanceof TuontiVirhe ? virhe.koodi : undefined;
  }
}

describe('lueKitsas — synteettinen kanta', () => {
  it('lukee tilit ja otsikot samaan listaan', () => {
    const kirja = lueKitsas(testiPolku);
    expect(kirja.tilit).toHaveLength(5); // 4 tiliä + 1 otsikko
    const otsikko = kirja.tilit.find((t) => t.tyyppi === 'H1');
    expect(otsikko?.numero).toBe(3);
  });

  it('lukee tilikaudet järjestyksessä', () => {
    const kirja = lueKitsas(testiPolku);
    expect(kirja.tilikaudet.map((k) => k.alkaa)).toEqual(['2025-01-01', '2026-01-01']);
  });

  it('suodattaa Kitsaksen käyttöliittymäasetukset pois', () => {
    const kirja = lueKitsas(testiPolku);
    expect(kirja.asetukset.Nimi).toBe('Testikirjanpito Oy');
    expect(kirja.asetukset.LaskuIkkunaX).toBeUndefined();
    expect(kirja.kpVersio).toBe('24');
  });

  it('lukee kumppanit ibaneineen', () => {
    const kirja = lueKitsas(testiPolku);
    expect(kirja.kumppanit).toHaveLength(1);
    expect(kirja.kumppanit[0]?.iban).toEqual(['FI2112345600000785']);
  });

  it('lukee kaikki tositteet myös poistetut ja luonnokset', () => {
    const kirja = lueKitsas(testiPolku);
    expect(kirja.tositteet).toHaveLength(5);
    expect(kirja.tositteet.find((t) => t.id === 3)?.tila).toBe(0);
    expect(kirja.tositteet.find((t) => t.id === 3)?.tunniste).toBe(99);
    expect(kirja.tositteet.find((t) => t.id === 4)?.tila).toBe(50);
  });

  it('liittää viennit oikeisiin tositteisiin', () => {
    const kirja = lueKitsas(testiPolku);
    const myynti = kirja.tositteet.find((t) => t.id === 1);
    expect(myynti?.viennit).toHaveLength(3);
    expect(myynti?.viennit[0]?.debet).toBe(100000);
  });

  it('lukee liitteet blobeineen', () => {
    const kirja = lueKitsas(testiPolku);
    expect(kirja.liitteet).toHaveLength(1);
    expect(kirja.liitteet[0]?.tosite).toBe(2);
    expect(kirja.liitteet[0]?.data.length).toBe(4);
  });

  it('raportoi ohitetut taulut rivimäärineen', () => {
    const kirja = lueKitsas(testiPolku);
    // Kohdennus, Merkkaus ja Budjetti tuodaan nykyään; Tuote on yhä ohitettava.
    expect(kirja.ohitetut).not.toHaveProperty('Kohdennus');
    expect(kirja.ohitetut).not.toHaveProperty('Tositeloki');
  });
});

describe('lueKitsas — virhetilanteet', () => {
  it('heittää TuontiVirheen koodilla ei-tiedostoa kun tiedostoa ei ole', () => {
    const polku = join(hakemisto, 'ei-ole.kitsas');
    expect(() => lueKitsas(polku)).toThrow(TuontiVirhe);
    expect(siepattuKoodi(() => lueKitsas(polku))).toBe('ei-tiedostoa');
  });

  it('heittää TuontiVirheen koodilla ei-kitsas kun tiedosto ei ole SQLite-tietokanta', () => {
    // better-sqlite3 does not throw on open for a non-SQLite file — SQLite validates lazily,
    // so the failure only surfaces on the first query. Regression guard for that path.
    const vaara = join(hakemisto, 'vaara.kitsas');
    writeFileSync(vaara, 'ei tämä mikään tietokanta ole');
    expect(() => lueKitsas(vaara)).toThrow(TuontiVirhe);
    expect(siepattuKoodi(() => lueKitsas(vaara))).toBe('ei-kitsas');
  });

  it('heittää TuontiVirheen koodilla ei-kitsas kun sqlite-tiedostosta puuttuvat Kitsas-taulut', () => {
    const muu = join(hakemisto, 'muu.sqlite');
    const apuDb = new Database(muu);
    apuDb.exec('CREATE TABLE Foo (id INTEGER PRIMARY KEY)');
    apuDb.close();
    expect(() => lueKitsas(muu)).toThrow(TuontiVirhe);
    expect(siepattuKoodi(() => lueKitsas(muu))).toBe('ei-kitsas');
  });
});

describe.skipIf(!onOikeaLahde)('lueKitsas — oikea Kitsas-fixture', () => {
  it('lukee kitsas-source/unittest/data/oy.kitsas ilman virheitä', () => {
    const kirja = lueKitsas(oikeaPolku);
    expect(kirja.tilit.length).toBe(865 + 208);
    expect(kirja.tilikaudet).toHaveLength(2);
    expect(kirja.tositteet).toHaveLength(10);
    expect(kirja.kumppanit).toHaveLength(4);
    expect(kirja.liitteet).toHaveLength(4);
  });

  it('poimii laskun numeron lasku-kentästä myös oikeasta kirjasta (tosite 4)', () => {
    const kirja = lueKitsas(oikeaPolku);
    const tosite4 = kirja.tositteet.find((t) => t.id === 4);
    expect(tosite4?.numero).toBe('1000');
    expect(tosite4?.maksutapa).toBe(1);
  });

  it('yhteenveto tiivistää kirjan esikatselua varten', () => {
    const y = yhteenveto(lueKitsas(oikeaPolku));
    expect(y.nimi).toBe('Testi Oy');
    expect(y.kpVersio).toBe('24');
    expect(y.tilikaudet).toHaveLength(2);
    expect(y.tositteet).toBe(10);
  });
});
