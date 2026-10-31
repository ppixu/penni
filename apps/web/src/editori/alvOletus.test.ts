import { lataaTili } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { bruttoSyottoKoodille, tilinAlvOletus } from './alvOletus.js';

const tili = (data: Record<string, unknown>) =>
  lataaTili({ numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' }, ...data });

describe('bruttoSyottoKoodille', () => {
  it('käänteinen alv -> netto-syöttö, muut -> brutto', () => {
    for (const k of [24, 25, 26, 29]) expect(bruttoSyottoKoodille(k)).toBe(false);
    for (const k of [0, 11, 12, 19, 21, 22, 13, 14]) expect(bruttoSyottoKoodille(k)).toBe(true);
  });
});

describe('tilinAlvOletus', () => {
  it('käyttää tilin voimassa olevaa kantaa sellaisenaan', () => {
    expect(tilinAlvOletus(tili({ alvlaji: 11, alvprosentti: 25.5 }), '2026-06-01')).toEqual({
      alvKoodi: 11,
      alvProsentti: 25.5,
    });
    expect(tilinAlvOletus(tili({ alvlaji: 11, alvprosentti: 10 }), '2026-06-01')).toEqual({
      alvKoodi: 11,
      alvProsentti: 10,
    });
  });

  it('korvaa vanhentuneen yleisen kannan päivän yleisellä (24 -> 25,5)', () => {
    expect(tilinAlvOletus(tili({ alvlaji: 21, alvprosentti: 24 }), '2026-06-01')).toEqual({
      alvKoodi: 21,
      alvProsentti: 25.5,
    });
    // Ennen 1.9.2024 24 % oli voimassa.
    expect(tilinAlvOletus(tili({ alvlaji: 21, alvprosentti: 24 }), '2024-06-01')).toEqual({
      alvKoodi: 21,
      alvProsentti: 24,
    });
  });

  it('korvaa vanhentuneen keskimmäisen kannan päivän keskimmäisellä (14 -> 13,5)', () => {
    expect(tilinAlvOletus(tili({ alvlaji: 11, alvprosentti: 14 }), '2026-06-01')).toEqual({
      alvKoodi: 11,
      alvProsentti: 13.5,
    });
  });

  it('nollalaji -> 0 %, puuttuva tai tuntematon laji -> veroton', () => {
    expect(tilinAlvOletus(tili({ alvlaji: 14, alvprosentti: 24 }), '2026-06-01')).toEqual({
      alvKoodi: 14,
      alvProsentti: 0,
    });
    expect(tilinAlvOletus(tili({}), '2026-06-01')).toEqual({ alvKoodi: 0, alvProsentti: 0 });
    expect(tilinAlvOletus(tili({ alvlaji: 777 }), '2026-06-01')).toEqual({
      alvKoodi: 0,
      alvProsentti: 0,
    });
  });
});
