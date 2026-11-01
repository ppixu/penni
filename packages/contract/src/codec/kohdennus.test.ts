import type { Kohdennus } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { decodeInit, encodeInit } from './init.js';
import {
  decodeBudjettiRivi,
  decodeKohdennus,
  decodeKohdennusKaytolla,
  encodeBudjettiRivi,
  encodeKohdennus,
} from './kohdennus.js';

describe('kohdennus codec', () => {
  it('round-trips, coercing id to number and preserving extra keys', () => {
    const wire = {
      id: '7',
      tyyppi: 2,
      kuuluu: 3,
      nimi: { fi: 'Messut', en: 'Fair' },
      alkaa: '2026-01-01',
      paattyy: '2026-06-30',
      vari: '#ff0000',
    };
    const k = decodeKohdennus(wire);
    expect(k.id).toBe(7);
    expect(k.kuuluu).toBe(3);
    expect(k.nimi).toEqual({ fi: 'Messut', en: 'Fair' });
    expect(k.vari).toBe('#ff0000');
    expect(encodeKohdennus(k)).toEqual({ ...wire, id: 7 });
  });

  it('jättää id:n pois kun wire ei sisällä sitä (uusi kohdennus)', () => {
    const k = decodeKohdennus({ tyyppi: 1, nimi: { fi: 'Myynti' } });
    expect(k).not.toHaveProperty('id');
    expect(k).not.toHaveProperty('kuuluu');
  });

  it('kuljettaa käyttömäärän lkm', () => {
    const k = decodeKohdennusKaytolla({ id: 1, tyyppi: 1, nimi: { fi: 'A' }, lkm: '4' });
    expect(k.lkm).toBe(4);
    expect(decodeKohdennusKaytolla({ id: 1, tyyppi: 1, nimi: { fi: 'A' } }).lkm).toBe(0);
    expect(encodeKohdennus(k)).toMatchObject({ lkm: 4 });
  });

  it('init kiertää kohdennukset koodekin läpi', () => {
    const kohdennus: Kohdennus = { id: 2, tyyppi: 3, nimi: { fi: 'Tapahtuma' } };
    const w = encodeInit({
      asetukset: {},
      tilit: [],
      tilikaudet: [],
      tositesarjat: [],
      kohdennukset: [kohdennus],
    });
    expect(w.kohdennukset).toEqual([kohdennus]);
    expect(decodeInit(w).kohdennukset).toEqual([kohdennus]);
  });
});

describe('budjettirivi codec', () => {
  it('kääntää sentit rahamerkkijonoksi ja takaisin', () => {
    const wire = encodeBudjettiRivi({ kohdennus: 2, tili: 3000, sentit: Euro.fromCents(-12345) });
    expect(wire).toEqual({ kohdennus: 2, tili: 3000, sentit: '-123.45' });
    expect(decodeBudjettiRivi(wire)).toEqual({
      kohdennus: 2,
      tili: 3000,
      sentit: Euro.fromCents(-12345),
    });
  });
});
