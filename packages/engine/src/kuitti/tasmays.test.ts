import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import type { Kuitti } from './kuitti.js';
import { tasmaa } from './tasmays.js';

function kuitti(osat: Partial<Kuitti>): Kuitti {
  return { valuutta: 'EUR', alv: [], ...osat };
}

describe('tasmaa', () => {
  it('täsmää kun Σnetto+Σvero == bruttoSumma ja kanta sallittu', () => {
    const t = tasmaa(
      kuitti({
        bruttoSumma: Euro.fromString('24.90'),
        alv: [{ kanta: 25.5, netto: Euro.fromString('19.84'), vero: Euro.fromString('5.06') }],
      }),
    );
    expect(t.tasmaa).toBe(true);
    expect(t.erotusSnt).toBe(0);
    expect(t.kannatKelpo).toBe(true);
    expect(t.puutteita).toBe(false);
  });

  it('summaa useita verokantoja', () => {
    const t = tasmaa(
      kuitti({
        bruttoSumma: Euro.fromString('30.00'),
        alv: [
          { kanta: 14, brutto: Euro.fromString('10.00') },
          { kanta: 25.5, brutto: Euro.fromString('20.00') },
        ],
      }),
    );
    expect(t.tasmaa).toBe(true);
  });

  it('ei täsmää kun summat eivät kohtaa', () => {
    const t = tasmaa(
      kuitti({
        bruttoSumma: Euro.fromString('30.00'),
        alv: [{ kanta: 25.5, brutto: Euro.fromString('24.90') }],
      }),
    );
    expect(t.tasmaa).toBe(false);
    expect(t.erotusSnt).not.toBe(0);
  });

  it('merkitsee tuntemattoman kannan', () => {
    const t = tasmaa(
      kuitti({
        bruttoSumma: Euro.fromString('10.00'),
        alv: [{ kanta: 17, brutto: Euro.fromString('10.00') }],
      }),
    );
    expect(t.kannatKelpo).toBe(false);
  });

  it('merkitsee puutteet kun bruttoSumma tai erittely puuttuu', () => {
    expect(
      tasmaa(kuitti({ alv: [{ kanta: 25.5, brutto: Euro.fromString('10.00') }] })).puutteita,
    ).toBe(true);
    expect(tasmaa(kuitti({ bruttoSumma: Euro.fromString('10.00') })).puutteita).toBe(true);
  });
});
