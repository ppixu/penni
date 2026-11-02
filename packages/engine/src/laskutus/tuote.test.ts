import { describe, expect, it } from 'vitest';
import { AlvKoodi } from '../alv/koodit.js';
import { type Tuote, nettoBrutosta, riviTuotteesta } from './tuote.js';

const tuote: Tuote = {
  id: 7,
  nimike: 'Konsultointi',
  aNetto: 80,
  alvKoodi: AlvKoodi.MYYNNIT_NETTO,
  alvProsentti: 24,
  tili: 3010,
  kohdennus: 2,
};

describe('riviTuotteesta', () => {
  it('kopioi nimikkeen, hinnan, tilin, kohdennuksen ja viittauksen tuotteeseen', () => {
    expect(riviTuotteesta(tuote, '2024-03-01', true)).toEqual({
      selite: 'Konsultointi',
      unKoodi: 'C62',
      aNetto: 80,
      alvKoodi: AlvKoodi.MYYNNIT_NETTO,
      alvProsentti: 24,
      tili: 3010,
      kohdennus: 2,
      tuote: 7,
    });
  });

  it('vanha yleinen kanta (24 %) muuttuu poimintapäivän yleiseksi kannaksi', () => {
    expect(riviTuotteesta(tuote, '2026-03-01', true).alvProsentti).toBe(25.5);
    expect(riviTuotteesta({ ...tuote, alvProsentti: 25.5 }, '2024-03-01', true).alvProsentti).toBe(
      24,
    );
  });

  it('alennettu kanta säilyy', () => {
    expect(riviTuotteesta({ ...tuote, alvProsentti: 14 }, '2026-03-01', true).alvProsentti).toBe(
      14,
    );
  });

  it('muu alv-koodi kuin myynti netto: kantaan ei kosketa', () => {
    const r = riviTuotteesta(
      { ...tuote, alvKoodi: AlvKoodi.EIALV, alvProsentti: 24 },
      '2026-03-01',
      true,
    );
    expect(r.alvKoodi).toBe(AlvKoodi.EIALV);
    expect(r.alvProsentti).toBe(24);
  });

  it('ei alv-velvollinen: alvKoodi 0 ja alvProsentti 0', () => {
    const r = riviTuotteesta(tuote, '2026-03-01', false);
    expect(r.alvKoodi).toBe(0);
    expect(r.alvProsentti).toBe(0);
  });

  it('yksikkö: oletus C62, unKoodi voittaa, vapaa yksikkö ilman unKoodia', () => {
    expect(riviTuotteesta(tuote, '2026-03-01', true).unKoodi).toBe('C62');
    const koodilla = riviTuotteesta(
      { ...tuote, unKoodi: 'HUR', yksikko: 'tunti' },
      '2026-03-01',
      true,
    );
    expect(koodilla.unKoodi).toBe('HUR');
    expect(koodilla).not.toHaveProperty('yksikko');
    const vapaa = riviTuotteesta({ ...tuote, yksikko: 'tunti' }, '2026-03-01', true);
    expect(vapaa.yksikko).toBe('tunti');
    expect(vapaa).not.toHaveProperty('unKoodi');
  });

  it('puuttuvat valinnaiset kentät jätetään pois', () => {
    const { tili: _t, kohdennus: _k, ...ilman } = tuote;
    const r = riviTuotteesta(ilman, '2026-03-01', true);
    expect(r).not.toHaveProperty('tili');
    expect(r).not.toHaveProperty('kohdennus');
  });
});

describe('nettoBrutosta', () => {
  it('laskee netton bruttohinnasta', () => {
    expect(nettoBrutosta(125.5, 25.5)).toBe(100);
    expect(nettoBrutosta(124, 24)).toBe(100);
    expect(nettoBrutosta(50, 0)).toBe(50);
  });

  it('pyöristää enintään neljään desimaaliin', () => {
    expect(nettoBrutosta(10, 25.5)).toBe(7.9681);
    expect(nettoBrutosta(-10, 25.5)).toBe(-7.9681);
  });
});
