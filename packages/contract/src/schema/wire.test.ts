import { describe, expect, it } from 'vitest';
import {
  WireAsetuksetPatchSchema,
  WireInitSchema,
  WireSaldotSchema,
  WireTiliSchema,
  WireTilikausiSchema,
  WireTositeSchema,
  WireTositeSyoteSchema,
  WireVientiSchema,
} from './wire.js';

describe('WireVientiSchema', () => {
  it('accepts a money-string vienti with nested era and extra keys', () => {
    const r = WireVientiSchema.safeParse({
      tili: 4000,
      pvm: '2026-03-15',
      debet: '100.00',
      alvkoodi: 9,
      alvprosentti: '25.50',
      era: { id: 42 },
      aalv: '+-', // unknown legacy key -> passthrough
    });
    expect(r.success).toBe(true);
  });
  it('accepts raw-number money too', () => {
    expect(
      WireVientiSchema.safeParse({ tili: 1900, pvm: '2026-03-15', kredit: 125.5 }).success,
    ).toBe(true);
  });
  it('rejects a vienti with no account', () => {
    expect(WireVientiSchema.safeParse({ pvm: '2026-03-15', debet: '1.00' }).success).toBe(false);
  });
});

describe('WireTositeSchema', () => {
  it('requires pvm + viennit array', () => {
    expect(
      WireTositeSchema.safeParse({
        pvm: '2026-03-15',
        tila: 100,
        viennit: [{ tili: 1900, pvm: '2026-03-15', debet: '1.00' }],
      }).success,
    ).toBe(true);
    expect(WireTositeSchema.safeParse({ tila: 100 }).success).toBe(false);
  });
});

describe('WireTositeSyoteSchema (write body)', () => {
  it('accepts a create body that omits tila', () => {
    expect(
      WireTositeSyoteSchema.safeParse({
        pvm: '2026-03-15',
        viennit: [{ tili: 1900, pvm: '2026-03-15', debet: '1.00' }],
      }).success,
    ).toBe(true);
  });
  it('still accepts a body with tila present', () => {
    expect(
      WireTositeSyoteSchema.safeParse({ pvm: '2026-03-15', tila: 100, viennit: [] }).success,
    ).toBe(true);
  });
});

describe('WireTiliSchema', () => {
  it('accepts a heading body without tyyppi (nimi only)', () => {
    expect(
      WireTiliSchema.safeParse({ numero: 100, nimi: { fi: 'PYSYVÄT VASTAAVAT' } }).success,
    ).toBe(true);
  });
  it('still accepts a full account body', () => {
    expect(
      WireTiliSchema.safeParse({ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } }).success,
    ).toBe(true);
  });
});

describe('WireSaldotSchema', () => {
  it('is a record of account -> string|number', () => {
    expect(WireSaldotSchema.safeParse({ '1900': '1500.00', '3999': 3450 }).success).toBe(true);
  });
});

describe('WireAsetuksetPatchSchema', () => {
  it('allows null values (delete) and string values', () => {
    expect(WireAsetuksetPatchSchema.safeParse({ Nimi: 'Oy', Vanha: null }).success).toBe(true);
  });
});

describe('WireInitSchema / WireTilikausiSchema', () => {
  it('validate the init bundle and a fiscal year', () => {
    expect(
      WireTilikausiSchema.safeParse({ alkaa: '2025-01-01', loppuu: '2025-12-31' }).success,
    ).toBe(true);
    expect(
      WireInitSchema.safeParse({
        asetukset: { Nimi: 'Oy' },
        tilit: [{ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } }],
        tilikaudet: [{ alkaa: '2025-01-01', loppuu: '2025-12-31' }],
        tositesarjat: [''],
        kohdennukset: [],
        kierrot: [],
      }).success,
    ).toBe(true);
  });
});
