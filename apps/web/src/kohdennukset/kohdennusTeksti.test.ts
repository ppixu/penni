import { type Kohdennus, KohdennusTyyppi } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import {
  kohdennusSolunTeksti,
  kohdennusTyyppiNimi,
  kohdennustenRyhmat,
  voimassaTeksti,
} from './kohdennusTeksti';

const { KUSTANNUSPAIKKA, PROJEKTI, MERKKAUS } = KohdennusTyyppi;

const KAIKKI: Kohdennus[] = [
  { id: 1, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Nuorisotoiminta' } },
  { id: 2, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Kerhotalo' } },
  { id: 3, tyyppi: MERKKAUS, nimi: { fi: 'Avustus' } },
  { id: 4, tyyppi: PROJEKTI, kuuluu: 1, nimi: { fi: 'Kesäleiri' } },
  { id: 6, tyyppi: PROJEKTI, nimi: { fi: 'Arpajaiset' } },
  { id: 8, tyyppi: PROJEKTI, kuuluu: 99, nimi: { fi: 'Orpo' } },
  { id: 9, tyyppi: MERKKAUS, nimi: { fi: 'Alv-kuuro' } },
];

describe('kohdennusSolunTeksti', () => {
  it('polku ja merkkaukset pisteellä erotettuna', () => {
    expect(kohdennusSolunTeksti(4, [3], KAIKKI)).toBe('Nuorisotoiminta/Kesäleiri · Avustus');
  });
  it('pelkkä kohdennus tai pelkät merkkaukset', () => {
    expect(kohdennusSolunTeksti(2, undefined, KAIKKI)).toBe('Kerhotalo');
    expect(kohdennusSolunTeksti(undefined, [9, 3], KAIKKI)).toBe('Alv-kuuro · Avustus');
  });
  it('ei kohdennusta (puuttuu tai 0) ja ei merkkauksia => tyhjä', () => {
    expect(kohdennusSolunTeksti(undefined, undefined, KAIKKI)).toBe('');
    expect(kohdennusSolunTeksti(0, [], KAIKKI)).toBe('');
  });
  it('tallentamaton id => Tuntematon (n), myös merkkauksille', () => {
    expect(kohdennusSolunTeksti(5, undefined, KAIKKI)).toBe('Tuntematon (5)');
    expect(kohdennusSolunTeksti(4, [3, 77], KAIKKI)).toBe(
      'Nuorisotoiminta/Kesäleiri · Avustus · Tuntematon (77)',
    );
  });
  it('projekti Yleisen tai tuntemattoman vanhemman alla: pelkkä nimi', () => {
    expect(kohdennusSolunTeksti(6, undefined, KAIKKI)).toBe('Arpajaiset');
    expect(kohdennusSolunTeksti(8, undefined, KAIKKI)).toBe('Orpo');
  });
});

describe('voimassaTeksti', () => {
  it('väli, avoin loppu, avoin alku, ei rajoitusta', () => {
    expect(voimassaTeksti({ alkaa: '2026-01-01', paattyy: '2026-12-31' })).toBe(
      'Voimassa 1.1.2026–31.12.2026',
    );
    expect(voimassaTeksti({ alkaa: '2026-03-01' })).toBe('Voimassa 1.3.2026 alkaen');
    expect(voimassaTeksti({ paattyy: '2026-12-31' })).toBe('Voimassa 31.12.2026 asti');
    expect(voimassaTeksti({})).toBe('');
  });
});

describe('kohdennusTyyppiNimi', () => {
  it('suomenkieliset tyyppinimet', () => {
    expect(kohdennusTyyppiNimi(KUSTANNUSPAIKKA)).toBe('Kustannuspaikka');
    expect(kohdennusTyyppiNimi(PROJEKTI)).toBe('Projekti');
    expect(kohdennusTyyppiNimi(MERKKAUS)).toBe('Merkkaus');
  });
});

describe('kohdennustenRyhmat', () => {
  it('kustannuspaikat projekteineen, Yleisen projektit (myös orvot) ja merkkaukset nimijärjestyksessä', () => {
    const r = kohdennustenRyhmat(KAIKKI);
    expect(
      r.kustannuspaikat.map((g) => [g.kustannuspaikka.id, g.projektit.map((p) => p.id)]),
    ).toEqual([
      [2, []],
      [1, [4]],
    ]);
    expect(r.yleiset.map((k) => k.id)).toEqual([6, 8]);
    expect(r.merkkaukset.map((k) => k.id)).toEqual([9, 3]);
  });
  it('tyhjä lista => tyhjät ryhmät', () => {
    expect(kohdennustenRyhmat([])).toEqual({ kustannuspaikat: [], yleiset: [], merkkaukset: [] });
  });
});
