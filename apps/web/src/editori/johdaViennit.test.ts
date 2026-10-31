import { AlvKoodi, type Tili, lataaKartta } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { johdaViennit } from './johdaViennit.js';
import type { VientiRivi } from './types.js';

const c = (n: number): Cents => n as Cents;
const CHART: Tili[] = lataaKartta([
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
]);
function rivi(y: Partial<VientiRivi>): VientiRivi {
  return {
    avain: y.avain ?? 'r',
    debetSnt: c(0),
    kreditSnt: c(0),
    alvKoodi: 0,
    alvProsentti: 0,
    bruttoSyotto: true,
    ...y,
  };
}

describe('johdaViennit', () => {
  it('ei-verolliset rivit läpi sellaisenaan', () => {
    const v = johdaViennit([rivi({ tili: 1900, debetSnt: c(10000) })], CHART, '2026-03-01');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ tili: 1900, debet: 10000 });
  });

  it('verollinen osto (netto, brutto-syöttö) tuottaa netto + ALV-vähennys', () => {
    const rows = [
      rivi({
        avain: 'a',
        tili: 4000,
        debetSnt: c(12550),
        alvKoodi: AlvKoodi.OSTOT_NETTO,
        alvProsentti: 25.5,
      }),
      rivi({ avain: 'b', tili: 1900, kreditSnt: c(12550) }),
    ];
    const v = johdaViennit(rows, CHART, '2026-03-01');
    // 4000 debet 10000 + 1763 debet 2550 + 1900 kredit 12550 = balanced
    const debet = v.reduce((s, x) => s + x.debet, 0);
    const kredit = v.reduce((s, x) => s + x.kredit, 0);
    expect(debet).toBe(kredit);
    expect(v.find((x) => x.tili === 1763)).toMatchObject({ debet: 2550, alvKoodi: 221 });
  });

  it('tyhjät/keskeneräiset rivit pudotetaan', () => {
    // tili puuttuu (ei asetettu) JA summa 0 => rivi pudotetaan.
    const v = johdaViennit([rivi({ debetSnt: c(0) })], CHART, '2026-03-01');
    expect(v).toHaveLength(0);
  });
});
