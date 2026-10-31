import type { TositeVienti } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { decodeVienti, encodeVienti } from './vienti.js';

const c = (n: number) => Euro.fromCents(n);

describe('encodeVienti', () => {
  it('emits debet as a money string, omits the zero counter-side, nests era, renames VAT keys', () => {
    const v: TositeVienti = {
      tili: 4000,
      debet: c(10000),
      kredit: c(0),
      pvm: '2026-03-15',
      alvKoodi: 9,
      alvProsentti: 25.5,
      kohdennus: 3,
      era: 42,
      selite: 'Toimistotarvikkeet',
    };
    expect(encodeVienti(v)).toEqual({
      tili: 4000,
      pvm: '2026-03-15',
      debet: '100.00',
      alvkoodi: 9,
      alvprosentti: '25.50',
      kohdennus: 3,
      era: { id: 42 },
      selite: 'Toimistotarvikkeet',
    });
  });

  it('omits zero amount / zero VAT / unset optionals', () => {
    const v: TositeVienti = {
      tili: 1900,
      debet: c(0),
      kredit: c(12550),
      pvm: '2026-03-15',
      alvKoodi: 0,
      alvProsentti: 0,
    };
    expect(encodeVienti(v)).toEqual({ tili: 1900, pvm: '2026-03-15', kredit: '125.50' });
  });
});

describe('decodeVienti', () => {
  it('parses money strings, defaults absent fields, unwraps era', () => {
    expect(
      decodeVienti({
        tili: 4000,
        pvm: '2026-03-15',
        debet: '100.00',
        alvkoodi: 9,
        alvprosentti: '25.50',
        era: { id: 42 },
      }),
    ).toEqual({
      tili: 4000,
      debet: c(10000),
      kredit: c(0),
      pvm: '2026-03-15',
      alvKoodi: 9,
      alvProsentti: 25.5,
      era: 42,
    });
  });

  it('accepts raw-number money (legacy double) on decode', () => {
    const v = decodeVienti({ tili: 1900, pvm: '2026-03-15', kredit: 125.5 });
    expect(v.kredit).toBe(12550);
    expect(v.debet).toBe(0);
    expect(v.alvKoodi).toBe(0);
  });
});

describe('round-trip', () => {
  it('decode(encode(v)) preserves a vienti', () => {
    const v: TositeVienti = {
      tili: 3000,
      debet: c(0),
      kredit: c(99999),
      pvm: '2026-06-01',
      alvKoodi: 1,
      alvProsentti: 25.5,
      kohdennus: 7,
      tyyppi: 200,
      selite: 'Myynti',
    };
    expect(decodeVienti(encodeVienti(v))).toEqual(v);
  });
});

describe('vienti codec — maksuperusteinenTosite', () => {
  it('round-trips maksuperusteinenTosite', () => {
    const v = {
      tili: 2939,
      debet: c(2550),
      kredit: c(0),
      pvm: '2026-06-30',
      alvKoodi: 118,
      alvProsentti: 25.5,
      maksuperusteinenTosite: 42,
    } as TositeVienti;
    expect(decodeVienti(encodeVienti(v)).maksuperusteinenTosite).toBe(42);
  });
});

describe('vienti codec — jakso fields', () => {
  it('round-trips jaksoalkaa / jaksoloppuu / jaksotustili', () => {
    const v: TositeVienti = {
      tili: 4000,
      debet: c(120_000),
      kredit: c(0),
      pvm: '2026-11-01',
      alvKoodi: 0,
      alvProsentti: 0,
      jaksoalkaa: '2026-11-01',
      jaksoloppuu: '2027-10-31',
      jaksotustili: 1774,
    };
    const w = encodeVienti(v);
    expect(w.jaksoalkaa).toBe('2026-11-01');
    expect(w.jaksoloppuu).toBe('2027-10-31');
    expect(w.jaksotustili).toBe(1774);
    expect(decodeVienti(w)).toEqual(v);
  });

  it('omits jakso fields when absent', () => {
    const v: TositeVienti = {
      tili: 4000,
      debet: c(100),
      kredit: c(0),
      pvm: '2026-01-01',
      alvKoodi: 0,
      alvProsentti: 0,
    };
    const w = encodeVienti(v);
    expect(w.jaksoalkaa).toBeUndefined();
    expect(w.jaksoloppuu).toBeUndefined();
    expect(w.jaksotustili).toBeUndefined();
    expect(decodeVienti(w)).toEqual(v);
  });
});

describe('vienti codec — Kitsas-tuonnin rivikohtaiset tiedot', () => {
  it('kuljettaa kumppanin Kitsaksen tapaan oliona ja muut kentät sellaisinaan', () => {
    const v: TositeVienti = {
      tili: 1701,
      debet: c(0),
      kredit: c(5000),
      pvm: '2026-03-20',
      alvKoodi: 0,
      alvProsentti: 0,
      kumppani: 7,
      arkistotunnus: 'ARK123',
      viite: 'RF471234',
      tasaerapoisto: 36,
    };
    const w = encodeVienti(v);
    expect(w.kumppani).toEqual({ id: 7 });
    expect(decodeVienti(w)).toEqual(v);
  });

  it('hyväksyy kumppanin myös pelkkänä numerona', () => {
    expect(decodeVienti({ tili: 1701, pvm: '2026-03-20', kumppani: 7 }).kumppani).toBe(7);
  });
});
