import { type Cents, Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  ilmoitinKausi,
  muodostaIlmoitinAineisto,
  muotoileVeroSumma,
  omaVeroTayttoapu,
} from './omaVero.js';

const c = (n: number): Cents => Euro.fromCents(n);
const kartta = (parit: [number, number][]) =>
  new Map<number, Cents>(parit.map(([k, snt]) => [k, c(snt)]));

/** Keksitty neljännes (ei oikeaa dataa): 301/305/307/313 + maksettava. */
const Q3 = {
  alkupvm: '2026-07-01',
  loppupvm: '2026-09-30',
  kausityyppi: 'Q' as const,
  koodit: kartta([
    [301, 610_655],
    [305, 32_699],
    [307, 34_814],
    [308, 608_540],
    [313, 128_231],
  ]),
  maksettava: c(608_540),
};

describe('muotoileVeroSumma', () => {
  it('desimaalipilkku, kaksi desimaalia, ei tuhaterotinta eikä €-merkkiä', () => {
    expect(muotoileVeroSumma(c(610_655))).toBe('6106,55');
    expect(muotoileVeroSumma(c(123_456_789))).toBe('1234567,89');
    expect(muotoileVeroSumma(c(5))).toBe('0,05');
    expect(muotoileVeroSumma(c(0))).toBe('0,00');
    expect(muotoileVeroSumma(c(-1_230))).toBe('-12,30');
  });
});

describe('omaVeroTayttoapu', () => {
  it('ryhmät ja kentät OmaVeron järjestyksessä, vain täytettävät kentät', () => {
    const apu = omaVeroTayttoapu(Q3);
    expect(apu.eiToimintaa).toBe(false);
    expect(apu.ryhmat.map((r) => r.otsikko)).toEqual([
      'Vero kotimaan myynnistä verokannoittain',
      'Vero ostoista ja maahantuonneista',
      'Vähennettävä vero',
      'Maksettava vero tai palautukseen oikeuttava vero',
      'Myynnit, ostot ja maahantuonnit',
    ]);
    const rivit = apu.ryhmat.flatMap((r) => r.rivit.map((x) => [x.nimi, x.syote, x.laskettu]));
    expect(rivit).toEqual([
      ['25,5 %:n vero', '6106,55', false],
      ['Vero tavaraostoista muista EU-maista', '326,99', false],
      ['Verokauden vähennettävä vero', '348,14', false],
      ['Maksettava vero', '6085,40', true],
      ['Tavaraostot muista EU-maista', '1282,31', false],
    ]);
  });

  it('negatiivinen lopputulos on "Palautukseen oikeuttava vero"', () => {
    const apu = omaVeroTayttoapu({
      koodit: kartta([
        [307, 5_000],
        [308, -5_000],
      ]),
      maksettava: c(-5_000),
    });
    const r308 = apu.ryhmat.flatMap((r) => r.rivit).find((r) => r.koodi === 308);
    expect(r308).toMatchObject({ nimi: 'Palautukseen oikeuttava vero', syote: '-50,00' });
  });

  it('pakollinen 0,00: 313 ilman 305:tä ja 314 ilman 306:ta (tarkistukset #1144/#1146)', () => {
    const apu = omaVeroTayttoapu({
      koodit: kartta([
        [313, 10_000],
        [314, 20_000],
      ]),
      maksettava: c(0),
    });
    const ostot = apu.ryhmat.find((r) => r.otsikko === 'Vero ostoista ja maahantuonneista');
    expect(ostot?.rivit.map((r) => [r.koodi, r.syote])).toEqual([
      [305, '0,00'],
      [306, '0,00'],
    ]);
    // Lopputulos 0,00 näytetään silti (ei-tyhjä ilmoitus).
    const r308 = apu.ryhmat.flatMap((r) => r.rivit).find((r) => r.koodi === 308);
    expect(r308?.syote).toBe('0,00');
  });

  it('tyhjä koodikartta → Ei toimintaa, ei kenttiä', () => {
    expect(omaVeroTayttoapu({ koodit: new Map(), maksettava: c(0) })).toEqual({
      eiToimintaa: true,
      ryhmat: [],
    });
  });
});

describe('ilmoitinKausi', () => {
  it('K/Q/V kalenteriyksiköstä; vajaa ensimmäinen kausi kelpaa', () => {
    expect(ilmoitinKausi('2026-03-01', '2026-03-31', 'K')).toEqual({
      pituus: 'K',
      kausi: 3,
      vuosi: 2026,
    });
    expect(ilmoitinKausi('2026-03-15', '2026-03-31', 'K')).toEqual({
      pituus: 'K',
      kausi: 3,
      vuosi: 2026,
    });
    expect(ilmoitinKausi('2026-07-01', '2026-09-30', 'Q')).toEqual({
      pituus: 'Q',
      kausi: 3,
      vuosi: 2026,
    });
    expect(ilmoitinKausi('2026-08-15', '2026-09-30', 'Q')).toEqual({
      pituus: 'Q',
      kausi: 3,
      vuosi: 2026,
    });
    expect(ilmoitinKausi('2026-01-01', '2026-12-31', 'V')).toEqual({ pituus: 'V', vuosi: 2026 });
  });
  it('rajat ylittävä kausi → null', () => {
    expect(ilmoitinKausi('2026-03-15', '2026-04-14', 'K')).toBeNull();
    expect(ilmoitinKausi('2026-06-01', '2026-08-31', 'Q')).toBeNull();
    expect(ilmoitinKausi('2025-12-01', '2026-11-30', 'V')).toBeNull();
  });
});

describe('muodostaIlmoitinAineisto', () => {
  it('tietuekuvauksen VSRALVKV v1.10 esimerkki 1 (Ei toimintaa) merkilleen', () => {
    // Tietuekuvauksen omat esimerkkitunnukset (Verohallinnon keksimät testiarvot).
    const aineisto = muodostaIlmoitinAineisto(
      {
        alkupvm: '2025-01-01',
        loppupvm: '2025-01-31',
        kausityyppi: 'K',
        koodit: new Map(),
        maksettava: c(0),
      },
      {
        ytunnus: '6612663-4',
        aikaleima: '2025-06-14T20:30:15',
        ohjelmisto: 'TestiAccounting Pro',
        ohjelmistotunniste: '6606611-7_AP',
        puhelin: '09-1234567',
      },
    );
    expect(aineisto).toBe(
      [
        '000:VSRALVKV',
        '198:14062025203015',
        '048:TestiAccounting Pro',
        '014:6606611-7_AP',
        '010:6612663-4',
        '050:K',
        '052:1',
        '053:2025',
        '056:1',
        '042:09-1234567',
        '999:1',
      ].join('\r\n'),
    );
  });

  it('tietuekuvauksen esimerkin 2 summat (ilman 2024 päättyneitä 315–317) ja pakolliset nollat', () => {
    const aineisto = muodostaIlmoitinAineisto(
      {
        alkupvm: '2024-01-01',
        loppupvm: '2024-01-31',
        kausityyppi: 'K',
        // 305/306 puuttuvat kartasta (nollia) → annetaan 0,00, koska 313/314 on annettu.
        koodit: kartta([
          [301, 7_777_777],
          [302, 1_111_111],
          [303, 99],
          [304, 2_499],
          [307, 2_000_000],
          [308, 5_915_486],
          [309, 1],
          [310, 24_000],
          [311, 9],
          [312, 123_456_789_012_312],
          [313, 2_222_222],
          [314, 999_999],
          [318, 24_000],
          [319, 123_456_789_012_319],
          [320, 100_000],
        ]),
        maksettava: c(5_915_486),
      },
      {
        ytunnus: '6606773-4',
        aikaleima: '2024-11-11T11:22:33',
        ohjelmisto: 'AccountingPro',
        ohjelmistotunniste: '6612663-4_AP',
        puhelin: '09 1234567',
      },
    );
    expect(aineisto.split('\r\n')).toEqual([
      '000:VSRALVKV',
      '198:11112024112233',
      '048:AccountingPro',
      '014:6612663-4_AP',
      '010:6606773-4',
      '050:K',
      '052:1',
      '053:2024',
      '301:77777,77',
      '302:11111,11',
      '303:0,99',
      '304:24,99',
      '305:0,00',
      '306:0,00',
      '307:20000,00',
      '308:59154,86',
      '309:0,01',
      '310:240,00',
      '311:0,09',
      '312:1234567890123,12',
      '313:22222,22',
      '314:9999,99',
      '318:240,00',
      '319:1234567890123,19',
      '320:1000,00',
      '042:09 1234567',
      '999:1',
    ]);
  });

  it('neljännes: 052 = vuosineljännes, oletusohjelmisto Penni ja 014 = oma Y-tunnus + _PE', () => {
    const aineisto = muodostaIlmoitinAineisto(Q3, {
      ytunnus: '1234567-1',
      aikaleima: '2026-10-10T09:05:00',
    });
    expect(aineisto.split('\r\n')).toEqual([
      '000:VSRALVKV',
      '198:10102026090500',
      '048:Penni',
      '014:1234567-1_PE',
      '010:1234567-1',
      '050:Q',
      '052:3',
      '053:2026',
      '301:6106,55',
      '305:326,99',
      '307:348,14',
      '308:6085,40',
      '313:1282,31',
      '999:1',
    ]);
    expect(aineisto.endsWith('999:1')).toBe(true);
  });

  it('vuosikausi: ei 052-tietoa', () => {
    const aineisto = muodostaIlmoitinAineisto(
      { ...Q3, alkupvm: '2026-01-01', loppupvm: '2026-12-31', kausityyppi: 'V' },
      { ytunnus: '1234567-1', aikaleima: '2027-02-01T12:00:00' },
    );
    expect(aineisto).toContain('050:V\r\n053:2026\r\n');
    expect(aineisto).not.toContain('052:');
  });

  it('hylkää virheellisen Y-tunnuksen, kauden ja aikaleiman', () => {
    const perus = { ytunnus: '1234567-1', aikaleima: '2026-10-10T09:05:00' };
    expect(() => muodostaIlmoitinAineisto(Q3, { ...perus, ytunnus: '1234567-8' })).toThrow(
      /Y-tunnus/,
    );
    expect(() => muodostaIlmoitinAineisto({ ...Q3, alkupvm: '2026-06-01' }, perus)).toThrow(
      /neljännes/,
    );
    expect(() => muodostaIlmoitinAineisto(Q3, { ...perus, aikaleima: '10.10.2026' })).toThrow(
      /aikaleima/,
    );
    expect(() => muodostaIlmoitinAineisto(Q3, { ...perus, ohjelmisto: 'Pénni' })).toThrow(/048/);
  });
});
