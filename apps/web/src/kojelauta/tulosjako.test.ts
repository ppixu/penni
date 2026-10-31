import { lataaKartta } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { MUUT, muotoileEuroPyorea, muotoileOsuus, tulosjako } from './tulosjako.js';

const KARTTA = lataaKartta([
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 3, tyyppi: 'H1', nimi: { fi: 'Tuloslaskelma' } },
  { numero: 3, tyyppi: 'H2', nimi: { fi: 'Myyntituotot' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 3300, tyyppi: 'CL', nimi: { fi: 'Komissiomyynti' } },
  { numero: 4, tyyppi: 'H2', nimi: { fi: 'Materiaalit ja palvelut' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  { numero: 5, tyyppi: 'H2', nimi: { fi: 'Henkilöstökulut' } },
  { numero: 6100, tyyppi: 'D', nimi: { fi: 'YEL-maksut' } },
  { numero: 6410, tyyppi: 'D', nimi: { fi: 'Työttömyysvakuutusmaksut' } },
  { numero: 70, tyyppi: 'H2', nimi: { fi: 'Liiketoiminnan muut kulut' } },
  { numero: 7690, tyyppi: 'D', nimi: { fi: 'Atk-laitteet' } },
  { numero: 8380, tyyppi: 'D', nimi: { fi: 'Taloushallinto' } },
]);

const saldot = (rivit: Record<number, number>) =>
  new Map(Object.entries(rivit).map(([n, s]) => [Number(n), s as Cents]));

const SALDOT = saldot({
  1910: 5_000_00,
  3000: 75_000_00,
  3300: 200_00,
  4000: -1_000_00,
  6100: -5_800_00,
  6410: -200_00,
  7690: -1_600_00,
  8380: -400_00,
});

describe('tulosjako', () => {
  it('kokoaa kulut H2-pääryhmittäin suurimmasta pienimpään, tase ei mukana', () => {
    const j = tulosjako(KARTTA, SALDOT, 'paaryhma', 6);
    expect(j.kulut).toEqual([
      { avain: 'H5', nimi: 'Henkilöstökulut', summa: 6_000_00 },
      { avain: 'H70', nimi: 'Liiketoiminnan muut kulut', summa: 2_000_00 },
      { avain: 'H4', nimi: 'Materiaalit ja palvelut', summa: 1_000_00 },
    ]);
    expect(j.tulos).toBe(75_200_00 - 9_000_00);
  });

  it('puoli, jolla on vain yksi pääryhmä, näytetään tileittäin', () => {
    const j = tulosjako(KARTTA, SALDOT, 'paaryhma', 6);
    expect(j.tulot.map((e) => e.nimi)).toEqual(['Myynti', 'Komissiomyynti']);
  });

  it('tileittäin ja ylimenevät erät Muut-erään', () => {
    const j = tulosjako(KARTTA, SALDOT, 'tili', 3);
    expect(j.kulut).toEqual([
      { avain: '6100', nimi: 'YEL-maksut', summa: 5_800_00 },
      { avain: '7690', nimi: 'Atk-laitteet', summa: 1_600_00 },
      { avain: MUUT, nimi: 'Muut kulut', summa: 1_600_00 },
    ]);
    expect(j.tulos).toBe(75_200_00 - 9_000_00);
  });

  it('ryhmän puoli ratkeaa nettosummasta (palkkakorvaus pienentää kuluja)', () => {
    const j = tulosjako(
      KARTTA,
      saldot({ 3000: 100_00, 4000: -100_00, 6100: -500_00, 6410: 200_00 }),
      'paaryhma',
      6,
    );
    expect(j.kulut).toEqual([
      { avain: 'H5', nimi: 'Henkilöstökulut', summa: 300_00 },
      { avain: 'H4', nimi: 'Materiaalit ja palvelut', summa: 100_00 },
    ]);
    expect(j.tulot.map((e) => e.avain)).toEqual(['3000']);
    expect(j.tulos).toBe(-300_00);
  });

  it('tileiksi avatun ryhmän vastamerkkinen tili siirtyy toiselle puolelle', () => {
    const j = tulosjako(
      KARTTA,
      saldot({ 3000: 100_00, 6100: -500_00, 6410: 200_00 }),
      'paaryhma',
      6,
    );
    expect(j.kulut).toEqual([{ avain: '6100', nimi: 'YEL-maksut', summa: 500_00 }]);
    expect(j.tulot.map((e) => e.avain)).toEqual(['6410', '3000']);
    expect(j.tulos).toBe(-200_00);
  });

  it('tyhjä kausi', () => {
    expect(tulosjako(KARTTA, new Map(), 'paaryhma', 6)).toEqual({ tulot: [], kulut: [], tulos: 0 });
  });
});

describe('muotoilu', () => {
  it('tasaeurot ja osuudet', () => {
    expect(muotoileEuroPyorea(7_546_463 as Cents)).toBe('75 465 €');
    expect(muotoileEuroPyorea(-49 as Cents)).toBe('0 €');
    expect(muotoileOsuus(1, 1000)).toBe('<1 %');
    expect(muotoileOsuus(250, 1000)).toBe('25 %');
  });
});
