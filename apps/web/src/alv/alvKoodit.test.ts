import { type Cents, Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { KOODIJARJESTYS, KOODINIMET, koodiRivit } from './alvKoodit.js';

function kartta(parit: [number, number][]): Map<number, Cents> {
  return new Map(parit.map(([koodi, snt]) => [koodi, Euro.fromCents(snt)]));
}

describe('koodiRivit', () => {
  it('renderöi vain mapissa olevat koodit kiinteässä järjestyksessä (318 ennen 307:ää)', () => {
    const rivit = koodiRivit({
      koodit: kartta([
        [307, 2_550],
        [318, 1_000],
        [301, 5_100],
        [308, 3_550],
      ]),
      maksettava: Euro.fromCents(3_550),
    });
    expect(rivit.map((r) => r.koodi)).toEqual([301, 318, 307, 308]);
    expect(rivit.every((r) => (r.koodi === 308) === r.lihava)).toBe(true);
  });

  it('308 tulee aina maksettava-kentästä — myös kun nolla on suodattunut mapista pois', () => {
    // haeAlvLaskelma suodattaa nolla-arvot 308:n asettamisen JÄLKEEN (alvLaskelma.ts:61-65).
    const rivit = koodiRivit({ koodit: kartta([[309, 10_000]]), maksettava: Euro.fromCents(0) });
    expect(rivit.map((r) => r.koodi)).toEqual([308, 309]);
    const maksettava = rivit.find((r) => r.koodi === 308);
    expect(maksettava?.arvo).toBe(Euro.fromCents(0));
    expect(maksettava?.lihava).toBe(true);
  });

  it('negatiivinen maksettava (palautus) välittyy sellaisenaan', () => {
    const rivit = koodiRivit({
      koodit: kartta([
        [307, 2_550],
        [308, -2_550],
      ]),
      maksettava: Euro.fromCents(-2_550),
    });
    expect(rivit.find((r) => r.koodi === 308)?.arvo).toBe(Euro.fromCents(-2_550));
  });

  it('tyhjä kausi tuottaa pelkän maksettava-rivin', () => {
    const rivit = koodiRivit({ koodit: kartta([]), maksettava: Euro.fromCents(0) });
    expect(rivit.map((r) => r.koodi)).toEqual([308]);
  });

  it('nimet ovat verbatim legacystä ja järjestys kattaa kaikki lasketut koodit', () => {
    expect(KOODIJARJESTYS).toEqual([
      301, 302, 303, 305, 306, 318, 307, 308, 309, 311, 312, 313, 314, 319, 320,
    ]);
    expect(KOODINIMET.get(301)).toBe('Suoritettava 24% / 25,5%:n vero kotimaan myynnistä');
    expect(KOODINIMET.get(302)).toBe('Suoritettava 13,5 / 14.0%:n vero kotimaan myynnistä');
    expect(KOODINIMET.get(308)).toBe('Maksettava vero / Palautukseen oikeuttava vero');
    expect(KOODINIMET.get(318)).toBe('Vero rakentamispalveluiden ja metalliromun ostoista');
  });
});
