import { lataaKartta, normalisoiNimi } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { kylmaAsetukset, lamminAsetukset, opiSaannot } from './seed.js';
import type { Totuus } from './totuus.js';

const chart = lataaKartta([
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 4010, tyyppi: 'D', nimi: { fi: 'Ostot' } },
]);
const totuus = (tositeId: number, myyja: string, tili: number): Totuus => ({
  tositeId,
  pvm: '2025-01-01',
  myyja,
  brutto: 1000,
  alvYhteensa: 0,
  menot: [{ tili, netto: 1000, alvKoodi: 0, alvProsentti: 0 }],
});

describe('kylmaAsetukset', () => {
  it('ei sisällä menotilisääntöjä ja valitsee pankkitilin kartasta', () => {
    const a = kylmaAsetukset(chart);
    expect(a.menotiliSaannot).toEqual([]);
    expect(a.pankkitili).toBe(1910);
    expect(a.menotili).toBeUndefined();
  });
});

describe('opiSaannot (leave-one-out modaalitili)', () => {
  it('oppii myyjän yleisimmän menotilin muista tositteista, jättää testattavan pois', () => {
    const historia = [
      totuus(1, 'Patreon', 4010),
      totuus(2, 'Patreon', 4010),
      totuus(3, 'Patreon', 7000), // poisluettava — ei saa vaikuttaa
    ];
    const saannot = opiSaannot(historia, 3);
    expect(saannot).toEqual([{ hae: normalisoiNimi('Patreon'), tili: 4010 }]);
  });

  it('ei tuota sääntöä myyjälle joka esiintyy vain testattavassa tositteessa', () => {
    const saannot = opiSaannot([totuus(1, 'Kertaostos', 4010)], 1);
    expect(saannot).toEqual([]);
  });
});

describe('lamminAsetukset', () => {
  it('välittää opitut säännöt ja pankkitilin', () => {
    const saannot = [{ hae: 'patreon', tili: 4010 }];
    const a = lamminAsetukset(chart, saannot);
    expect(a.menotiliSaannot).toEqual(saannot);
    expect(a.pankkitili).toBe(1910);
  });
});
