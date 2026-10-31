import { lataaKartta } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { type Leg, luokitteleLegit } from './legit.js';

// Minimal chart: bank (ARP→PANKKITILI), VAT receivable (AL→ALVSAATAVA), expense (D→MENO).
const chart = lataaKartta([
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
  { numero: 4010, tyyppi: 'D', nimi: { fi: 'Ostot' } },
]);

const leg = (tili: number, debet: number, kredit: number): Leg => ({
  tili,
  debet,
  kredit,
  alvKoodi: 0,
  alvProsentti: 0,
});

describe('luokitteleLegit', () => {
  it('luokittelee pankki-, alv- ja menorivit tilin luonteen mukaan', () => {
    const r = luokitteleLegit([leg(1910, 0, 1244), leg(1763, 244, 0), leg(4010, 1000, 0)], chart);
    expect(r.pankki.map((l) => l.tili)).toEqual([1910]);
    expect(r.alv.map((l) => l.tili)).toEqual([1763]);
    expect(r.menot.map((l) => l.tili)).toEqual([4010]);
    expect(r.muu).toEqual([]);
  });

  it('sijoittaa tunnistamattoman tilin muu-luokkaan', () => {
    const r = luokitteleLegit([leg(9999, 500, 0)], chart);
    expect(r.muu.map((l) => l.tili)).toEqual([9999]);
    expect(r.menot).toEqual([]);
  });
});
