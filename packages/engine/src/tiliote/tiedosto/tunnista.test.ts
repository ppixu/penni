import { readFileSync } from 'node:fs';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { jaaCsv } from './csv.js';
import { ehdotaCsvSarakkeet } from './csvArvaus.js';
import { t00, t10, titoTiedosto } from './tito.testiapu.js';
import { esikatseleCsv, poimiTiliotetiedosto, tunnistaTiliotetiedosto } from './tunnista.js';
import { TiliotetiedostoVirhe, dekoodaa } from './yhteiset.js';

const tavut = (teksti: string): Uint8Array => new TextEncoder().encode(teksti);
const fixtuuri = (nimi: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${nimi}`, import.meta.url)));

function virhe(f: () => unknown): TiliotetiedostoVirhe {
  try {
    f();
  } catch (e) {
    if (e instanceof TiliotetiedostoVirhe) return e;
    throw e;
  }
  throw new Error('Odotettiin TiliotetiedostoVirhe');
}

describe('tunnistaTiliotetiedosto', () => {
  it('tunnistaa PDF:n %PDF-alusta', () => {
    expect(tunnistaTiliotetiedosto(tavut('%PDF-1.7\n%âãÏÓ\n1 0 obj'))).toBe('pdf');
  });

  it('tunnistaa camt.053:n ja camt.054:n kaikki fixtuurit', () => {
    for (const nimi of [
      'camt053-perus.xml',
      'camt053-era.xml',
      'camt053-kaksi-otetta.xml',
      'camt053-etuliite-v02.xml',
    ])
      expect(tunnistaTiliotetiedosto(fixtuuri(nimi)), nimi).toBe('camt053');
    expect(tunnistaTiliotetiedosto(fixtuuri('camt054.xml'))).toBe('camt054');
  });

  it('tunnistaa camt-tiedoston BOM:n ja alun tyhjän jälkeen', () => {
    const xml = dekoodaa(fixtuuri('camt053-perus.xml'));
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...tavut(`\n  ${xml}`)]);
    expect(tunnistaTiliotetiedosto(bom)).toBe('camt053');
  });

  it('tunnistaa TITO:n T00322-alusta', () => {
    const tito = titoTiedosto([t00({ alku: '261001', loppu: '261031' })]);
    expect(tunnistaTiliotetiedosto(tavut(tito))).toBe('tito');
  });

  it('ei pidä T00-alkuista tekstiä TITO:na, ellei tietueen pituus ole 322', () => {
    expect(virhe(() => tunnistaTiliotetiedosto(tavut('T00123 jotain\nT10 muuta\n'))).koodi).toBe(
      'TUNTEMATON',
    );
  });

  it('tunnistaa kaikki CSV-fixtuurit CSV:ksi', () => {
    for (const nimi of [
      'csv-danske.csv',
      'csv-debetkredit.csv',
      'csv-holvi.csv',
      'csv-johdanto.csv',
      'csv-nordea-vanha.txt',
      'csv-nordea.csv',
      'csv-op.csv',
      'csv-spankki.csv',
      'csv-tuntematon.csv',
    ])
      expect(tunnistaTiliotetiedosto(fixtuuri(nimi)), nimi).toBe('csv');
  });

  it('hylkää muun XML:n ja nimeää tuetut muodot', () => {
    const v = virhe(() => tunnistaTiliotetiedosto(tavut('<root/>')));
    expect(v.koodi).toBe('TUNTEMATON');
    expect(v.message).toMatch(/camt\.053/);
    expect(v.message).toMatch(/TITO/);
    expect(v.message).toMatch(/CSV/);
  });

  it('hylkää JPEG-kuvan (FF D8 FF E0)', () => {
    const v = virhe(() => tunnistaTiliotetiedosto(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])));
    expect(v.koodi).toBe('TUNTEMATON');
    expect(v.message).toMatch(/PDF/);
  });

  it('hylkää pitkänkin binääritiedoston (ZIP/Word, NUL-tavuja)', () => {
    const zip = new Uint8Array(4096);
    zip.set([0x50, 0x4b, 0x03, 0x04]);
    expect(virhe(() => tunnistaTiliotetiedosto(zip)).koodi).toBe('TUNTEMATON');
    const nul = Uint8Array.from({ length: 2000 }, (_, i) => (i % 7 === 0 ? 0 : 0x41 + (i % 20)));
    expect(virhe(() => tunnistaTiliotetiedosto(nul)).koodi).toBe('TUNTEMATON');
  });

  it('hylkää tyhjän tiedoston ja yhden rivin tekstin', () => {
    expect(virhe(() => tunnistaTiliotetiedosto(new Uint8Array())).koodi).toBe('TUNTEMATON');
    expect(virhe(() => tunnistaTiliotetiedosto(tavut('Hei, tämä ei ole tiliote'))).koodi).toBe(
      'TUNTEMATON',
    );
  });
});

describe('poimiTiliotetiedosto', () => {
  it('lukee camt.053:n', () => {
    const t = poimiTiliotetiedosto(fixtuuri('camt053-perus.xml'));
    expect(t.lahde).toBe('camt053');
    expect(t.tapahtumat.length).toBeGreaterThan(0);
  });

  it('lukee TITO:n', () => {
    const tito = titoTiedosto([
      t00({ alku: '261001', loppu: '261031' }),
      t10({ pvm: '261005', maara: -4990 as Cents, nimi: 'Testi Oy' }),
    ]);
    const t = poimiTiliotetiedosto(tavut(tito));
    expect(t.lahde).toBe('tito');
    expect(t.tapahtumat).toHaveLength(1);
  });

  it('lukee pankkiprofiilin CSV:n ilman sarakkeita', () => {
    const t = poimiTiliotetiedosto(fixtuuri('csv-danske.csv'));
    expect(t.lahde).toBe('csv');
    expect(t.tapahtumat).toHaveLength(4);
  });

  it('tuntematon CSV ilman sarakkeita → CSV_SARAKKEET', () => {
    const v = virhe(() => poimiTiliotetiedosto(fixtuuri('csv-tuntematon.csv')));
    expect(v.koodi).toBe('CSV_SARAKKEET');
  });

  it('tuntematon CSV ehdotetuilla sarakkeilla luetaan', () => {
    const csvSarakkeet = ehdotaCsvSarakkeet(jaaCsv(dekoodaa(fixtuuri('csv-tuntematon.csv'))));
    const t = poimiTiliotetiedosto(fixtuuri('csv-tuntematon.csv'), { csvSarakkeet });
    expect(t.lahde).toBe('csv');
    expect(t.tapahtumat.map((x) => x.maara)).toEqual([-30000, 125000, -4590]);
  });

  it('annettu sarakejako ohittaa pankkiprofiilin', () => {
    const profiili = poimiTiliotetiedosto(fixtuuri('csv-danske.csv'));
    const sarakkeet = esikatseleCsv(fixtuuri('csv-danske.csv')).ehdotus;
    const ilmanNimea = poimiTiliotetiedosto(fixtuuri('csv-danske.csv'), {
      csvSarakkeet: { ...sarakkeet, nimi: [] },
    });
    expect(profiili.tapahtumat[0]?.nimi).not.toBe('');
    expect(ilmanNimea.tapahtumat[0]?.nimi).toBe('');
  });

  it('PDF ohjataan PDF-lukijalle', () => {
    const v = virhe(() => poimiTiliotetiedosto(tavut('%PDF-1.7\n')));
    expect(v.koodi).toBe('VAARA_MUOTO');
    expect(v.message).toMatch(/PDF/);
  });

  it('väärä tiedosto antaa suomenkielisen virheen eikä kaadu', () => {
    const v = virhe(() => poimiTiliotetiedosto(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])));
    expect(v.koodi).toBe('TUNTEMATON');
    expect(v.message).toMatch(/Tuettuja muotoja/);
  });
});

describe('esikatseleCsv', () => {
  it('pankkiprofiili: pankin nimi, profiilin sarakkeet, avain ja enintään 5 esimerkkiä', () => {
    const e = esikatseleCsv(fixtuuri('csv-danske.csv'));
    expect(e.pankki).toBe('Danske Bank');
    expect(e.otsikot).toEqual(['Pvm', 'Saaja/Maksaja', 'Määrä', 'Saldo', 'Tila', 'Tarkastus']);
    expect(e.avain).toBe('pvm|saaja/maksaja|määrä|saldo|tila|tarkastus');
    expect(e.esimerkit).toHaveLength(4);
    expect(e.ehdotus).toMatchObject({ pvm: 0, maara: 2, saldo: 3, nimi: [1] });
  });

  it('tuntematon CSV: arvaus, ei pankkia', () => {
    const e = esikatseleCsv(fixtuuri('csv-tuntematon.csv'));
    expect(e.pankki).toBeUndefined();
    expect(e.ehdotus).toEqual(ehdotaCsvSarakkeet(jaaCsv(dekoodaa(fixtuuri('csv-tuntematon.csv')))));
  });

  it('rajaa esimerkit viiteen riviin', () => {
    const rivit = Array.from({ length: 9 }, (_, i) => `${i + 1}.10.2026;Testi ${i};${i + 1},00`);
    const e = esikatseleCsv(tavut(['Päivä;Kuvaus;Euroa', ...rivit].join('\n')));
    expect(e.esimerkit).toHaveLength(5);
  });

  it('muu kuin CSV on virhe', () => {
    expect(virhe(() => esikatseleCsv(fixtuuri('camt054.xml'))).koodi).toBe('VAARA_MUOTO');
  });
});
