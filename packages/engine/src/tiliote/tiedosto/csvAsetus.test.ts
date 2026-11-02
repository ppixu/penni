import { describe, expect, it } from 'vitest';
import type { CsvSarakkeet } from './csv.js';
import {
  CSV_SARAKKEET_ASETUS,
  type TallennettuCsvSarakkeet,
  csvSarakkeetAsetukseksi,
  haeCsvSarakkeet,
  onkoCsvSarakkeet,
} from './csvAsetus.js';

const sarakkeet = (pvm: number): CsvSarakkeet => ({
  pvm,
  pvmMuoto: 'd.m.yyyy',
  maara: pvm + 1,
  nimi: [pvm + 2],
  viesti: [],
});

describe('tallennettu CSV-sarakejako', () => {
  it('tallentuu ja löytyy otsikkoavaimella', () => {
    const json = csvSarakkeetAsetukseksi({}, 'pvm|summa', sarakkeet(0));
    const asetukset = { [CSV_SARAKKEET_ASETUS]: json };
    expect(CSV_SARAKKEET_ASETUS).toBe('TiliotteenCsvSarakkeet');
    expect(haeCsvSarakkeet(asetukset, 'pvm|summa')).toEqual(sarakkeet(0));
    expect(haeCsvSarakkeet(asetukset, 'muu')).toBeUndefined();
    expect(haeCsvSarakkeet({}, 'pvm|summa')).toBeUndefined();
  });

  it('uusin ensin, ja sama otsikko korvataan eikä monistu', () => {
    let json = csvSarakkeetAsetukseksi({}, 'a', sarakkeet(0));
    json = csvSarakkeetAsetukseksi({ [CSV_SARAKKEET_ASETUS]: json }, 'b', sarakkeet(1));
    json = csvSarakkeetAsetukseksi({ [CSV_SARAKKEET_ASETUS]: json }, 'a', sarakkeet(2));
    const lista = JSON.parse(json) as TallennettuCsvSarakkeet[];
    expect(lista).toEqual([
      { otsikko: 'a', sarakkeet: sarakkeet(2) },
      { otsikko: 'b', sarakkeet: sarakkeet(1) },
    ]);
  });

  it('enintään 20 jakoa: vanhin putoaa pois', () => {
    let json = '';
    for (let i = 0; i < 21; i++)
      json = csvSarakkeetAsetukseksi({ [CSV_SARAKKEET_ASETUS]: json }, `o${i}`, sarakkeet(i));
    const lista = JSON.parse(json) as TallennettuCsvSarakkeet[];
    expect(lista).toHaveLength(20);
    expect(lista[0]?.otsikko).toBe('o20');
    expect(lista.map((x) => x.otsikko)).not.toContain('o0');
  });

  it('rikkinäinen JSON → undefined, ja tallennus aloittaa puhtaalta pöydältä', () => {
    const rikki = { [CSV_SARAKKEET_ASETUS]: '{ei json' };
    expect(haeCsvSarakkeet(rikki, 'a')).toBeUndefined();
    expect(haeCsvSarakkeet({ [CSV_SARAKKEET_ASETUS]: '{"a":1}' }, 'a')).toBeUndefined();
    expect(haeCsvSarakkeet({ [CSV_SARAKKEET_ASETUS]: '[1,null,{"otsikko":"a"}]' }, 'a')).toBe(
      undefined,
    );
    expect(JSON.parse(csvSarakkeetAsetukseksi(rikki, 'a', sarakkeet(0)))).toEqual([
      { otsikko: 'a', sarakkeet: sarakkeet(0) },
    ]);
  });

  it('rakenteeltaan kelvoton tallennettu jako pudotetaan', () => {
    const tallenna = (sarakkeet: unknown) => ({
      [CSV_SARAKKEET_ASETUS]: JSON.stringify([{ otsikko: 'a', sarakkeet }]),
    });
    expect(haeCsvSarakkeet(tallenna({ pvm: 0, maara: 1 }), 'a')).toBeUndefined();
    for (const rikki of [
      { ...sarakkeet(0), pvmMuoto: 'kk/pp' },
      { ...sarakkeet(0), pvm: -1 },
      { ...sarakkeet(0), pvm: 1.5 },
      { ...sarakkeet(0), nimi: ['1'] },
      { ...sarakkeet(0), viesti: undefined },
      { ...sarakkeet(0), viite: '3' },
      { ...sarakkeet(0), debet: 3, kredit: 4 },
      { pvm: 0, pvmMuoto: 'd.m.yyyy', debet: 1, nimi: [], viesti: [] },
    ])
      expect(haeCsvSarakkeet(tallenna(rikki), 'a'), JSON.stringify(rikki)).toBeUndefined();
    const pari = { pvm: 0, pvmMuoto: 'd.m.yyyy', debet: 1, kredit: 2, nimi: [], viesti: [] };
    expect(haeCsvSarakkeet(tallenna(pari), 'a')).toEqual(pari);
  });
});

describe('onkoCsvSarakkeet', () => {
  it('tunnistaa kelvollisen jaon ja hylkää muut arvot', () => {
    expect(onkoCsvSarakkeet(sarakkeet(0))).toBe(true);
    for (const rikki of [
      null,
      undefined,
      'csv',
      [],
      { pvm: 0, maara: 1 },
      { ...sarakkeet(0), nimi: 2 },
    ])
      expect(onkoCsvSarakkeet(rikki), JSON.stringify(rikki)).toBe(false);
  });
});
