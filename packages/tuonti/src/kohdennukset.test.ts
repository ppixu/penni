import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStorage } from '@penni/storage-memory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kirjoitaKirja } from './kirjoitaKirja.js';
import { merkkauksetVienneittain, muunnaBudjetit, muunnaKohdennukset } from './kohdennukset.js';
import { lueKitsas } from './lueKitsas.js';
import { luoKohdennusKitsas, luoTestiKitsas } from './testi/luoTestiKitsas.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-kohdennukset-'));
const polku = join(hakemisto, 'kohdennukset.kitsas');
const vanhaPolku = join(hakemisto, 'ilman.kitsas');
beforeAll(() => {
  luoKohdennusKitsas(polku);
  luoTestiKitsas(vanhaPolku);
});
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

const AIKA = '2026-10-31T12:00:00.000Z';

describe('muunnaKohdennukset', () => {
  it('lukee nimen, päivämäärät ja säilyttää tuntemattomat avaimet ja id:n', () => {
    const [k] = muunnaKohdennukset([
      {
        id: 7,
        tyyppi: 1,
        kuuluu: null,
        json: JSON.stringify({
          nimi: { fi: 'Tampere', sv: 'Tammerfors' },
          alkaa: '2025-01-01',
          paattyy: '2026-12-31',
          lisatieto: 'x',
        }),
      },
    ]);
    expect(k).toEqual({
      id: 7,
      tyyppi: 1,
      nimi: { fi: 'Tampere', sv: 'Tammerfors' },
      alkaa: '2025-01-01',
      paattyy: '2026-12-31',
      lisatieto: 'x',
    });
  });

  it('ohittaa tyypin 0 (Yleinen on implisiittinen)', () => {
    expect(
      muunnaKohdennukset([{ id: 0, tyyppi: 0, kuuluu: null, json: '{"nimi":{"fi":"Yleinen"}}' }]),
    ).toEqual([]);
  });

  it('säilyttää kuuluu vain projekteilla; 0 ja NULL tarkoittavat Yleistä', () => {
    const json = '{"nimi":{"fi":"A"}}';
    const tulos = muunnaKohdennukset([
      { id: 1, tyyppi: 1, kuuluu: 9, json },
      { id: 2, tyyppi: 2, kuuluu: 1, json },
      { id: 3, tyyppi: 2, kuuluu: 0, json },
      { id: 4, tyyppi: 2, kuuluu: null, json },
      { id: 5, tyyppi: 3, kuuluu: 1, json },
    ]);
    expect(tulos.map((k) => k.kuuluu)).toEqual([undefined, 1, undefined, undefined, undefined]);
    expect(tulos.every((k) => !('kuuluu' in k) || k.tyyppi === 2)).toBe(true);
  });

  it('sietää puuttuvan nimen ja ei-JSON-sisällön', () => {
    const tulos = muunnaKohdennukset([
      { id: 1, tyyppi: 1, kuuluu: null, json: null },
      { id: 2, tyyppi: 1, kuuluu: null, json: 'ei json' },
      { id: 3, tyyppi: 3, kuuluu: null, json: '{"nimi":{"sv":"Resa"}}' },
      { id: 4, tyyppi: 3, kuuluu: null, json: '{"nimi":{"fi":"  "},"alkaa":"huomenna"}' },
    ]);
    expect(tulos.map((k) => k.nimi)).toEqual([
      { fi: 'Kohdennus 1' },
      { fi: 'Kohdennus 2' },
      { sv: 'Resa', fi: 'Resa' },
      { fi: 'Kohdennus 4' },
    ]);
    expect(tulos[3]).not.toHaveProperty('alkaa');
  });

  it('lukee pelkän merkkijononimen suomenkielisenä (Kitsas Monikielinen::aseta)', () => {
    const tulos = muunnaKohdennukset([
      { id: 1, tyyppi: 1, kuuluu: null, json: '{"nimi":"Kerhotalo"}' },
      { id: 2, tyyppi: 3, kuuluu: null, json: '{"nimi":"  "}' },
    ]);
    expect(tulos.map((k) => k.nimi)).toEqual([{ fi: 'Kerhotalo' }, { fi: 'Kohdennus 2' }]);
  });
});

describe('merkkauksetVienneittain', () => {
  it('ryhmittelee viennin mukaan nousevaan järjestykseen ilman kaksoisarvoja', () => {
    const kartta = merkkauksetVienneittain([
      { vienti: 4, kohdennus: 6 },
      { vienti: 2, kohdennus: 5 },
      { vienti: 4, kohdennus: 5 },
      { vienti: 4, kohdennus: 6 },
    ]);
    expect(kartta).toEqual(
      new Map([
        [4, [5, 6]],
        [2, [5]],
      ]),
    );
  });
});

describe('muunnaBudjetit', () => {
  it('ryhmittelee tilikausittain, sentti -> sentit, NULL-kohdennus = 0', () => {
    expect(
      muunnaBudjetit([
        { tilikausi: '2026-01-01', kohdennus: 0, tili: 4000, sentti: -90000 },
        { tilikausi: '2025-01-01', kohdennus: 3, tili: 4000, sentti: -30000 },
        { tilikausi: '2025-01-01', kohdennus: null, tili: 3000, sentti: 500000 },
      ]),
    ).toEqual([
      {
        tilikausi: '2025-01-01',
        rivit: [
          { kohdennus: 0, tili: 3000, sentit: 500000 },
          { kohdennus: 3, tili: 4000, sentit: -30000 },
        ],
      },
      { tilikausi: '2026-01-01', rivit: [{ kohdennus: 0, tili: 4000, sentit: -90000 }] },
    ]);
  });

  it('summaa NULL- ja 0-kohdennuksen kaksoisrivit ja pudottaa nollarivit', () => {
    expect(
      muunnaBudjetit([
        { tilikausi: '2025-01-01', kohdennus: null, tili: 3000, sentti: 100 },
        { tilikausi: '2025-01-01', kohdennus: 0, tili: 3000, sentti: 250 },
        { tilikausi: '2025-01-01', kohdennus: 1, tili: 3000, sentti: 0 },
        { tilikausi: '2025-01-01', kohdennus: 1, tili: 4000, sentti: null },
        { tilikausi: '2026-01-01', kohdennus: 1, tili: 4000, sentti: 0 },
      ]),
    ).toEqual([{ tilikausi: '2025-01-01', rivit: [{ kohdennus: 0, tili: 3000, sentit: 350 }] }]);
  });
});

describe('Kitsas-tuonti: kohdennukset, merkkaukset ja budjetit', () => {
  it('lukee kolme taulua; tyypin 0 siemenrivi ei tule mukaan', () => {
    const kirja = lueKitsas(polku);
    expect(kirja.kohdennukset.map((k) => k.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(kirja.budjetit.map((b) => b.tilikausi)).toEqual(['2025-01-01', '2026-01-01']);
  });

  it('puuttuvat taulut (vanha Kitsas) antavat tyhjän tuloksen', () => {
    const kirja = lueKitsas(vanhaPolku);
    expect(kirja.kohdennukset).toEqual([]);
    expect(kirja.budjetit).toEqual([]);
    expect(kirja.tositteet.flatMap((t) => t.viennit).some((v) => 'merkkaukset' in v)).toBe(false);
  });

  it('kirjoittaa kohdennukset id:t, vanhemmat ja päivämäärät säilyttäen', async () => {
    const storage = createMemoryStorage();
    await kirjoitaKirja(lueKitsas(polku), storage, { aika: AIKA });
    const kaikki = await storage.getKohdennukset();
    expect(kaikki.map((k) => [k.id, k.tyyppi, k.kuuluu, k.alkaa, k.paattyy])).toEqual([
      [1, 1, undefined, undefined, undefined],
      [2, 1, undefined, '2025-01-01', '2026-12-31'],
      [3, 2, 1, undefined, undefined],
      [4, 2, undefined, '2025-06-01', '2025-12-31'],
      [5, 3, undefined, undefined, undefined],
      [6, 3, undefined, undefined, undefined],
    ]);
    expect(kaikki[0]?.nimi).toEqual({ fi: 'Helsinki', sv: 'Helsingfors' });
    expect(kaikki[1]?.lisatieto).toBe('x');
  });

  it('liittää kohdennuksen ja merkkaukset (nousevasti) kirjauksille', async () => {
    const storage = createMemoryStorage();
    await kirjoitaKirja(lueKitsas(polku), storage, { aika: AIKA });
    const myynti = await storage.getTosite(1);
    const osto = await storage.getTosite(2);
    expect(myynti?.viennit[1]?.kohdennus).toBe(1);
    expect(myynti?.viennit[1]?.merkkaukset).toEqual([5]);
    expect(myynti?.viennit[0]).not.toHaveProperty('merkkaukset');
    expect(osto?.viennit[0]?.kohdennus).toBe(3);
    expect(osto?.viennit[0]?.merkkaukset).toEqual([5, 6]);
    const kaytto = await storage.laskeKohdennustenKaytto();
    expect(kaytto.get(5)).toBe(2);
    expect(kaytto.get(6)).toBe(1);
  });

  it('kirjoittaa budjetit tilikausittain', async () => {
    const storage = createMemoryStorage();
    await kirjoitaKirja(lueKitsas(polku), storage, { aika: AIKA });
    expect(await storage.getBudjetti('2025-01-01')).toEqual([
      { kohdennus: 0, tili: 3000, sentit: 500000 },
      { kohdennus: 1, tili: 3000, sentit: 200000 },
      { kohdennus: 1, tili: 4000, sentit: -80000 },
      { kohdennus: 3, tili: 4000, sentit: -30000 },
    ]);
    expect(await storage.getBudjetti('2026-01-01')).toEqual([
      { kohdennus: 0, tili: 3000, sentit: 600000 },
      { kohdennus: 0, tili: 4000, sentit: -90000 },
    ]);
  });

  it('ei raportoi kolmea taulua ohitetuiksi eikä kattamattomiksi', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    const raportti = await kirjoitaKirja(kirja, storage, { aika: AIKA });
    for (const taulu of ['Kohdennus', 'Merkkaus', 'Budjetti']) {
      expect(kirja.ohitetut).not.toHaveProperty(taulu);
      expect(raportti.varoitukset.some((v) => v.includes(taulu))).toBe(false);
    }
    expect(kirja.kattamattomat).toEqual({});
    expect(raportti.varoitukset).toEqual([]);
  });

  it('tuo uudelleen ajettuna saman tuloksen (idempotentti)', async () => {
    const storage = createMemoryStorage();
    await kirjoitaKirja(lueKitsas(polku), storage, { aika: AIKA });
    await kirjoitaKirja(lueKitsas(polku), storage, { aika: AIKA });
    expect(await storage.getKohdennukset()).toHaveLength(6);
    expect(await storage.getBudjetti('2025-01-01')).toHaveLength(4);
  });
});

describe('kirjoitaKirja — budjetti tilikaudelle jota ei ole', () => {
  it('ohittaa rivit ja varoittaa', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    kirja.budjetit.push({
      tilikausi: '2030-01-01',
      rivit: [{ kohdennus: 0, tili: 3000, sentit: 100 as never }],
    });
    const raportti = await kirjoitaKirja(kirja, storage, { aika: AIKA });
    expect(await storage.getBudjetti('2030-01-01')).toEqual([]);
    expect(raportti.varoitukset).toContain(
      'Budjettia tilikaudelle 2030-01-01 (1 riviä) ei tuotu — tilikautta ei ole.',
    );
  });
});
