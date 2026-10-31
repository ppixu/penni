import type { StoredTosite, Tosite } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  decodeListattuTosite,
  decodeTosite,
  encodeListattuTosite,
  encodeTosite,
} from './tosite.js';

const c = (n: number) => Euro.fromCents(n);

const voucher: Tosite & { id: number } = {
  id: 1234,
  pvm: '2026-03-15',
  tyyppi: 100,
  tila: 100,
  tunniste: 87,
  sarja: 'A',
  otsikko: 'Toimistotarvikkeet',
  kumppani: 42,
  viite: '13245',
  viennit: [
    {
      tili: 4000,
      debet: c(10000),
      kredit: c(0),
      pvm: '2026-03-15',
      alvKoodi: 9,
      alvProsentti: 25.5,
    },
    { tili: 1900, debet: c(0), kredit: c(10000), pvm: '2026-03-15', alvKoodi: 0, alvProsentti: 0 },
  ],
};

describe('encodeTosite', () => {
  it('nests kumppani as {id}, encodes viennit, omits empty scalars, always emits tila', () => {
    const w = encodeTosite(voucher);
    expect(w).toMatchObject({
      id: 1234,
      pvm: '2026-03-15',
      tyyppi: 100,
      tila: 100,
      tunniste: 87,
      sarja: 'A',
      otsikko: 'Toimistotarvikkeet',
      kumppani: { id: 42 },
      viite: '13245',
    });
    expect(w.viennit).toHaveLength(2);
    expect(w.viennit[0]).toMatchObject({
      tili: 4000,
      debet: '100.00',
      alvkoodi: 9,
      alvprosentti: '25.50',
    });
    expect(w.viennit[1]).toMatchObject({ tili: 1900, kredit: '100.00' });
    expect('rivit' in w).toBe(false); // omitted when absent
  });

  it('always emits tila even when 0 (POISTETTU)', () => {
    const w = encodeTosite({ ...voucher, tila: 0 });
    expect(w.tila).toBe(0);
  });

  it('omits zero tyyppi/tunniste and empty sarja', () => {
    const w = encodeTosite({ ...voucher, tyyppi: 0, tunniste: 0, sarja: '' });
    expect('tyyppi' in w).toBe(false);
    expect('tunniste' in w).toBe(false);
    expect('sarja' in w).toBe(false);
  });
});

describe('decodeTosite', () => {
  it('reconstitutes defaults for absent scalars and unwraps kumppani', () => {
    const t = decodeTosite({
      pvm: '2026-03-15',
      tila: 100,
      viennit: [{ tili: 1900, debet: '5.00', pvm: '2026-03-15' }],
    });
    expect(t).toMatchObject({ pvm: '2026-03-15', tyyppi: 0, tila: 100, tunniste: 0, sarja: '' });
    expect(t.viennit[0]?.debet).toBe(500);
    expect('kumppani' in t).toBe(false);
  });

  it('defaults tila to 100 when absent (legacy DB default)', () => {
    const t = decodeTosite({ pvm: '2026-03-15', viennit: [] });
    expect(t.tila).toBe(100);
  });
});

describe('round-trip', () => {
  it('decode(encode(voucher)) preserves the voucher (incl. id)', () => {
    expect(decodeTosite(encodeTosite(voucher))).toEqual(voucher);
  });

  it('preserves alkuperainenTosite (hyvityslasku: credited original voucher id)', () => {
    const hyvitys: Tosite & { id: number } = { ...voucher, alkuperainenTosite: 7 };
    expect(decodeTosite(encodeTosite(hyvitys)).alkuperainenTosite).toBe(7);
  });

  it('preserves info (Kitsaksen vapaamuotoiset lisätiedot)', () => {
    const w = encodeTosite({ ...voucher, info: 'Muista karhuta' });
    expect(w.info).toBe('Muista karhuta');
    expect(decodeTosite(w).info).toBe('Muista karhuta');
  });

  it('round-trips tiliote (saldot euroina langalla, sentteinä sisällä)', () => {
    const t = {
      pvm: '2026-09-30',
      tyyppi: 400,
      tila: 100,
      tunniste: 0,
      sarja: '',
      viennit: [],
      tiliote: {
        tili: 1910,
        alkupvm: '2026-09-01',
        loppupvm: '2026-09-30',
        iban: 'FI2112345600000785',
        alkusaldo: 123_456 as Cents,
        loppusaldo: -5_00 as Cents,
      },
    };
    const w = encodeTosite(t);
    expect(w.tiliote).toEqual({
      tili: 1910,
      alkupvm: '2026-09-01',
      loppupvm: '2026-09-30',
      iban: 'FI2112345600000785',
      alkusaldo: '1234.56',
      loppusaldo: '-5.00',
    });
    expect(decodeTosite(w).tiliote).toEqual(t.tiliote);
  });

  it('lukee Kitsaksen tiliote-kartan (tili merkkijonona, ei saldoja)', () => {
    const t = decodeTosite({
      pvm: '2026-09-30',
      tila: 100,
      viennit: [],
      tiliote: { tili: '1910', alkupvm: '2026-09-01', loppupvm: '2026-09-30' },
    });
    expect(t.tiliote).toEqual({ tili: 1910, alkupvm: '2026-09-01', loppupvm: '2026-09-30' });
  });

  it('round-trips marginaalialijaama', () => {
    const t = {
      pvm: '2026-06-30',
      tyyppi: 9105,
      tila: 100,
      tunniste: 1,
      sarja: '',
      viennit: [],
      marginaalialijaama: { '25.50': 20000 },
    } as StoredTosite;
    expect(decodeTosite(encodeTosite(t)).marginaalialijaama?.['25.50']).toBe(20000);
  });
});

describe('listattu tosite (liitteita)', () => {
  it('lisää liitemäärän tositteen langalle ja purkaa sen takaisin', () => {
    const listattu = { ...voucher, liitteita: 3 };
    const w = encodeListattuTosite(listattu);
    expect(w.liitteita).toBe(3);
    expect(decodeListattuTosite(w)).toEqual(listattu);
  });

  it('nolla kulkee langalla, puuttuva tulkitaan nollaksi', () => {
    expect(encodeListattuTosite({ ...voucher, liitteita: 0 }).liitteita).toBe(0);
    expect(decodeListattuTosite(encodeTosite(voucher)).liitteita).toBe(0);
  });

  it('kuljettaa alkuperän listarivillä', () => {
    const listattu = { ...voucher, liitteita: 1, alkupera: 'muu' as const };
    const w = encodeListattuTosite(listattu);
    expect(w.alkupera).toBe('muu');
    expect(decodeListattuTosite(w)).toEqual(listattu);
    expect('alkupera' in encodeListattuTosite({ ...voucher, liitteita: 0 })).toBe(false);
  });

  it('yksittäisen tositteen koodekki ei lisää liitteita-avainta', () => {
    expect('liitteita' in encodeTosite(voucher)).toBe(false);
  });
});
