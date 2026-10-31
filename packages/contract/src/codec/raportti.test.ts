import type { RaporttiRivi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { WireRaporttiRiviSchema } from '../schema/wire.js';
import { decodeRaporttiRivi, encodeRaporttiRivi } from './raportti.js';

describe('raportti-koodekki', () => {
  it('koodaa arvon kanoniseksi "N.NN"-merkkijonoksi', () => {
    const rivi: RaporttiRivi = {
      teksti: 'Liikevaihto',
      sisennys: 1,
      lihava: true,
      arvo: Euro.fromCents(123_456),
    };
    expect(encodeRaporttiRivi(rivi)).toEqual({
      teksti: 'Liikevaihto',
      sisennys: 1,
      lihava: true,
      arvo: '1234.56',
    });
  });

  it('säilyttää null-arvon (otsikko/välirivi) ja tyhja-lipun', () => {
    const otsikko: RaporttiRivi = { teksti: 'VASTAAVAA', sisennys: 0, lihava: true, arvo: null };
    const tyhja: RaporttiRivi = { teksti: '', sisennys: 0, lihava: false, arvo: null, tyhja: true };
    expect(encodeRaporttiRivi(otsikko).arvo).toBeNull();
    expect(encodeRaporttiRivi(tyhja)).toEqual({
      teksti: '',
      sisennys: 0,
      lihava: false,
      arvo: null,
      tyhja: true,
    });
  });

  it('dekoodaa wire-rivin takaisin rikkaaksi (arvo -> Cents | null)', () => {
    const r = decodeRaporttiRivi({ teksti: 'Tulos', sisennys: 0, lihava: true, arvo: '1234.56' });
    expect(r.arvo).toBe(Euro.fromCents(123_456));
    expect(
      decodeRaporttiRivi({ teksti: 'x', sisennys: 0, lihava: false, arvo: null }).arvo,
    ).toBeNull();
  });

  it('kuljettaa erittelyrivin tilinumeron molempiin suuntiin', () => {
    const rivi: RaporttiRivi = {
      teksti: '4000 Ostot',
      sisennys: 3,
      lihava: false,
      arvo: Euro.fromCents(-2881),
      tili: 4000,
    };
    const w = encodeRaporttiRivi(rivi);
    expect(w).toEqual({
      teksti: '4000 Ostot',
      sisennys: 3,
      lihava: false,
      arvo: '-28.81',
      tili: 4000,
    });
    expect(WireRaporttiRiviSchema.parse(w)).toEqual(w);
    expect(decodeRaporttiRivi(w)).toEqual(rivi);
    expect('tili' in encodeRaporttiRivi({ ...rivi, tili: undefined } as RaporttiRivi)).toBe(false);
  });

  it('kuljettaa kaavarivi-indeksin (myös 0) molempiin suuntiin ja jättää sen pois, kun puuttuu', () => {
    const rivi: RaporttiRivi = {
      teksti: 'Myyntisaamiset',
      sisennys: 1,
      lihava: false,
      arvo: Euro.fromCents(100),
      kaavarivi: 0,
    };
    const w = encodeRaporttiRivi(rivi);
    expect(w).toEqual({
      teksti: 'Myyntisaamiset',
      sisennys: 1,
      lihava: false,
      arvo: '1.00',
      kaavarivi: 0,
    });
    expect(WireRaporttiRiviSchema.parse(w)).toEqual(w);
    expect(decodeRaporttiRivi(w)).toEqual(rivi);
    const ilman = encodeRaporttiRivi({ ...rivi, kaavarivi: undefined } as RaporttiRivi);
    expect('kaavarivi' in ilman).toBe(false);
  });

  it('kuljettaa kaavaLajin molempiin suuntiin ja hylkää tuntemattoman arvon', () => {
    const rivi: RaporttiRivi = {
      teksti: 'Tulos',
      sisennys: 0,
      lihava: true,
      arvo: Euro.fromCents(100),
      kaavarivi: 4,
      kaavaLaji: 'valisumma',
    };
    const w = encodeRaporttiRivi(rivi);
    expect(w.kaavaLaji).toBe('valisumma');
    expect(WireRaporttiRiviSchema.parse(w)).toEqual(w);
    expect(decodeRaporttiRivi(w)).toEqual(rivi);
    expect(WireRaporttiRiviSchema.safeParse({ ...w, kaavaLaji: 'muu' }).success).toBe(false);
  });
});
