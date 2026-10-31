import { AlvKoodi, type TositeVienti } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { kirjausYhteenveto } from './kirjauksenSuunta.js';

const c = (n: number): Cents => n as Cents;
const v = (tili: number, debet: number, kredit: number): TositeVienti => ({
  tili,
  debet: c(debet),
  kredit: c(kredit),
  pvm: '2026-07-01',
  alvKoodi: AlvKoodi.EIALV,
  alvProsentti: 0,
});

describe('kirjausYhteenveto', () => {
  it('kredit on "mistä" ja debet "mihin"', () => {
    expect(kirjausYhteenveto([v(2365, 323020, 0), v(1910, 0, 323020)])).toEqual({
      mista: [{ tili: 1910, summa: 323020 }],
      mihin: [{ tili: 2365, summa: 323020 }],
    });
  });

  it('yhdistää saman tilin viennit ja järjestää suurimman ensin', () => {
    expect(
      kirjausYhteenveto([v(4000, 1000, 0), v(1763, 255, 0), v(4000, 500, 0), v(1910, 0, 1755)]),
    ).toEqual({
      mista: [{ tili: 1910, summa: 1755 }],
      mihin: [
        { tili: 4000, summa: 1500 },
        { tili: 1763, summa: 255 },
      ],
    });
  });

  it('ohittaa nollaviennit', () => {
    expect(kirjausYhteenveto([v(4000, 0, 0)])).toEqual({ mista: [], mihin: [] });
  });
});
