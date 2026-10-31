import { lataaKartta } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import type { Leg } from './legit.js';
import { poimiTotuus } from './totuus.js';

const chart = lataaKartta([
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
  { numero: 4010, tyyppi: 'D', nimi: { fi: 'Ostot' } },
]);
const leg = (tili: number, debet: number, kredit: number, alvKoodi = 0, alvProsentti = 0): Leg => ({
  tili,
  debet,
  kredit,
  alvKoodi,
  alvProsentti,
});

describe('poimiTotuus', () => {
  it('poimii yhden kannan oston (netto + alv + pankki)', () => {
    const r = poimiTotuus(
      5,
      '2025-01-03',
      'Patreon',
      [leg(1910, 0, 1244), leg(1763, 244, 0, 21, 25.5), leg(4010, 1000, 0, 21, 25.5)],
      chart,
    );
    expect('totuus' in r).toBe(true);
    if (!('totuus' in r)) return;
    expect(r.totuus).toEqual({
      tositeId: 5,
      pvm: '2025-01-03',
      myyja: 'Patreon',
      brutto: 1244,
      alvYhteensa: 244,
      menot: [{ tili: 4010, netto: 1000, alvKoodi: 21, alvProsentti: 25.5 }],
    });
  });

  it('poimii alv 0% -oston ilman alv-riviä', () => {
    const r = poimiTotuus(6, '2025-01-03', 'EA', [leg(1910, 0, 1644), leg(4010, 1644, 0)], chart);
    if (!('totuus' in r)) throw new Error('odotettiin totuutta');
    expect(r.totuus.brutto).toBe(1644);
    expect(r.totuus.alvYhteensa).toBe(0);
    expect(r.totuus.menot).toEqual([{ tili: 4010, netto: 1644, alvKoodi: 0, alvProsentti: 0 }]);
  });

  it('merkitsee monimutkaiseksi jos pankkirivejä ei ole tasan yksi', () => {
    const r = poimiTotuus(7, '2025-01-07', 'X', [leg(4010, 1000, 0)], chart);
    expect(r).toEqual({ poissulku: 'monimutkainen' });
  });

  it('merkitsee monimutkaiseksi jos rivi on tuntemattomalla tilillä', () => {
    const r = poimiTotuus(8, '2025-01-07', 'X', [leg(1910, 0, 500), leg(9999, 500, 0)], chart);
    expect(r).toEqual({ poissulku: 'monimutkainen' });
  });

  it('poimii kaksi menoriviä eri alv-kannoilla kahdeksi erilliseksi MenoOdotukseksi', () => {
    const r = poimiTotuus(
      9,
      '2025-02-01',
      'Moniverokanta Oy',
      [
        leg(1910, 0, 3535),
        leg(1763, 255, 0, 21, 25.5),
        leg(4010, 1000, 0, 21, 25.5),
        leg(1763, 280, 0, 21, 14),
        leg(4010, 2000, 0, 21, 14),
      ],
      chart,
    );
    if (!('totuus' in r)) throw new Error('odotettiin totuutta');
    expect(r.totuus.brutto).toBe(3535);
    expect(r.totuus.alvYhteensa).toBe(535);
    expect(r.totuus.menot).toEqual([
      { tili: 4010, netto: 1000, alvKoodi: 21, alvProsentti: 25.5 },
      { tili: 4010, netto: 2000, alvKoodi: 21, alvProsentti: 14 },
    ]);
  });
});
